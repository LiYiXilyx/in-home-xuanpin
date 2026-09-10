import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
const decode=s=>String(s??'').replace(/&#(x[0-9a-f]+|\d+);|&(lt|gt|amp|quot|apos);/gi,(_,n,e)=>n?String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n)):({lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"}[e]));
const attr=(s,key)=>decode(s.match(new RegExp('\\b'+key+'="([^"]*)"'))?.[1]);
const texts=s=>[...s.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m=>decode(m[1])).join('');
export async function readXlsxValues(file,sheetName){
  const zip=await JSZip.loadAsync(await fs.readFile(file));
  const read=async name=>{const f=zip.file(name);if(!f)throw Error('工作簿缺少 '+name);return f.async('string');};
  const workbook=await read('xl/workbook.xml');
  const tag=[...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?\s*>/g)].map(m=>m[0]).find(t=>attr(t,'name')===sheetName);
  if(!tag)throw Error('工作簿缺少 '+sheetName);
  const rid=attr(tag,'r:id');const rels=await read('xl/_rels/workbook.xml.rels');
  const rel=[...rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)].map(m=>m[0]).find(t=>attr(t,'Id')===rid);
  const target=attr(rel??'','Target');if(!target)throw Error('工作表关系无效');
  const part=target.startsWith('/')?target.slice(1):path.posix.normalize('xl/'+target);
  const shared=zip.file('xl/sharedStrings.xml')?[...(await read('xl/sharedStrings.xml')).matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m=>texts(m[1])):[];
  const xml=await read(part),rows=[];
  for(const m of xml.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)){
    const ref=attr(m[1],'r').match(/^([A-Z]+)(\d+)$/);if(!ref)continue;
    const col=[...ref[1]].reduce((a,c)=>a*26+c.charCodeAt(0)-64,0)-1,row=Number(ref[2])-1;
    const type=attr(m[1],'t'),body=m[2]??'',raw=decode(body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1]);
    const value=type==='s'?shared[Number(raw)]:type==='inlineStr'?texts(body):type==='b'?raw==='1':type==='str'||type==='e'?raw:raw!==''&&Number.isFinite(Number(raw))?Number(raw):null;
    (rows[row]??=[])[col]=value;
  }
  return Array.from(rows,row=>row??[]);
}
