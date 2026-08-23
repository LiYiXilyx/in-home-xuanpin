import fs from 'node:fs';
import path from 'node:path';

const DISPLAY_CHECKPOINT_FIELDS = ['phase','scrollRound','round','currentCount','discovered','targetCount','lastEvent','latestCheckpointAt'];

export function createStatusService({ db, jobRepository, config, browserStatus, latestExcel, currentExcel }) {
  return {
    async snapshot() {
      const jobs = jobRepository.listJobs({ limit: 20 });
      const current = selectCurrentJob(jobs);
      const events = current ? jobRepository.listEvents(current.id,{ limit:100 }) : [];
      let quality = current ? qualityRows(db,current.id) : [];
      let qualityJobId=current?.id ?? null;
      if (quality.length === 0) {
        const fallback=db.prepare('SELECT job_id AS jobId FROM data_quality_checks ORDER BY checked_at DESC,id DESC LIMIT 1').get();
        qualityJobId=fallback?.jobId ?? null;
        quality=qualityJobId ? qualityRows(db,qualityJobId) : [];
      }
      const image = imageCoverage(db);
      const excel = latestExcel();
      const currentWorkbook=currentExcel ? currentExcel():excel;
      return {
        environment:{ name:config.app.environment,testMode:config.app.environment === 'test' },
        browser: await browserStatus(),
        currentJob: current ? publicJob(current) : null,
        jobs: jobs.map(publicJob),
        checkpoint: publicCheckpoint(current?.checkpoint),
        quality,qualityJobId,
        imageCoverage:image,
        activeProducts:activeProducts(db),
        latestExcel:excel ? { exists:true,name:path.basename(excel),modifiedAt:fs.statSync(excel).mtime.toISOString() } : { exists:false,name:null,modifiedAt:null },
        currentExcelExists:Boolean(currentWorkbook),
        recentErrors:recentErrors(jobs,events),
        events:events.map(publicEvent)
      };
    }
  };
}

function selectCurrentJob(jobs) {
  return jobs.find(job => ['running','paused','paused_manual_recovery','interrupted','pending'].includes(job.status))
    ?? [...jobs].sort((left,right) => Date.parse(right.updatedAt ?? 0)-Date.parse(left.updatedAt ?? 0))[0]
    ?? null;
}

function publicJob(job) {
  const checkpointCount=Number(job.checkpoint?.currentCount ?? job.checkpoint?.discovered ?? 0);
  return {
    id:job.id,jobType:job.jobType,status:job.status,targetCount:job.targetCount ?? 0,
    discovered:Math.max(Number(job.discoveredCount ?? 0),checkpointCount),stored:job.storedCount,processed:job.processedItems,
    success:job.successItems,failed:job.failedItems,resumeCount:job.resumeCount,
    pauseRequested:job.pauseRequested,cancelRequested:job.cancelRequested,
    waitingForInput:['paused','paused_manual_recovery'].includes(job.status) && Boolean(job.checkpoint?.manualGate),
    manualGateReason:job.checkpoint?.manualGate?.reason ?? null,
    manualGateMessage:job.checkpoint?.manualGate ? operatorMessage(job.checkpoint.manualGate.reason,job.checkpoint.manualGate.message) : null,
    sessionRecoveryValidated:Boolean(job.checkpoint?.manualGate?.validation?.passed),
    sessionRecoveryValidation:job.checkpoint?.manualGate?.validation ?? null,
    requestedAt:job.requestedAt,startedAt:job.startedAt,updatedAt:job.updatedAt,finishedAt:job.finishedAt,
    lastErrorCode:job.lastErrorCode,lastError:job.lastErrorCode || job.lastErrorMessage ? operatorMessage(job.lastErrorCode,job.lastErrorMessage) : null
  };
}

function publicCheckpoint(checkpoint) {
  if (!checkpoint) return null;
  return Object.fromEntries(DISPLAY_CHECKPOINT_FIELDS.filter(field => checkpoint[field] !== undefined).map(field => [field,checkpoint[field]]));
}

function publicEvent(event) {
  return { id:event.id,type:event.eventType,level:event.level,message:operatorMessage(null,event.message),createdAt:event.createdAt };
}

function qualityRows(db,jobId) {
  return db.prepare(`SELECT check_code AS metricName,metric_value AS actual,threshold_value AS threshold,
    passed,checked_at AS createdAt FROM data_quality_checks WHERE job_id=? ORDER BY id`).all(jobId)
    .map(row => ({ ...row,passed:Boolean(row.passed) }));
}

function activeProducts(db) {
  return Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1').get()?.count ?? 0);
}

function imageCoverage(db) {
  const row=db.prepare(`SELECT COUNT(*) AS active,
    SUM(CASE WHEN EXISTS(SELECT 1 FROM product_images pi WHERE pi.product_id=m.product_id
      AND pi.download_status='completed' AND pi.local_path IS NOT NULL) THEN 1 ELSE 0 END) AS usable
    FROM catalog_memberships m WHERE m.active=1`).get();
  const active=Number(row?.active ?? 0),usable=Number(row?.usable ?? 0);
  return { active,usable,percent:active ? Number((usable*100/active).toFixed(2)) : 0 };
}

function recentErrors(jobs,events) {
  const values=[];
  for (const job of jobs) if (job.lastErrorCode || job.lastErrorMessage) values.push({
    jobId:job.id,code:job.lastErrorCode ?? 'JOB_FAILED',message:operatorMessage(job.lastErrorCode,job.lastErrorMessage),at:job.updatedAt
  });
  for (const event of events.filter(item => item.level === 'error').slice(-10)) values.push({
    jobId:event.jobId,code:event.eventType,message:operatorMessage(null,event.message),at:event.createdAt
  });
  return values.slice(-10).reverse();
}

export function operatorMessage(code,message='') {
  const normalized=String(code ?? '').toUpperCase();
  if (/NETWORK|ECONN|ETIMEDOUT|TIMEOUT|EACCES/.test(`${normalized} ${message}`)) return '网络连接异常，请检查公司网络或 VPN 后重试。';
  if (/CDP|BROWSER.*CLOSED|TARGET.*CLOSED/.test(`${normalized} ${message}`)) return '采集 Chrome 连接已断开，请重新打开 Chrome 后继续原任务。';
  if (/CAPTCHA|LOGIN|ACCESS_RESTRICTED/.test(`${normalized} ${message}`)) return 'Temu 需要登录或安全验证，请在采集 Chrome 中人工处理后点击继续。';
  if (/LOAD_MORE_MANUAL_REQUIRED/.test(normalized)) return '自动加载没有产生新商品。请在采集 Chrome 页面底部人工点击“Try again”，确认新商品出现后回运营台点击“继续”。';
  if (/SEARCH_NO_RESULTS/.test(normalized)) return '当前独立 Chrome 搜索无结果；若多个普通搜索词都无结果，建议新建采集 Chrome 并重新登录。';
  if (/STALE_CATEGORY_PAGE/.test(normalized)) return '当前 Temu 类目页面已失效，请从独立 Chrome 首页重新进入目标类目。';
  if (/SESSION_CONTEXT_PROBLEM|DETAIL_AVAILABILITY/.test(normalized)) return 'External Chrome 当前商品上下文异常。请人工回首页或目标类目，确认 Germany / English / EUR，重新进入 Motorcycle Accessories / Top Sales，打开一个正常商品后执行“页面已恢复，重新验证”。';
  if (/WRONG_SITE/.test(normalized)) return '当前页面不是 Temu，请在采集 Chrome 中打开正确页面。';
  if (/CATEGORY/.test(normalized)) return '当前页面不是摩托配件类目，请进入正确类目后重试。';
  if (/SORT|TOP_SALES/.test(normalized)) return '当前页面未确认 Top Sales，请选择 Top Sales 后重试。';
  if (/CATALOG_POOL_SAFETY/.test(normalized)) return '本次商品数或质量未达到安全门，原商品池已保留，请检查页面后重试。';
  if (/BROWSER_JOB_CONFLICT/.test(normalized)) return '已有采集任务等待处理，请先继续、取消或完成当前任务。';
  if (/EXCEL_APP_NOT_ASSOCIATED/.test(normalized)) return '未找到可用的 Excel/WPS 程序。请确认 Excel 或 WPS 已完整安装后重试。';
  if (/EXCEL_IN_USE/.test(normalized)) return 'Excel 正在被 Excel/WPS 占用。请关闭文件后再操作。';
  if (/EXCEL_NOT_FOUND/.test(normalized)) return '尚未生成运营 Excel，请先点击“导出 Excel”。';
  const text=String(message || '操作未完成，请查看运行记录后重试。');
  return text.replace(/\b(?:TypeError|Error):?\s*/gi,'').replace(/(?:[A-Z]:\\|\/)[^\s]+/g,'[本地路径]').slice(0,300);
}
