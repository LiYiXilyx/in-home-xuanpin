import { spawn } from 'node:child_process';
import { AppError } from '../../shared/errors.mjs';
import { validateSessionRecovery } from '../../jobs/review-job-runner.mjs';

export function createReviewController({ config,repository,service,projectDir,runProcess=defaultRunProcess }) {
  return {
    async validateSessionRecovery(jobId) {
      requireReviewGate(repository,jobId);
      return validateSessionRecovery(config,{ jobId });
    },
    resume(jobId) {
      const job=requireReviewGate(repository,jobId);
      if (!job.checkpoint?.manualGate?.validation?.passed) throw new AppError('请先点击“页面已恢复，重新验证”，并通过 2/3 Control Products 健康检查。',{ code:'SESSION_RECOVERY_NOT_VALIDATED' });
      runProcess({ projectDir,configPath:config.configPath,jobId,action:'review-capture',browserMode:config.browser.mode,browserProfileDir:config.browser.profileDir,browserDebugPort:config.browser.debugPort,browserCdpEndpoint:config.browser.cdpEndpoint });
      return service.get(jobId);
    }
  };
}
function requireReviewGate(repository,jobId) {
  const job=repository.getJob(jobId);
  if (!job || job.jobType !== 'reviews') throw new AppError('找不到 Day9 评论任务。',{ code:'JOB_NOT_FOUND' });
  if (job.status !== 'paused_manual_recovery') throw new AppError('当前评论任务不在 Session Recovery Gate。',{ code:'JOB_INVALID_TRANSITION' });
  return job;
}
function defaultRunProcess({ projectDir,configPath,jobId,action,browserMode,browserProfileDir,browserDebugPort,browserCdpEndpoint }) {
  const child=spawn(process.execPath,['src/cli.mjs',action,'--config',configPath,'--job',jobId],{ cwd:projectDir,detached:true,stdio:'ignore',windowsHide:true,env:{ ...process.env,FORCE_COLOR:'0',TEMU_BROWSER_MODE:browserMode,TEMU_BROWSER_PROFILE_DIR:browserProfileDir,TEMU_BROWSER_DEBUG_PORT:String(browserDebugPort),TEMU_BROWSER_CDP_ENDPOINT:browserCdpEndpoint || '' } });
  child.unref();return child;
}
