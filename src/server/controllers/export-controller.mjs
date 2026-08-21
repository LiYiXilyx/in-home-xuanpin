import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DEFAULT_WORKBOOK_NAME,exportEmptyOperationsWorkbook,exportOperationsWorkbook } from '../../modules/export/export-service.mjs';
import { AppError } from '../../shared/errors.mjs';

export function createExportController({ config,repository,service,openTarget=defaultOpenTarget,exportWorkbook=exportOperationsWorkbook,
  createEmptyWorkbook=exportEmptyOperationsWorkbook }) {
  const outputDir=config.export.outputDir;
  const fixedWorkbookPath=path.join(outputDir,DEFAULT_WORKBOOK_NAME);
  const latestExcel=() => findLatestExcel(outputDir,{ includeHistory:true });
  const currentExcel=() => findLatestExcel(outputDir,{ includeHistory:false });
  return {
    latestExcel,currentExcel,
    async export() {
      const catalogJob=repository.listJobs({ limit:100 }).find(job => job.jobType === 'catalog' && ['completed','completed_with_errors'].includes(job.status));
      if (!catalogJob) throw new AppError('尚无已完成的商品采集任务，暂时不能导出 Excel。',{ code:'EXPORT_SOURCE_NOT_FOUND' });
      const job=service.create({ jobType:'export',mode:'database_export',targetCount:catalogJob.targetCount,config:{ label:'导出运营 Excel',sourceJobId:catalogJob.id,day:6 } });
      service.start(job.id);
      try {
        const result=await exportWorkbook(config,{ jobId:catalogJob.id });
        repository.appendEvent(job.id,'export_completed','success',`Excel 已导出：${path.basename(result.savedPath)}`,{ products:result.products,embeddedImages:result.embeddedImages,hyperlinks:result.hyperlinks });
        service.complete(job.id,{ failedItems:0 });
        return { jobId:job.id,fileName:path.basename(result.savedPath),products:result.products,embeddedImages:result.embeddedImages,hyperlinks:result.hyperlinks,timestampFallback:result.timestampFallback };
      } catch (error) { service.fail(job.id,error); throw error; }
    },
    async openExcel() {
      const target=latestExcel();
      if (!target) throw new AppError('运营 Excel 尚未生成。',{ code:'EXCEL_NOT_FOUND' });
      try { await openTarget(target,{ kind:'excel' }); }
      catch (error) { throw new AppError('无法打开 Excel。',{ code:error?.code ?? 'EXCEL_OPEN_FAILED',cause:error }); }
      return { message:'Excel 已交给 Windows 打开。',fileName:path.basename(target) };
    },
    async openFolder() { await openTarget(outputDir,{ kind:'folder' }); return { message:'结果目录已打开。' }; },
    async clearExcel({ confirmed=false }={}) {
      if (confirmed !== true) throw new AppError('清除 Excel 前必须确认。',{ code:'CLEAR_EXCEL_CONFIRMATION_REQUIRED' });
      const files=listExcelFiles(outputDir);
      if (files.length) {
        try { await Promise.all(files.map(assertExcelMovable)); }
        catch (error) { throw new AppError('Excel 正在被 Excel/WPS 占用。请关闭所有运营 Excel 后再清除。',{ code:'EXCEL_IN_USE',cause:error }); }
        const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace('Z','').replace('.','-');
        const historyDir=path.join(outputDir,'.excel-history',stamp);
        await fsp.mkdir(historyDir,{ recursive:true });
        try { await Promise.all(files.map(file => fsp.rename(file,path.join(historyDir,path.basename(file))))); }
        catch (error) {
          throw new AppError('Excel 正在被 Excel/WPS 占用。请关闭文件后再清除。',{ code:'EXCEL_IN_USE',cause:error });
        }
      }
      try { await createEmptyWorkbook(fixedWorkbookPath); }
      catch (error) { throw new AppError('旧 Excel 已安全归档，但空白验收表生成失败。请重新点击“清除 Excel”。',{ code:'EMPTY_EXCEL_CREATE_FAILED',cause:error }); }
      return { archived:files.length,emptyWorkbook:true,fileName:path.basename(fixedWorkbookPath),
        message:`已归档 ${files.length} 个当前 Excel，并生成 0 商品空白验收表；可立即点击“打开 Excel”检查。数据库、图片缓存和人工备注备份均已保留。` };
    }
  };
}

async function assertExcelMovable(filePath) {
  const handle=await fsp.open(filePath,'r+');
  await handle.close();
}

export function findLatestExcel(outputDir,{ includeHistory=true }={}) {
  const files=listExcelFiles(outputDir);
  if (includeHistory) files.push(...listHistoricalExcelFiles(outputDir));
  return files.map(target => ({ target,mtime:fs.statSync(target).mtimeMs }))
    .filter(item => validXlsx(item.target)).sort((a,b) => b.mtime-a.mtime)[0]?.target ?? null;
}

function listExcelFiles(outputDir) {
  if (!fs.existsSync(outputDir)) return [];
  return fs.readdirSync(outputDir,{ withFileTypes:true }).filter(entry => entry.isFile() && entry.name.startsWith('Temu运营商品池') && entry.name.toLowerCase().endsWith('.xlsx'))
    .map(entry => path.join(outputDir,entry.name));
}

function listHistoricalExcelFiles(outputDir) {
  const historyDir=path.join(outputDir,'.excel-history');
  if (!fs.existsSync(historyDir)) return [];
  const files=[];
  const pending=[historyDir];
  while (pending.length) {
    const directory=pending.pop();
    for (const entry of fs.readdirSync(directory,{ withFileTypes:true })) {
      const target=path.join(directory,entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.startsWith('Temu运营商品池') && entry.name.toLowerCase().endsWith('.xlsx')) files.push(target);
    }
  }
  return files;
}

function validXlsx(target) { try { const fd=fs.openSync(target,'r'); try { const bytes=Buffer.alloc(4); return fs.readSync(fd,bytes,0,4,0) === 4 && bytes.equals(Buffer.from([0x50,0x4b,0x03,0x04])); } finally { fs.closeSync(fd); } } catch { return false; } }
function defaultOpenTarget(target,{ kind='folder' }={}) {
  return new Promise((resolve,reject) => {
    const script=[
      '$ErrorActionPreference = "Stop"',
      '$target = [Environment]::GetEnvironmentVariable("TEMU_OPERATOR_OPEN_TARGET", "Process")',
      'if (-not (Test-Path -LiteralPath $target)) { exit 44 }',
      'if ($env:TEMU_OPERATOR_OPEN_KIND -eq "excel") {',
      '  $keys = @("HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\EXCEL.EXE", "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\EXCEL.EXE", "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\EXCEL.EXE", "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\et.exe", "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\et.exe", "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\et.exe")',
      '  $registryCandidates = foreach ($keyPath in $keys) { $registryKey = Get-Item -LiteralPath $keyPath -ErrorAction SilentlyContinue; if ($registryKey) { $registered = [string]$registryKey.GetValue(""); if ($registered) { Join-Path (Split-Path -Parent $registered) "EXCEL.EXE"; Join-Path (Split-Path -Parent $registered) "et.exe"; $registered } } }',
      '  $runningAppCandidates = Get-Process -Name EXCEL,et,wps -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { Join-Path (Split-Path -Parent $_.Path) "EXCEL.EXE"; Join-Path (Split-Path -Parent $_.Path) "et.exe"; $_.Path } }',
      '  $candidates = @($registryCandidates) + @($runningAppCandidates)',
      '  $application = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1',
      '  if (-not $application) { exit 42 }',
      "  $quotedTarget = '\"' + $target + '\"'",
      '  Start-Process -FilePath $application -ArgumentList @($quotedTarget) -ErrorAction Stop',
      '} else { Start-Process -FilePath $target -ErrorAction Stop }'
    ].join('; ');
    const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',script],{
      stdio:'ignore',windowsHide:true,env:{ ...process.env,TEMU_OPERATOR_OPEN_TARGET:target,TEMU_OPERATOR_OPEN_KIND:kind }
    });
    child.once('error',reject);
    child.once('exit',code => {
      if (code === 0) resolve();
      else {
        const error=new Error(`Windows 打开请求失败，退出码 ${code ?? '未知'}。`);
        error.code=code === 42 ? 'EXCEL_APP_NOT_ASSOCIATED' : code === 44 ? 'OPEN_TARGET_NOT_FOUND' : 'EXCEL_OPEN_FAILED';
        reject(error);
      }
    });
  });
}
