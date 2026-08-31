import { operatorMessage } from './status-service.mjs';

export function createRouter({ statusService,browserController,jobController,reviewController,reviewQueueController,catalogController,exportController,testController,sourcingController,serveStatic,
  environment={ name:'development',testMode:false },logError=console.error }) {
  return async function route(request,response) {
    const url=new URL(request.url,'http://127.0.0.1');
    try {
      if (sourcingController && url.pathname.startsWith('/api/sourcing/')) {
        const mutation=['POST','PUT','PATCH','DELETE'].includes(request.method);
        if(mutation) assertLocalOrigin(request);
        if(request.method==='GET'&&url.pathname==='/api/sourcing/settings') return json(response,200,await sourcingController.settings());
        if(request.method==='PUT'&&url.pathname==='/api/sourcing/settings') return json(response,200,await sourcingController.saveSettings(await readJson(request,32_768)));
        if(request.method==='POST'&&url.pathname==='/api/sourcing/path-dialog') return json(response,200,await sourcingController.choosePath(await readJson(request)));
        if(request.method==='POST'&&url.pathname==='/api/sourcing/scan') return json(response,200,await sourcingController.scan(await readJson(request)));
        if(request.method==='POST'&&url.pathname==='/api/sourcing/imports') return json(response,202,await sourcingController.startImport(await readJson(request)));
        if(request.method==='GET'&&url.pathname==='/api/sourcing/imports/current') return json(response,200,await sourcingController.currentImport());
        const retry=url.pathname.match(/^\/api\/sourcing\/imports\/([^/]+)\/retry-failed-images$/);
        if(request.method==='POST'&&retry) return json(response,200,await sourcingController.retryFailedImages(decodeURIComponent(retry[1])));
        const imported=url.pathname.match(/^\/api\/sourcing\/imports\/([^/]+)$/);
        if(request.method==='GET'&&imported) return json(response,200,await sourcingController.getImport(decodeURIComponent(imported[1])));
      }
      if (request.method === 'OPTIONS' && (url.pathname.startsWith('/api/browser-extension/') || url.pathname.startsWith('/api/rpa/'))) return extensionCors(response,204);
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/catalog/')) return catalogCors(response,204);
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/catalog-rpa/')) return catalogCors(response,204);
      const poolProducts=url.pathname.match(/^\/api\/catalog\/pools\/([^/]+)\/products$/);
      if(request.method==='GET'&&poolProducts){const result=catalogController.poolProducts(decodeURIComponent(poolProducts[1]),url.searchParams);
        return json(response,200,{ok:true,...result},CATALOG_HEADERS);}
      if (request.method === 'GET' && url.pathname === '/api/catalog/operator/profiles') {
        const result=await catalogController.operatorProfiles();
        return json(response,200,{ ok:true,...result },CATALOG_HEADERS);
      }
      if (request.method === 'GET' && url.pathname === '/api/catalog/operator-campaign/current') {
        return json(response,200,{ ok:true,current:catalogController.operatorCurrent() },CATALOG_HEADERS);
      }
      if (request.method === 'POST' && url.pathname === '/api/catalog/operator-campaigns') {
        const result=await catalogController.createOperatorCampaign(await readJson(request,16_384));
        return json(response,result.idempotentReplay ? 200:201,{ ok:true,result:mapOperatorCampaignResult(result) },CATALOG_HEADERS);
      }
      if (request.method === 'POST' && url.pathname === '/api/catalog/operator/initial-campaigns') {
        const result=await catalogController.createOperatorInitialCampaign(await readJson(request,16_384));
        return json(response,result.idempotentReplay?200:201,{ok:true,result:mapInitialCampaignResult(result)},CATALOG_HEADERS);
      }
      const initialQa=url.pathname.match(/^\/api\/catalog\/operator\/initial-campaigns\/([^/]+)\/qa-runs$/);
      if(request.method==='POST'&&initialQa){const campaignId=decodeURIComponent(initialQa[1]);
        const result=await catalogController.runInitialPoolQa(campaignId,await readJson(request,16_384));
        return json(response,200,{ok:true,result:mapInitialQaResult(result)},CATALOG_HEADERS);}
      const initialActivation=url.pathname.match(/^\/api\/catalog\/operator\/initial-campaigns\/([^/]+)\/activate$/);
      if(request.method==='POST'&&initialActivation){const campaignId=decodeURIComponent(initialActivation[1]);
        const result=await catalogController.activateInitialPool(campaignId,await readJson(request,16_384));
        return json(response,200,{ok:true,result:mapInitialActivationResult(result)},CATALOG_HEADERS);}
      if (request.method === 'GET' && url.pathname === '/api/catalog-rpa/current-context') {
        return json(response,200,{ ok:true,context:catalogController.currentRpaContext() },CATALOG_HEADERS);
      }
      if (request.method === 'POST' && url.pathname === '/api/catalog-rpa/claim-next') {
        return json(response,200,{ ok:true,result:catalogController.claimNext(await readJson(request,16_384)) },CATALOG_HEADERS);
      }
      const catalogRpaAction=url.pathname.match(/^\/api\/catalog-rpa\/(source-opened|checkpoint|manual-required|resume|source-complete)$/);
      if (request.method === 'POST' && catalogRpaAction) {
        const body=await readJson(request,64_000);
        const handlers={ 'source-opened':'sourceOpened',checkpoint:'checkpoint','manual-required':'manualRequired',resume:'resume','source-complete':'sourceComplete' };
        return json(response,200,{ ok:true,result:catalogController[handlers[catalogRpaAction[1]]](body) },CATALOG_HEADERS);
      }
      const catalogExtensionAction=url.pathname.match(/^\/api\/catalog-extension\/(checkpoint|manual-required|resume)$/);
      if (request.method === 'POST' && catalogExtensionAction) {
        const body=await readJson(request,64_000);
        const handlers={ checkpoint:'extensionCheckpoint','manual-required':'extensionManualRequired',resume:'extensionResume' };
        return json(response,200,{ ok:true,result:catalogController[handlers[catalogExtensionAction[1]]](body) },CATALOG_HEADERS);
      }
      if (request.method === 'GET' && url.pathname === '/api/catalog/context') {
        return json(response,200,{ ok:true,context:catalogController.context(url.searchParams) },CATALOG_HEADERS);
      }
      if (request.method === 'POST' && url.pathname === '/api/catalog/batches') {
        const body=await readJson(request,1_000_000);
        return json(response,200,{ ok:true,result:catalogController.captureBatch(body) },CATALOG_HEADERS);
      }
      if (request.method === 'GET' && url.pathname === '/api/catalog/status') {
        return json(response,200,{ ok:true,result:catalogController.status(url.searchParams) },CATALOG_HEADERS);
      }
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
      if (request.method === 'GET' && url.pathname === '/api/rpa/review-queue/current') return json(response,200,{ ok:true,result:reviewQueueController.current() },EXTENSION_CORS_HEADERS);
      if (request.method === 'GET' && url.pathname === '/api/rpa/review-safety') return json(response,200,{ ok:true,result:reviewQueueController.safetyStatus(url.searchParams.get('job_id')) },EXTENSION_CORS_HEADERS);
      if (request.method === 'POST' && url.pathname === '/api/rpa/review-safety/recover') {
        const body=await readJson(request);return json(response,200,{ ok:true,result:reviewQueueController.recoverSafety(body) },EXTENSION_CORS_HEADERS);
      }
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
      const safetySignal=url.pathname.match(/^\/api\/rpa\/review-queue\/([^/]+)\/safety\/signal$/);
      if (request.method === 'POST' && safetySignal) {
        const body=await readJson(request);return json(response,200,{ ok:true,result:reviewQueueController.signalSafety(decodeURIComponent(safetySignal[1]),body) },EXTENSION_CORS_HEADERS);
      }
      const queueAction=url.pathname.match(/^\/api\/rpa\/review-queue\/([^/]+)\/(waiting-operator|fail|retry)$/);
      if (request.method === 'POST' && queueAction) {
        const body=await readJson(request);const id=decodeURIComponent(queueAction[1]);
        const result=queueAction[2] === 'waiting-operator' ? reviewQueueController.waitingOperator(id,body):queueAction[2] === 'fail' ? reviewQueueController.fail(id,body):reviewQueueController.retry(id);
        return json(response,200,{ ok:true,result },EXTENSION_CORS_HEADERS);
      }
      if (request.method === 'GET' && url.pathname === '/api/status') return json(response,200,await statusService.snapshot());
      if (request.method === 'GET' && url.pathname === '/api/health') return json(response,200,{
        ok:true,service:'temu-operator-dashboard',apiVersion:1,environment:environment.name,testMode:environment.testMode
      });
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
      const headers=url.pathname.startsWith('/api/catalog/') || url.pathname.startsWith('/api/catalog-rpa/') || url.pathname.startsWith('/api/catalog-extension/') ? CATALOG_HEADERS:
        url.pathname.startsWith('/api/browser-extension/') || url.pathname.startsWith('/api/rpa/') ? EXTENSION_CORS_HEADERS:undefined;
      return json(response,statusFor(error?.code),{ ok:false,error:{ code:error?.code ?? 'OPERATION_FAILED',message:operatorMessage(error?.code,error?.message) } },headers);
    }
  };
}

async function readJson(request,maxBytes=16_384) {
  let body='';
  for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body,'utf8') > maxBytes) throw Object.assign(new Error('请求内容过大。'),{ code:'REQUEST_TOO_LARGE' }); }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('请求格式无效。'),{ code:'INVALID_JSON' }); }
}
function statusFor(code) { if(code==='LOCAL_ORIGIN_REQUIRED')return 403;if (['JOB_NOT_FOUND','IMPORT_NOT_FOUND','REVIEW_QUEUE_NOT_FOUND','CATALOG_CAMPAIGN_NOT_FOUND','CATALOG_SOURCE_NOT_FOUND','CATALOG_RPA_QUEUE_NOT_FOUND','CATALOG_RPA_NOT_CLAIMED','CATEGORY_PROFILE_NOT_FOUND','CATALOG_POOL_NOT_FOUND'].includes(code)) return 404; if (['RUN_ID_CONFLICT','IMPORT_IN_PROGRESS','SCAN_STALE','BROWSER_JOB_CONFLICT','REVIEW_TASK_MISMATCH','CATALOG_BATCH_IDEMPOTENCY_CONFLICT','CAMPAIGN_NOT_ACTIVE','CATALOG_RPA_CLAIM_CONFLICT','CATALOG_RPA_CLAIM_MISMATCH','CATALOG_RPA_CONTEXT_AMBIGUOUS','CAMPAIGN_NAME_CONFLICT','OPERATOR_CREATE_IDEMPOTENCY_CONFLICT','CATEGORY_PROFILE_VERSION_MISMATCH','INITIAL_QA_REQUEST_CONFLICT','INITIAL_ACTIVATION_REQUEST_CONFLICT','INITIAL_POOL_ACTIVATION_IN_PROGRESS','INITIAL_POOL_ALREADY_EXISTS','INITIAL_POOL_HISTORY_EXISTS','CATALOG_POOL_SCOPE_MISMATCH'].includes(code)) return 409; return 400; }
function mapOperatorCampaignResult(result) {
  return { campaign_id:result.campaignId,category_key:result.categoryKey,
    category_profile_version:result.categoryProfileVersion,campaign_name:result.campaignName,
    baseline_count:result.baselineCount,requested_new_count:result.requestedNewCount,target_count:result.targetCount,
    capture_mode:result.captureMode,current_unique:result.currentUnique,remaining:result.remaining,status:result.status,
    binding_status:result.bindingStatus,idempotent_replay:result.idempotentReplay };
}
function mapInitialCampaignResult(result){return{campaign_id:result.campaignId,campaign_type:'initial',category_key:result.categoryKey,
  category_profile_version:result.categoryProfileVersion,campaign_name:result.campaignName,baseline_count:0,
  target_count:null,remaining:null,target_reached:null,quantity_mode:'OPEN_ENDED',capture_limit:null,
  capture_mode:result.captureMode,current_unique:result.currentUnique,status:result.status,
  binding_status:result.bindingStatus,idempotent_replay:result.idempotentReplay};}
function mapInitialQaResult(result){return{qa_run_id:result.qaRunId,qa_status:result.status,
  live_unique_count:result.liveUniqueCount,qa_candidate_count:result.qaCandidateCount,
  unreviewed_delta:result.unreviewedDelta,checks:result.checks??[],failure_codes:result.failureCodes??[],
  duration_ms:result.durationMs??null,idempotent_replay:result.idempotentReplay};}
function mapInitialActivationResult(result){return{pool_version_id:result.poolVersionId,category_key:result.categoryKey,
  pool_count:result.productCount,status:result.status,activated_at:result.activatedAt,
  source_campaign_id:result.sourceCampaignId,idempotent_replay:result.idempotentReplay};}
export function assertLocalOrigin(request) {
  const hostHeader=String(request.headers.host??'').toLowerCase();
  const host=hostname(hostHeader);
  const originHeader=request.headers.origin;
  let origin=null;
  try { origin=originHeader?new URL(originHeader):null; } catch {}
  if(!isLocal(host)||!origin||origin.protocol!=='http:'||!isLocal(origin.hostname)||origin.host.toLowerCase()!==hostHeader) {
    const error=new Error('mutation requests require a local Host and Origin');error.code='LOCAL_ORIGIN_REQUIRED';throw error;
  }
}
function hostname(value) {
  if(!value)return null;
  try{return new URL(`http://${value}`).hostname;}catch{return null;}
}
function isLocal(value) { return value==='localhost'||value==='127.0.0.1'; }
const EXTENSION_CORS_HEADERS=Object.freeze({ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type' });
const CATALOG_HEADERS=Object.freeze({ 'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type' });
function extensionCors(response,status) { response.writeHead(status,{ ...EXTENSION_CORS_HEADERS,'Cache-Control':'no-store' });response.end(); }
function catalogCors(response,status) { response.writeHead(status,{ ...CATALOG_HEADERS,'Cache-Control':'no-store' });response.end(); }
function json(response,status,data,extraHeaders={}) { response.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extraHeaders }); response.end(JSON.stringify(data)); }
