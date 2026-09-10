import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from '../../db/client.mjs';
import { createAnalysisRepository } from '../../db/repositories/analysis-repository.mjs';
import { createJobRepository } from '../../db/repositories/job-repository.mjs';
import { createReviewQueueRepository } from '../../db/repositories/review-queue-repository.mjs';
import { createReviewRepository } from '../../db/repositories/review-repository.mjs';
import { daysAgoIso } from '../../parsers.mjs';

export const DAY9_8_FAMILIES=Object.freeze(['整车防护罩','车把与横把附件','排气系统部件','尾包与后座包','收纳/尾包']);
const GATES=Object.freeze({ R1:{ targetCount:5,perFamily:1,prerequisite:null },R2:{ targetCount:10,perFamily:2,prerequisite:'R1' },R3:{ targetCount:50,perFamily:null,prerequisite:'R2' } });

export function selectReviewGateItems(sample,{ gate='R1' }={}) {
  const definition=GATES[gate];
  if (!definition) throw new Error(`未知 Day9.8 Gate：${gate}`);
  const items=Array.isArray(sample?.items) ? sample.items.map(item => ({ ...item })) : [];
  if (Number(sample?.sampleCount) !== 50 || items.length !== 50) throw new Error('Day9.8 必须使用完整的 recommended-review-sample-50.json。');
  const ranks=new Set(items.map(item => Number(item.priorityRank)));
  const goodsIds=new Set(items.map(item => String(item.goodsId)));
  if (ranks.size !== 50 || goodsIds.size !== 50) throw new Error('Day9.8 sample rank 或 goods_id 不唯一。');
  if (items.some(item => item.businessEligible !== true || item.electronicRisk === true)) throw new Error('Day9.8 sample 含非业务可做或电子风险商品。');
  const sorted=items.sort((a,b) => Number(a.priorityRank)-Number(b.priorityRank));
  const selected=gate === 'R3' ? sorted:DAY9_8_FAMILIES.flatMap(family => sorted.filter(item => item.productFamily === family).slice(0,definition.perFamily));
  if (selected.length !== definition.targetCount || new Set(selected.map(item => item.productFamily)).size !== 5) throw new Error(`Day9.8 ${gate} 产品族覆盖不完整。`);
  return { gate,targetCount:definition.targetCount,prerequisite:definition.prerequisite,selected };
}

export async function prepareReviewSampleGate(config,{ samplePath,gate='R1',now=() => new Date() }={}) {
  const resolvedSamplePath=path.resolve(path.dirname(config.configPath),samplePath ?? 'outputs/new-1000-product-insight-20260826/recommended-review-sample-50.json');
  const sampleBytes=await fs.readFile(resolvedSamplePath);const sample=JSON.parse(sampleBytes.toString('utf8'));
  const sampleSha256=crypto.createHash('sha256').update(sampleBytes).digest('hex');
  const selection=selectReviewGateItems(sample,{ gate });const runDate=now();const cutoffDate=daysAgoIso(30,runDate);
  const db=openDatabase(config.app.databasePath);
  try {
    const jobs=createJobRepository(db);const reviews=createReviewRepository(db);const queues=createReviewQueueRepository(db);
    const existing=db.prepare(`SELECT id FROM crawl_jobs WHERE job_type='reviews'
      AND json_extract(config_json,'$.day')=9.8 AND json_extract(config_json,'$.gate')=?
      AND json_extract(config_json,'$.sampleSha256')=? AND json_extract(config_json,'$.cutoffDate')=?
      ORDER BY created_at DESC LIMIT 1`).get(gate,sampleSha256,cutoffDate);
    if (existing) return summarizePrepared(db,jobs.getJob(existing.id),queues.list(existing.id),false);
    if (selection.prerequisite) {
      const passed=db.prepare(`SELECT j.id FROM crawl_jobs j JOIN crawl_events e ON e.job_id=j.id
        WHERE j.job_type='reviews' AND json_extract(j.config_json,'$.day')=9.8
          AND json_extract(j.config_json,'$.gate')=? AND e.event_type='day9_8_gate_passed'
        ORDER BY e.created_at DESC LIMIT 1`).get(selection.prerequisite);
      if (!passed) throw new Error(`Day9.8 ${selection.prerequisite} 尚未 PASS，禁止创建 ${gate}。`);
    }
    const activePool=db.prepare("SELECT id,product_count,non_electronic_unique_count FROM catalog_pool_versions WHERE status='active' ORDER BY activated_at DESC LIMIT 1").get();
    if (!activePool || Number(activePool.product_count)!==1000 || Number(activePool.non_electronic_unique_count)!==1000) throw new Error('Day9.8 active catalog pool 不是已确认的 1000 个非电子唯一商品。');
    const productStatement=db.prepare(`SELECT p.id AS productId,p.external_product_id AS goodsId,p.canonical_url AS canonicalUrl,
      (SELECT COUNT(*) FROM reviews r WHERE r.product_id=p.id) AS reviewsBefore
      FROM products p JOIN catalog_memberships m ON m.product_id=p.id AND m.active=1
      WHERE p.platform='temu' AND p.external_product_id=?`);
    const selected=selection.selected.map(item => {
      const product=productStatement.get(String(item.goodsId));if (!product) throw new Error(`sample 商品不在当前 active pool：${item.goodsId}`);
      return { ...item,productId:Number(product.productId),canonicalUrl:product.canonicalUrl,reviewsBefore:Number(product.reviewsBefore) };
    });
    const analysis=createAnalysisRepository(db);const protectedCounts={ ...analysis.coreCounts(),
      poolVersions:Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_pool_versions').get().count),
      poolVersionItems:Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_pool_version_items').get().count) };
    const job=jobs.createJob({ jobType:'reviews',mode:'yingdao_existing_chrome',siteCountry:config.catalog.siteCountry,language:config.catalog.language,
      currency:config.catalog.currency,targetCount:selection.targetCount,config:{ day:9.8,gate,source:'recommended-review-sample-50.json',samplePath:resolvedSamplePath,
        sampleSha256,catalogPoolVersion:activePool.id,cutoffDate,runDate:runDate.toISOString(),protectedCounts } });
    const coverageItems=[];const queueItems=[];
    for (const [index,item] of selected.entries()) {
      const checkpoint={ gate,goods_id:String(item.goodsId),product_family:item.productFamily,catalog_pool_version:activePool.id,
        sample_rank:Number(item.priorityRank),review_priority_score:Number(item.priorityScore),reviews_before:item.reviewsBefore,cutoff_date:cutoffDate };
      jobs.upsertJobItem(job.id,{ sequenceNo:index+1,itemKey:String(item.goodsId),productId:item.productId,productUrl:item.canonicalUrl,checkpoint });
      coverageItems.push({ productId:item.productId,goodsId:String(item.goodsId) });
      queueItems.push({ productId:item.productId,goodsId:String(item.goodsId),sourceUrl:item.canonicalUrl,checkpoint });
    }
    reviews.initializeCoverage(job.id,coverageItems,cutoffDate);const queued=queues.enqueue(job.id,queueItems);
    jobs.appendEvent(job.id,'day9_8_sample_queue_created','info','已从冻结的 recommended-review-sample-50.json 创建 Day9.8 Gate 队列。',
      { gate,count:queued.length,sampleSha256,cutoffDate,catalogPoolVersion:activePool.id,goodsIds:selected.map(item => item.goodsId) });
    return summarizePrepared(db,jobs.getJob(job.id),queued,true);
  } finally { db.close(); }
}

function summarizePrepared(db,job,queue,created) {
  return { created,jobId:job.id,status:job.status,gate:job.config.gate,targetCount:job.targetCount,cutoffDate:job.config.cutoffDate,
    runDate:job.config.runDate,samplePath:job.config.samplePath,sampleSha256:job.config.sampleSha256,catalogPoolVersion:job.config.catalogPoolVersion,
    items:queue.map(item => ({ id:item.id,goodsId:item.goodsId,status:item.status,attemptCount:item.attemptCount,...item.checkpoint,
      coverage:db.prepare('SELECT task_status AS taskStatus,reviews_captured AS reviewsCaptured,pages_scanned AS pagesScanned FROM review_capture_coverage WHERE job_id=? AND product_id=?').get(job.id,item.productId) })) };
}
