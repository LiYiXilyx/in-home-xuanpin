import crypto from 'node:crypto';
import {createVmReviewClient} from './vm-review-client.mjs';
import {parseReviewCard} from '../../runtime/src/modules/reviews/review-parser.mjs';

export function createOpportunityReviews(db,{client=createVmReviewClient(),otherBusy=()=>false,wait=ms=>new Promise(r=>setTimeout(r,ms)),maxRounds=200}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS opportunity_negative_reviews(goods_id TEXT,review_key TEXT,payload TEXT NOT NULL,first_captured TEXT NOT NULL,last_captured TEXT NOT NULL,PRIMARY KEY(goods_id,review_key));
    CREATE TABLE IF NOT EXISTS opportunity_review_jobs(id TEXT PRIMARY KEY,state TEXT NOT NULL,payload TEXT NOT NULL,updated TEXT NOT NULL);`);
  for(const row of db.prepare("SELECT * FROM opportunity_review_jobs WHERE state='RUNNING'").all()){const p=JSON.parse(row.payload);p.state='PAUSED';p.message='服务重启，已保存记录；点击继续采集';db.prepare('UPDATE opportunity_review_jobs SET state=?,payload=? WHERE id=?').run(p.state,JSON.stringify(p),row.id);}
  let active=false,stop=false,promise=Promise.resolve();
  const latest=()=>{const r=db.prepare('SELECT payload FROM opportunity_review_jobs ORDER BY updated DESC,rowid DESC LIMIT 1').get();return r?JSON.parse(r.payload):null;};
  function persist(job){job.updated=new Date().toISOString();db.prepare('INSERT INTO opportunity_review_jobs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,payload=excluded.payload,updated=excluded.updated').run(job.id,job.state,JSON.stringify(job),job.updated);}
  function check(){if(stop)throw Error('已暂停，评论已保存；继续时从当前商品重新加载并去重');}
  function save(goodsId,cards,url){let inserted=0,invalid=0,negative=0;const now=new Date().toISOString();
    db.exec('BEGIN');try{for(const card of cards){
      // A sentiment word is not a star rating. Only explicit numerical star evidence is accepted.
      if(!/^[1-5] out of 5 stars$/.test(card.ratingText||'')){invalid++;continue;}
      const result=parseReviewCard(card,{productId:0,goodsId,sourceUrl:url,capturedAt:now,allowRatingOnly:Boolean(card.reviewer&&card.ratingEvidence)});if(!result.valid){invalid++;continue;}const review=result.review;if(![1,2].includes(review.rating))continue;negative++;
      if(card.contentText==='')review.content='';review.originalText=card.originalText||null;review.ratingEvidence=card.ratingEvidence||card.ratingText;
      if(!review.reviewId&&card.reviewer)review.dedupeKey='dom:'+crypto.createHash('sha256').update(JSON.stringify([card.reviewer,review.reviewDate,review.rating,review.sku,review.content,review.originalText])).digest('hex');
      const old=db.prepare('SELECT 1 FROM opportunity_negative_reviews WHERE goods_id=? AND review_key=?').get(goodsId,review.dedupeKey);
      db.prepare('INSERT INTO opportunity_negative_reviews VALUES(?,?,?,?,?) ON CONFLICT(goods_id,review_key) DO UPDATE SET payload=excluded.payload,last_captured=excluded.last_captured').run(goodsId,review.dedupeKey,JSON.stringify(review),now,now);if(!old)inserted++;
    }db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {inserted,invalid,negative};
  }
  async function run(job){active=true;stop=false;job.state='RUNNING';persist(job);
    try{for(;job.index<job.goodsIds.length;job.index++){
      check();const id=job.goodsIds[job.index];job.current=id;job.message='正在通过 VMLogin 打开商品 '+id;persist(job);await client.open(id);await wait(1800);check();
      let read;for(let attempt=0;attempt<12;attempt++){check();read=await client.step(id,'open');if(read.phase==='READY')break;if(attempt===11)throw Error(read.message||'等待评论弹窗超时，请在 VMLogin 打开评论后继续');await wait(1000);}
      const filters=[];
      for(const rating of [1,2]){
        check();job.rating=rating;job.message='正在自动选择 '+rating+' 星评论';persist(job);
        let applied=false;
        for(let attempt=0;attempt<5;attempt++){check();const result=await client.step(id,'filter:'+rating);await wait(1000);if(result.phase==='FILTER_APPLIED'){applied=true;break;}}
        if(!applied)throw Error('星级筛选未生效，请检查评论页');
        let stale=0,previous='',empty=0,unparsed=0,mismatch=0,reason='ROUND_LIMIT',invalidCount=0,pages=0;
        for(let page=1;page<=maxRounds;page++){
          check();read=await client.step(id,'read');if(read.phase!=='READY')throw Error(read.message||'评论窗口已关闭');
          const cards=read.cards||[];
          if(cards.some(c=>/^[1-5] out of 5 stars$/.test(c.ratingText||'')&&c.ratingText!==rating+' out of 5 stars')){if(++mismatch>=5)throw Error('筛选后的评论星级不一致，已停止防止误采');await wait(1200);continue;}
          mismatch=0;const saved=save(id,cards,read.url);job.inserted+=saved.inserted;invalidCount=Math.max(invalidCount,saved.invalid);
          unparsed=cards.length>0&&saved.invalid===cards.length?unparsed+1:0;if(unparsed>=3)throw Error('评论星级或日期无法核实，已暂停并保留记录');
          const signature=JSON.stringify(cards.map(c=>[c.reviewId,c.dateText,c.ratingText,c.contentText]));stale=signature===previous?stale+1:0;previous=signature;
          empty=cards.length===0?empty+1:0;job.pages=page;pages=page;job.message=`商品 ${id}：自动采集 ${rating} 星，第 ${page} 批，本任务新增 ${job.inserted} 条差评`;persist(job);
          if(read.empty){reason='NO_REVIEWS_VISIBLE';break;}
          if(empty>=3)throw Error('未识别到评论卡片，不能认定没有差评');
          check();const next=await client.step(id,'advance');await wait(1500);
          if(next.phase==='END'&&stale>=3){reason='VISIBLE_END';break;}
          if(stale>=8){reason='NO_NEW_CARDS';break;}
        }
        filters.push({rating,reason,pages,invalid:invalidCount});job.filters=filters;persist(job);
      }
      job.results.push({goodsId:id,filters,coverage:'partial',message:'已自动依次采集 1 星、2 星的可加载评论'});persist(job);
    }
    job.state='DONE';job.message='本批已结束，已自动采集 1 星和 2 星评论。点击商品下方“查看已采差评”。';
    }catch(e){job.state='PAUSED';job.message=e.message;}finally{active=false;persist(job);}
  }
  return {busy:()=>active,settled:()=>promise,status:()=>({running:active,job:latest()}),reviews(goodsId){if(!/^\d{5,20}$/.test(goodsId||''))throw Error('商品 ID 无效');return {goodsId,items:db.prepare('SELECT payload FROM opportunity_negative_reviews WHERE goods_id=? ORDER BY json_extract(payload,\'$.reviewDate\') DESC').all(goodsId).map(r=>JSON.parse(r.payload)),listingDate:null,listingDateBasis:'未获取可核实的上架时间',coverage:'仅已加载的 1～2 星评论，不代表全部评论或差评率'};},act(action,body={}){
    if(action==='pause'){if(!active)throw Error('当前没有运行中的评论任务');stop=true;return {ok:true};}
    if(active)throw Error('已有评论任务运行中');if(otherBusy())throw Error('截图队列正在控制 VMLogin，请先暂停并结束截图队列');
    let job;if(action==='start'){
      if(!Array.isArray(body.goodsIds)||!body.goodsIds.length||body.goodsIds.length>20||body.goodsIds.some(id=>typeof id!=='string'||!/^\d{5,20}$/.test(id)))throw Error('请选择 1～20 件机会商品');
      const ids=[...new Set(body.goodsIds)];for(const id of ids)if(!db.prepare('SELECT 1 FROM opportunities WHERE goods_id=? AND removed=0').get(id))throw Error('商品不在有效机会清单中');
      job={id:crypto.randomUUID(),state:'RUNNING',goodsIds:ids,index:0,inserted:0,results:[],transport:'vmlogin-api',ratings:[1,2]};
    }else if(action==='resume'){job=latest();if(job?.state!=='PAUSED')throw Error('没有可继续的评论任务');for(const id of job.goodsIds.slice(job.index))if(!db.prepare('SELECT 1 FROM opportunities WHERE goods_id=? AND removed=0').get(id))throw Error('待采商品已移除，请重新选择商品');}else throw Error('未知评论操作');
    promise=run(job);return {ok:true,id:job.id};
  }};
}
