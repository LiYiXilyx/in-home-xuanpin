import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function prepareShadowbotImages(goods,batchDir){
  const result=[];
  for(const row of goods){
    const id=String(row.goods_id);if(!/^\d+$/.test(id))throw Error('商品编号无效');
    const url=new URL(row.image_url);if(url.protocol!=='https:'||!/(^|\.)kwcdn\.com$/.test(url.hostname))throw Error('商品 '+id+' 缺少有效图片链接');
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('商品 '+id+' 图片下载失败：HTTP '+response.status);
    const parts=[];let size=0;for await(const part of response.body){size+=part.length;if(size>5*1024*1024)throw Error('商品图片超过5MB');parts.push(part);}
    const jpg=await sharp(Buffer.concat(parts),{limitInputPixels:40000000}).rotate().flatten({background:'#fff'}).jpeg({quality:90}).toBuffer();
    const relative='images/'+id+'.jpg';await fs.writeFile(path.join(batchDir,relative),jpg);result.push({goods_id:id,image_path:relative});
  }
  return result;
}
