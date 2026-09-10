export function itemCaptureFailure(message){return Object.assign(new Error(message),{code:'ITEM_CAPTURE_UNAVAILABLE'});}
export async function runQueueItems(items,runItem,onItemFailure){
 for(const item of items){try{await runItem(item);}catch(error){
  if(error?.code!=='ITEM_CAPTURE_UNAVAILABLE')throw error;
  await onItemFailure(item,error);
 }}
}
export function queueItemProgress(report,item,active=false){
 const rows=(report.results||[]).filter(r=>r.anchor===item.anchor&&r.query===item.query);
 const summary=report.summaries?.find(r=>r.anchor===item.anchor&&r.query===item.query);
 const current=report.current?.anchor===item.anchor;
 const label=summary?.reason==='TARGET_REACHED'?'已完成':summary?.reason==='ITEM_FAILED'?'本商品已跳过，保留已有截图':summary?'已结束，数量不足':active?(current?'运行中':'等待运行'):rows.length?'已中断，保留部分截图':'未开始（队列已停止）';
 return {label,diagnostic:summary?.diagnostic??null,error:(summary?.error||(current?report.error:null)||null)?.replace('No safe stable product region','等待商品截图区域超时（旧记录未保存更细的原因）')??null,finished:summary?.finished||(!active&&(summary||rows.length)?report.finished:null)||null,screens:rows.length,count:new Set(rows.flatMap(r=>r.items)).size,ids:rows.map(r=>r.id)};
}
