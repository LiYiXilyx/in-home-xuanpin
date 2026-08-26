import { operatorMessage } from './status-service.mjs';

export function createRouter({ statusService,browserController,jobController,reviewController,reviewQueueController,exportController,testController,serveStatic,
  environment={ name:'development',testMode:false },logError=console.error }) {
  return async function route(request,response) {
    const url=new URL(request.url,'http://127.0.0.1');
    try {
      if (request.method === 'OPTIONS' && (url.pathname.startsWith('/api/browser-extension/') || url.pathname.startsWith('/api/rpa/'))) return extensionCors(response,204);
      if (request.method === 'GET' && url.pathname === '/api/browser-extension/context') {
        return json(response,200,{ ok:true,context:reviewController.extensionContext(url.searchParams.get('goods_id')) },EXTENSION_CORS_HEADERS);
      }
      if (request.method === 'POST' && url.pathname === '/api/browser-extension/capture-page') {
        const body=await readJson(request,1_000_000);
        return json(response,200,{ ok:true,result:reviewController.captureExtensionPage(body) },EXTENSION_CORS_HEADERS);
      }
      if (request.method === 'POST' && url.pathname === '/api/browser-extension/capture-batch') {
        const body=await readJson(request,1_000_000);
        return json(response,200,{ ok:true,result:reviewController.captureExtensionBatch(body) },EXTENSION_CORS_HEADERS);
      }
      if (request.method === 'POST' && url.pathname === '/api/browser-extension/complete-scroll') {
        const body=await readJson(request,16_384);
        return json(response,200,{ ok:true,result:reviewController.finishExtensionScroll(body) },EXTENSION_CORS_HEADERS);
      }
      if (request.method === 'POST' && url.pathname === '/api/browser-extension/capture-failed') {
        const body=await readJson(request,16_384);
        return json(response,200,{ ok:true,result:reviewController.failExtensionCapture(body) },EXTENSION_CORS_HEADERS);
      }
      if (request.method === 'POST' && url.pathname === '/api/rpa/review-queue/enqueue') {
        const body=await readJson(request,64_000);
        return json(response,200,{ ok:true,result:reviewQueueController.enqueue(body) },EXTENSION_CORS_HEADERS);
      }
      if (request.method === 'GET' && url.pathname === '/api/rpa/review-queue') return json(response,200,{ ok:true,result:reviewQueueController.list(url.searchParams.get('job_id')) },EXTENSION_CORS_HEADERS);
      const queueItem=url.pathname.match(/^\/api\/rpa\/review-queue\/([^/]+)$/);
      if (request.method === 'GET' && queueItem) return json(response,200,{ ok:true,result:reviewQueueController.get(decodeURIComponent(queueItem[1])) },EXTENSION_CORS_HEADERS);
      if (request.method === 'POST' && url.pathname === '/api/rpa/review-queue/claim-next') {
        const body=await readJson(request);
        return json(response,200,{ ok:true,result:reviewQueueController.claimNext(body) },EXTENSION_CORS_HEADERS);
      }
      const navigationAction=url.pathname.match(/^\/api\/rpa\/review-queue\/([^/]+)\/navigation\/(resolve|verify)$/);
      if (request.method === 'POST' && navigationAction) {
        const body=await readJson(request,256_000);const id=decodeURIComponent(navigationAction[1]);
        const result=navigationAction[2] === 'resolve' ? reviewQueueController.resolveNavigation(id,body):reviewQueueController.verifyNavigation(id,body);
        return json(response,200,{ ok:true,result },EXTENSION_CORS_HEADERS);
      }
      const queueAction=url.pathname.match(/^\/api\/rpa\/review-queue\/([^/]+)\/(waiting-operator|fail|retry)$/);
      if (request.method === 'POST' && queueAction) {
        const body=await readJson(request);const id=decodeURIComponent(queueAction[1]);
        const result=queueAction[2] === 'waiting-operator' ? reviewQueueController.waitingOperator(id,body):queueAction[2] === 'fail' ? reviewQueueController.fail(id,body):reviewQueueController.retry(id);
        return json(response,200,{ ok:true,result },EXTENSION_CORS_HEADERS);
      }
      if (request.method === 'GET' && url.pathname === '/api/status') return json(response,200,await statusService.snapshot());
      if (request.method === 'GET' && url.pathname === '/api/health') return json(response,200,{ ok:true,environment:environment.name,testMode:environment.testMode });
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
      const reviewControl=url.pathname.match(/^\/api\/reviews\/([^/]+)\/(validate-session-recovery|resume)$/);
      if (request.method === 'POST' && reviewControl) {
        const jobId=decodeURIComponent(reviewControl[1]);
        if (reviewControl[2] === 'validate-session-recovery') return json(response,200,{ ok:true,validation:await reviewController.validateSessionRecovery(jobId) });
        return json(response,202,{ ok:true,job:reviewController.resume(jobId) });
      }
      if (request.method === 'POST' && url.pathname === '/api/export') return json(response,200,{ ok:true,result:await exportController.export() });
      if (request.method === 'POST' && url.pathname === '/api/open/excel') return json(response,200,{ ok:true,...await exportController.openExcel() });
      if (request.method === 'POST' && url.pathname === '/api/open/folder') return json(response,200,{ ok:true,...await exportController.openFolder() });
      if (request.method === 'POST' && url.pathname === '/api/clear/excel') {
        const body=await readJson(request);
        return json(response,200,{ ok:true,...await exportController.clearExcel({ confirmed:body.confirmed === true }) });
      }
      if (request.method === 'POST' && url.pathname === '/api/test/reset') {
        const body=await readJson(request);
        return json(response,200,{ ok:true,...await testController.reset({ confirmed:body.confirmed === true,phrase:body.phrase }) });
      }
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(url.pathname,response);
      return json(response,404,{ ok:false,error:{ code:'NOT_FOUND',message:'没有找到这个操作。' } });
    } catch (error) {
      logError(error?.stack ?? error);
      const headers=url.pathname.startsWith('/api/browser-extension/') || url.pathname.startsWith('/api/rpa/') ? EXTENSION_CORS_HEADERS:undefined;
      return json(response,statusFor(error?.code),{ ok:false,error:{ code:error?.code ?? 'OPERATION_FAILED',message:operatorMessage(error?.code,error?.message) } },headers);
    }
  };
}

async function readJson(request,maxBytes=16_384) {
  let body='';
  for await (const chunk of request) { body += chunk; if (body.length > maxBytes) throw Object.assign(new Error('请求内容过大。'),{ code:'REQUEST_TOO_LARGE' }); }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('请求格式无效。'),{ code:'INVALID_JSON' }); }
}
function statusFor(code) { if (code === 'JOB_NOT_FOUND' || code === 'REVIEW_QUEUE_NOT_FOUND') return 404; if (code === 'BROWSER_JOB_CONFLICT' || code === 'REVIEW_TASK_MISMATCH') return 409; return 400; }
const EXTENSION_CORS_HEADERS=Object.freeze({ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type' });
function extensionCors(response,status) { response.writeHead(status,{ ...EXTENSION_CORS_HEADERS,'Cache-Control':'no-store' });response.end(); }
function json(response,status,data,extraHeaders={}) { response.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extraHeaders }); response.end(JSON.stringify(data)); }
