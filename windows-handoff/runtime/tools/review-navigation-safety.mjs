import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createJobRepository } from '../src/db/repositories/job-repository.mjs';
import { createReviewQueueRepository } from '../src/db/repositories/review-queue-repository.mjs';
import { createReviewNavigationSafety } from '../src/modules/reviews/review-navigation-safety.mjs';

const options=parseArgs(process.argv.slice(2));
if (!['status','signal'].includes(options.command)) usage();
const config=await loadConfig(options.config ?? 'config.json');
const db=openDatabase(config.app.databasePath);
try {
  const jobs=createJobRepository(db);const queue=createReviewQueueRepository(db);
  const safety=createReviewNavigationSafety({ jobRepository:jobs,config });
  if (options.command === 'status') {
    if (!options.jobId) usage();
    console.log(JSON.stringify({ jobId:options.jobId,...safety.status(options.jobId) },null,2));
  } else {
    if (!options.queueId || !options.goodsId || !options.code) usage();
    const item=queue.get(options.queueId);
    if (!item || item.goodsId !== options.goodsId) throw new Error('queue-id 与 goods-id 不匹配。');
    const result=safety.signal(item.jobId,{ queueId:item.id,goodsId:item.goodsId,code:options.code,evidence:{ source:'operator_safety_admin' } });
    queue.transition(item.id,item.status,{ checkpoint:{ safetyGate:{ opened:true,reason:result.state.reason,openedAt:result.state.openedAt,
      cooldownUntil:result.state.cooldownUntil,manualRecoveryRequired:true } } });
    console.log(JSON.stringify({ jobId:item.jobId,queueId:item.id,goodsId:item.goodsId,...result },null,2));
  }
} finally { db.close(); }

function parseArgs(args) {
  const result={ command:args[0] };
  for (let index=1;index<args.length;index+=1) {
    const value=args[index+1];
    if (args[index] === '--config') result.config=value;
    if (args[index] === '--job-id') result.jobId=value;
    if (args[index] === '--queue-id') result.queueId=value;
    if (args[index] === '--goods-id') result.goodsId=value;
    if (args[index] === '--code') result.code=value;
    if (args[index].startsWith('--')) index+=1;
  }
  return result;
}
function usage() {
  console.error('用法：node tools/review-navigation-safety.mjs status --job-id <job> [--config config.json]');
  console.error('或：node tools/review-navigation-safety.mjs signal --queue-id <queue> --goods-id <goods> --code ITEMS_GONE [--config config.json]');
  process.exit(2);
}
