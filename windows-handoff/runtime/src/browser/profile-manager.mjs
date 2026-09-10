import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export async function createFreshBrowserProfile(config,options={}) {
  const now=options.now?.() ?? new Date();
  const mkdir=options.mkdir ?? fs.mkdir;
  const available=options.portAvailable ?? portAvailable;
  const parent=path.dirname(config.browser.profileDir);
  const stamp=now.toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\.\d{3}Z$/,'');
  const baseName=`browser-profile-fresh-${stamp}`;
  let profileDir;
  for (let suffix=0;suffix<100;suffix+=1) {
    const name=suffix === 0 ? baseName : `${baseName}-${suffix}`;
    profileDir=path.join(parent,name);
    try { await mkdir(profileDir,{ recursive:false });break; }
    catch (error) { if (error.code !== 'EEXIST' || suffix === 99) throw error; }
  }
  const debugPort=await findAvailablePort(Number(config.browser.debugPort ?? 9227)+1,{ available });
  return { profileDir,profileName:path.basename(profileDir),debugPort };
}
export async function saveBrowserRuntime(config) {
  const target=runtimeStatePath(config);
  await fs.mkdir(path.dirname(target),{ recursive:true });
  await fs.writeFile(target,JSON.stringify({
    profileDir:config.browser.profileDir,debugPort:Number(config.browser.debugPort),updatedAt:new Date().toISOString()
  },null,2),'utf8');
  return target;
}

export function runtimeStatePath(config) {
  return path.join(path.dirname(config.app.databasePath),'browser-runtime.json');
}

export async function findAvailablePort(start,{ available=portAvailable }={}) {
  for (let port=Math.max(1024,Number(start));port<=65535;port+=1) if (await available(port)) return port;
  throw Object.assign(new Error('没有找到可用的 Chrome 调试端口。'),{ code:'CDP_PORT_UNAVAILABLE' });
}

export function portAvailable(port) {
  return new Promise(resolve => {
    const server=net.createServer();
    server.unref();
    server.once('error',() => resolve(false));
    server.listen({ host:'127.0.0.1',port,exclusive:true },() => server.close(() => resolve(true)));
  });
}
