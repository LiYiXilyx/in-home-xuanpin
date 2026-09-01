import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';

const MODEL_ID='APPLE_VISION_FEATURE_PRINT',REVISION=2;

export function createLocalVisualEmbeddingBackend({cacheRoot,sourcePath=path.resolve('tools/yingdao-vision-embed.swift'),compile=defaultCompile,execute=defaultExecute}={}) {
  const root=path.resolve(required(cacheRoot,'cacheRoot')),binary=path.join(root,'model-cache','vision-feature-print-r2');
  let prepared=null;
  async function prepare(){
    if(prepared)return prepared;
    try {
      const source=await fs.readFile(sourcePath),identity=sha256(Buffer.concat([source,Buffer.from(`${MODEL_ID}\0${REVISION}\0${process.platform}\0${process.arch}`)]));
      const stamp=`${binary}.sha256`;
      let current=null;try{current=(await fs.readFile(stamp,'utf8')).trim();}catch{}
      if(current!==identity){await fs.mkdir(path.dirname(binary),{recursive:true});await compile({sourcePath,binary});await fs.writeFile(stamp,`${identity}\n`);}
      prepared={model_id:MODEL_ID,model_revision:REVISION,model_version:`VISION_FEATURE_PRINT_R${REVISION}`,
        model_hash:identity,embedding_dimension:768,binary_path:binary,remote_calls:0};
      return prepared;
    } catch(error) {throw fault('LOCAL_VISUAL_EMBEDDING_BACKEND_UNAVAILABLE',error.message);}
  }
  return {
    info:prepare,
    async embedBatch(jobs){
      const info=await prepare(),rows=await execute({binary:info.binary_path,jobs});
      return rows.map(row=>{
        if(row.error||!row.embedding_base64) return {goods_id:String(row.goods_id),error:row.error??'VISION_EMPTY'};
        const bytes=Buffer.from(row.embedding_base64,'base64'),vector=[];
        for(let offset=0;offset<bytes.length;offset+=4)vector.push(bytes.readFloatLE(offset));
        const norm=Math.hypot(...vector);if(!(norm>0))return {goods_id:String(row.goods_id),error:'VISION_ZERO_VECTOR'};
        return {goods_id:String(row.goods_id),dimension:vector.length,vector:vector.map(value=>value/norm)};
      });
    },
  };
}

async function defaultCompile({sourcePath,binary}){
  await new Promise((resolve,reject)=>execFile('xcrun',['swiftc','-O','-framework','Vision','-framework','AppKit',sourcePath,'-o',binary],
    {env:{...process.env,CLANG_MODULE_CACHE_PATH:path.join(path.dirname(binary),'module-cache'),SWIFT_MODULE_CACHE_PATH:path.join(path.dirname(binary),'module-cache')},maxBuffer:10_000_000},
    (error,_stdout,stderr)=>error?reject(new Error(stderr||error.message)):resolve()));
}

async function defaultExecute({binary,jobs}){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,[],{stdio:['pipe','pipe','pipe'],shell:false});let stdout='',stderr='';
    child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
    child.once('error',reject);child.once('close',code=>code===0?resolve(stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))):reject(new Error(stderr||`vision exit ${code}`)));
    for(const job of jobs)child.stdin.write(`${JSON.stringify({goods_id:String(job.goods_id),path:path.resolve(job.path)})}\n`);child.stdin.end();
  });
}
function required(value,name){if(!value)throw new Error(`${name} required`);return String(value);}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function fault(code,message){return Object.assign(new Error(message),{code});}
