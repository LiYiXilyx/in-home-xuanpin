import fs from 'node:fs/promises';
import path from 'node:path';

const CONTENT_TYPES={ '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml' };

export function createStaticServer(uiDir) {
  const root=path.resolve(uiDir);
  return async function serveStatic(pathname,response) {
    const relative=pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const target=path.resolve(root,relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return end(response,403,'禁止访问。');
    try {
      const data=await fs.readFile(target);
      response.writeHead(200,{ 'Content-Type':CONTENT_TYPES[path.extname(target)] ?? 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff' });
      response.end(data);
    } catch (error) { end(response,error.code === 'ENOENT' ? 404 : 500,'未找到页面。'); }
  };
}

function end(response,status,message) { response.writeHead(status,{ 'Content-Type':'text/plain; charset=utf-8' }); response.end(message); }
