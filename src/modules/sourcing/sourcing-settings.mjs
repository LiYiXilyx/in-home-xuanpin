import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

export function createSourcingSettings({settingsPath}={}) {
  if(!settingsPath) throw new TypeError('settingsPath is required');
  const resolved=path.resolve(settingsPath);
  async function load() {
    try { return normalize(JSON.parse(await fs.readFile(resolved,'utf8'))); }
    catch(error) { if(error?.code==='ENOENT') return normalize({}); throw error; }
  }
  async function save(value) {
    const normalized=normalize(value);
    await fs.mkdir(path.dirname(resolved),{recursive:true});
    const temporary=`${resolved}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try { await fs.writeFile(temporary,`${JSON.stringify(normalized,null,2)}\n`,{encoding:'utf8',mode:0o600});await fs.rename(temporary,resolved); }
    finally { await fs.rm(temporary,{force:true}).catch(()=>{}); }
    return normalized;
  }
  return {load,save,path:resolved};
}

function normalize(value) {
  return {
    sourceDir:text(value?.sourceDir),imageCacheDir:text(value?.imageCacheDir),
    selectedWorkbookPath:text(value?.selectedWorkbookPath),
  };
}
function text(value) { return typeof value==='string'&&value.trim()?path.resolve(value.trim()):null; }
