const dayFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const fields=['price_amount','currency','sales_count','review_count','rating'];
export function sameDailyReading(a,b){
 if(!a||!b||a.is_baseline||b.is_baseline)return false;
 const at=Date.parse(a.observed_at??a.last_seen_at),bt=Date.parse(b.observed_at??b.last_seen_at);
 return Number.isFinite(at)&&Number.isFinite(bt)&&dayFormat.format(at)===dayFormat.format(bt)&&fields.every(k=>(a[k]??null)===(b[k]??null));
}
export function compactObservations(rows){const result=[],last=new Map();for(const row of rows){const prior=last.get(row.goods_id);if(!sameDailyReading(prior,row)){result.push(row);last.set(row.goods_id,row);}}return result;}
