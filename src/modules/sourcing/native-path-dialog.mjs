import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync=promisify(execFile);
const KINDS=new Set(['RAW_DIRECTORY','IMAGE_CACHE_DIRECTORY','ANALYSIS_WORKBOOK']);
const SCRIPT_PATH=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../scripts/native/select-sourcing-path.ps1');
const MAC_SCRIPTS=Object.freeze({
  RAW_DIRECTORY:'POSIX path of (choose folder with prompt "选择1688原始导出目录")',
  IMAGE_CACHE_DIRECTORY:'POSIX path of (choose folder with prompt "选择1688图片缓存目录")',
  ANALYSIS_WORKBOOK:'POSIX path of (choose file with prompt "选择现有分析工作簿" of type {"org.openxmlformats.spreadsheetml.sheet"})',
});

export async function chooseNativePath({platform=process.platform,kind,currentPath=null,runProcess=defaultRunProcess}={}) {
  if(!KINDS.has(kind)) throw coded('PATH_DIALOG_KIND',`unsupported path dialog kind: ${kind}`);
  let call;
  if(platform==='darwin') call={command:'osascript',args:['-e',MAC_SCRIPTS[kind]],shell:false};
  else if(platform==='win32') call={
    command:'powershell.exe',
    args:['-NoProfile','-NonInteractive','-Sta','-File',SCRIPT_PATH,'-Kind',kind,...(currentPath?['-CurrentPath',String(currentPath)]:[])],
    shell:false,
  };
  else throw coded('PATH_DIALOG_PLATFORM',`unsupported native dialog platform: ${platform}`);
  try {
    const result=await runProcess(call);
    if(result?.code===2||isCancel(result?.stderr)) return {cancelled:true,path:currentPath??null};
    if(result?.code && result.code!==0) throw coded('PATH_DIALOG_FAILED',result.stderr||`native dialog exited ${result.code}`);
    const selected=String(result?.stdout??'').trim();
    if(!selected) return {cancelled:true,path:currentPath??null};
    return {cancelled:false,path:selected};
  } catch(error) {
    if(error?.code===2 || error?.code==='2' || isCancel(error?.stderr)) return {cancelled:true,path:currentPath??null};
    if(error?.code?.startsWith?.('PATH_DIALOG_')) throw error;
    throw coded('PATH_DIALOG_FAILED',error?.message??String(error));
  }
}

async function defaultRunProcess(call) {
  try {
    const {stdout,stderr}=await execFileAsync(call.command,call.args,{shell:false,encoding:'utf8',windowsHide:true,maxBuffer:64*1024});
    return {code:0,stdout,stderr};
  } catch(error) { return {code:error?.code??1,stdout:error?.stdout??'',stderr:error?.stderr??error?.message??''}; }
}

function coded(code,message) { const error=new Error(`${code}: ${message}`);error.code=code;return error; }
function isCancel(value) { return /User canceled|用户已取消|\(-128\)/i.test(String(value??'')); }
