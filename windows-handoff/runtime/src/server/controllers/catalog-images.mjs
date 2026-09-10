import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
let busy=false;
export async function exportCatalogImages(outputDir,fileName,destination=null){
 if(busy)throw Error('已有图片导出正在进行');
 if(typeof fileName!=='string'||path.basename(fileName)!==fileName||!/^catalog-.*\.xlsx$/.test(fileName))throw Error('请先导出商品 Excel');
 busy=true;
 try{
 const input=JSON.parse(await fs.readFile(path.join(outputDir,fileName+'.images.json'),'utf8'));
 const folder=path.join(destination||outputDir,fileName.slice(0,-5)+'-jpg-'+Date.now());await fs.mkdir(folder,{recursive:true});
 const results=[];let bytes=0;
 for(const row of input){
 const item={goods_id:row.goods_id,status:'failed'};
 try{
 if(!/^\d+$/.test(String(row.goods_id)))throw Error('商品ID无效');
 const url=new URL(row.image_url);if(url.protocol!=='https:'||!(url.hostname==='img.kwcdn.com'||url.hostname.endsWith('.kwcdn.com')))throw Error('图片链接缺失或非支持的图片域名');
 if(bytes>=20*1024*1024)throw Error('达到本次20MB流量上限');
 const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);
 const parts=[];let size=0;for await(const part of r.body){size+=part.length;bytes+=part.length;if(size>5*1024*1024||bytes>20*1024*1024)throw Error('图片或批次超过流量上限');parts.push(part);}
 const b=Buffer.concat(parts);const ext=b[0]===255&&b[1]===216?'jpg':b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'?'webp':b.toString('ascii',4,8)==='ftyp'&&/avif|avis/.test(b.toString('ascii',8,32))?'avif':null;
 if(!ext)throw Error('返回内容不是支持的图片');
 const jpg=await sharp(b,{limitInputPixels:40000000}).rotate().flatten({background:'#ffffff'}).jpeg({quality:90}).toBuffer();item.file=row.goods_id+'.jpg';await fs.writeFile(path.join(folder,item.file),jpg);item.status='saved';
 }catch(e){item.error=e.message;}results.push(item);
 }
 await fs.writeFile(path.join(folder,'图片导出清单.json'),JSON.stringify({source:fileName,bytes,results},null,2));
 return {folder,total:results.length,saved:results.filter(r=>r.status==='saved').length,failed:results.filter(r=>r.status!=='saved').length};
 }finally{busy=false;}
}
