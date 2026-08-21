import { operatorMessage } from './status-service.mjs';

export function createRouter({ statusService,browserController,jobController,exportController,serveStatic,logError=console.error }) {
  return async function route(request,response) {
    const url=new URL(request.url,'http://127.0.0.1');
    try {
      if (request.method === 'GET' && url.pathname === '/api/status') return json(response,200,await statusService.snapshot());
      if (request.method === 'GET' && url.pathname === '/api/health') return json(response,200,{ ok:true });
      if (request.method === 'POST' && url.pathname === '/api/browser/open') return json(response,200,{ ok:true,...await browserController.open() });
      if (request.method === 'POST' && url.pathname === '/api/browser/connect') return json(response,200,{ ok:true,...await browserController.connectExisting() });
      if (request.method === 'POST' && url.pathname === '/api/browser/new') return json(response,200,{ ok:true,...await browserController.createFresh() });
      if (request.method === 'POST' && url.pathname === '/api/browser/validate') return json(response,200,{ ok:true,validation:await browserController.validate() });
      if (request.method === 'POST' && url.pathname === '/api/jobs/start') {
        const body=await readJson(request);
        await browserController.assertReady();
        return json(response,202,{ ok:true,job:jobController.start(body.targetCount) });
      }
      const control=url.pathname.match(/^\/api\/jobs\/([^/]+)\/(pause|resume|cancel|retry)$/);
      if (request.method === 'POST' && control) return json(response,202,{ ok:true,job:jobController[control[2]](decodeURIComponent(control[1])) });
      if (request.method === 'POST' && url.pathname === '/api/export') return json(response,200,{ ok:true,result:await exportController.export() });
      if (request.method === 'POST' && url.pathname === '/api/open/excel') return json(response,200,{ ok:true,...await exportController.openExcel() });
      if (request.method === 'POST' && url.pathname === '/api/open/folder') return json(response,200,{ ok:true,...await exportController.openFolder() });
      if (request.method === 'POST' && url.pathname === '/api/clear/excel') {
        const body=await readJson(request);
        return json(response,200,{ ok:true,...await exportController.clearExcel({ confirmed:body.confirmed === true }) });
      }
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(url.pathname,response);
      return json(response,404,{ ok:false,error:{ code:'NOT_FOUND',message:'没有找到这个操作。' } });
    } catch (error) {
      logError(error?.stack ?? error);
      return json(response,statusFor(error?.code),{ ok:false,error:{ code:error?.code ?? 'OPERATION_FAILED',message:operatorMessage(error?.code,error?.message) } });
    }
  };
}

async function readJson(request) {
  let body='';
  for await (const chunk of request) { body += chunk; if (body.length > 16_384) throw Object.assign(new Error('请求内容过大。'),{ code:'REQUEST_TOO_LARGE' }); }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('请求格式无效。'),{ code:'INVALID_JSON' }); }
}
function statusFor(code) { if (code === 'JOB_NOT_FOUND') return 404; if (code === 'BROWSER_JOB_CONFLICT') return 409; return 400; }
function json(response,status,data) { response.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff' }); response.end(JSON.stringify(data)); }
