import { spawn } from 'node:child_process';
import { AppError } from '../../shared/errors.mjs';

const TARGETS=new Set([100,300,1000]);

export function createJobController({ config,repository,service,projectDir,runProcess=defaultRunProcess }) {
  function launch(jobId,action) {
    runProcess({ projectDir,configPath:config.configPath,jobId,action,browserMode:config.browser.mode,
      browserProfileDir:config.browser.profileDir,browserDebugPort:config.browser.debugPort,browserCdpEndpoint:config.browser.cdpEndpoint });
    return service.get(jobId);
  }
  return {
    start(targetCount) {
      const target=Number(targetCount);
      if (!TARGETS.has(target)) throw new AppError('只允许开始 100、300 或 1000 条任务。',{ code:'TARGET_INVALID' });
      const active=service.list({ limit:100 }).find(item => item.jobType === 'catalog' && ['pending','running','paused','interrupted'].includes(item.status));
      if (active) throw new AppError('已有采集任务等待处理，请先继续、取消或完成当前任务。',{ code:'BROWSER_JOB_CONFLICT',retriable:true });
      const configured=config.catalog.jobs[0];
      const job=service.create({ jobType:'catalog',mode:'operator_current_page',siteCountry:config.catalog.siteCountry,
        language:config.catalog.language,currency:config.catalog.currency,primaryCategory:configured.primaryCategory,
        subcategory:configured.subcategory,sourceUrl:configured.url,sortOrder:configured.sortOrder,targetCount:target,
        config:{ label:`采集 ${target} 个 Top Sales 商品`,dashboardTaskKind:'catalog',day:6 }
      });
      return launch(job.id,'resume');
    },
    pause(jobId) { return service.pause(requireId(jobId)); },
    cancel(jobId) { return service.cancel(requireId(jobId)); },
    resume(jobId) {
      const job=service.get(requireId(jobId));
      if (!job) throw new AppError('找不到需要继续的任务。',{ code:'JOB_NOT_FOUND' });
      if (!['paused','interrupted'].includes(job.status)) throw new AppError('当前任务状态不能继续。',{ code:'JOB_INVALID_TRANSITION' });
      return launch(job.id,'resume');
    },
    retry(jobId) {
      const job=service.get(requireId(jobId));
      if (!job) throw new AppError('找不到需要重试的任务。',{ code:'JOB_NOT_FOUND' });
      const retriableItems=repository.listRetriableFailedJobItems(job.id);
      const jobRetriable=['failed','interrupted'].includes(job.status) && isRetriableJobError(job.lastErrorCode);
      if (retriableItems.length === 0 && !jobRetriable) throw new AppError('没有可重试的失败项；永久错误需要人工修正页面或配置。',{ code:'NO_RETRIABLE_ITEMS' });
      if (!['failed','interrupted','completed_with_errors'].includes(job.status)) throw new AppError('当前任务状态不能重试。',{ code:'JOB_INVALID_TRANSITION' });
      repository.appendEvent(job.id,'retry_requested','info',`准备重试 ${retriableItems.length || '任务级'} 个可恢复失败。`,{ retriableItems:retriableItems.length });
      return launch(job.id,'retry');
    }
  };
}

function defaultRunProcess({ projectDir,configPath,jobId,action,browserMode,browserProfileDir,browserDebugPort,browserCdpEndpoint }) {
  const child=spawn(process.execPath,['src/cli.mjs',action,'--config',configPath,'--job',jobId],{
    cwd:projectDir,detached:true,stdio:'ignore',windowsHide:true,env:{ ...process.env,FORCE_COLOR:'0',
      TEMU_BROWSER_MODE:browserMode,TEMU_BROWSER_PROFILE_DIR:browserProfileDir,TEMU_BROWSER_DEBUG_PORT:String(browserDebugPort),
      TEMU_BROWSER_CDP_ENDPOINT:browserCdpEndpoint || '' }
  });
  child.unref();
  return child;
}

function isRetriableJobError(code) {
  return /NETWORK|ECONN|TIMEOUT|CDP|BROWSER|CAPTCHA|LOGIN|ACCESS|INTERRUPTED|SAFETY/.test(String(code ?? '').toUpperCase());
}
function requireId(value) { if (!value) throw new AppError('缺少 job_id。',{ code:'JOB_ID_REQUIRED' }); return value; }
