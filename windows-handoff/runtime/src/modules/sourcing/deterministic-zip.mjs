import fs from 'node:fs';
import path from 'node:path';

const CRC_TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k+=1)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(buffer){let c=0xffffffff;for(const byte of buffer)c=CRC_TABLE[(c^byte)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;};

export function createDeterministicZip(outputPath,entries){
  const sorted=[...entries].map(e=>({name:e.name.replaceAll('\\','/'),data:Buffer.isBuffer(e.data)?e.data:Buffer.from(e.data)})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  const seen=new Set(),locals=[],centrals=[];let offset=0;
  for(const entry of sorted){
    if(entry.name.startsWith('/')||entry.name.split('/').includes('..')||seen.has(entry.name))throw new Error(`ZIP 路径无效或重复：${entry.name}`);seen.add(entry.name);
    const name=Buffer.from(entry.name,'utf8'),crc=crc32(entry.data);
    const local=Buffer.concat([u32(0x04034b50),u16(20),u16(0x800),u16(0),u16(0),u16(0x21),u32(crc),u32(entry.data.length),u32(entry.data.length),u16(name.length),u16(0),name,entry.data]);
    const central=Buffer.concat([u32(0x02014b50),u16(20),u16(20),u16(0x800),u16(0),u16(0),u16(0x21),u32(crc),u32(entry.data.length),u32(entry.data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);
    locals.push(local);centrals.push(central);offset+=local.length;
  }
  const centralSize=centrals.reduce((n,b)=>n+b.length,0),end=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(sorted.length),u16(sorted.length),u32(centralSize),u32(offset),u16(0)]);
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,Buffer.concat([...locals,...centrals,end]));return {outputPath:path.resolve(outputPath),entryCount:sorted.length,size:fs.statSync(outputPath).size};
}

export function readStoredZip(zipPath){
  const source=fs.readFileSync(zipPath),entries=new Map();let cursor=0;
  while(cursor+4<=source.length&&source.readUInt32LE(cursor)===0x04034b50){
    const method=source.readUInt16LE(cursor+8),size=source.readUInt32LE(cursor+18),nameLength=source.readUInt16LE(cursor+26),extraLength=source.readUInt16LE(cursor+28);
    if(method!==0)throw new Error('审计器只接受本系统生成的 STORE ZIP。');
    const name=source.subarray(cursor+30,cursor+30+nameLength).toString('utf8'),start=cursor+30+nameLength+extraLength,end=start+size;
    if(name.startsWith('/')||name.split('/').includes('..')||entries.has(name)||end>source.length)throw new Error(`ZIP 条目无效：${name}`);
    const data=source.subarray(start,end),expected=source.readUInt32LE(cursor+14);if(crc32(data)!==expected)throw new Error(`ZIP CRC 错误：${name}`);
    entries.set(name,data);cursor=end;
  }
  if(entries.size===0)throw new Error('ZIP 不含任何文件。');return entries;
}
