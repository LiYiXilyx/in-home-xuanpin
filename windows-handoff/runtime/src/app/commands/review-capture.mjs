import { approveReviewStage,prepareReviewCaptureJob,reviewCaptureQa,runReviewCaptureJob } from '../../jobs/review-job-runner.mjs';

export async function runDay9ReviewCaptureCommand(config,options={}) {
  const prepared=await prepareReviewCaptureJob(config,{ targetCount:options.targetCount ?? 10,jobId:options.jobId });
  console.log(`Day9评论任务：${prepared.job.id}，目标商品=${prepared.job.targetCount}，状态=${prepared.job.status}。`);
  try { return await runReviewCaptureJob(config,{ jobId:prepared.job.id }); }
  catch (error) { error.message=`${error.message} 可用 --job ${prepared.job.id} 从数据库断点恢复。`;error.jobId=prepared.job.id;throw error; }
}

export function runDay9ReviewQaCommand(config,{ jobId,approve=false,manualCheckedGoodsIds=[] }={}) {
  if (!jobId) throw new Error('review-qa 必须提供 --job <JOB_ID>。');
  const result=approve ? approveReviewStage(config,jobId,{ manualCheckedGoodsIds }):reviewCaptureQa(config,jobId);
  console.log(JSON.stringify(result,null,2));return result;
}
