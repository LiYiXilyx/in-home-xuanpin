export const FINE_CLASSIFIER_ENV=Object.freeze({
  enabled:'TEMU_FINE_CLASSIFIER_ENABLED',provider:'TEMU_FINE_CLASSIFIER_PROVIDER',model:'TEMU_FINE_CLASSIFIER_MODEL',
  apiKey:'TEMU_FINE_CLASSIFIER_API_KEY',baseUrl:'TEMU_FINE_CLASSIFIER_BASE_URL'
});

export function resolveFineClassifierRuntime(aiConfig={},env=process.env) {
  const requestedEnabled=env[FINE_CLASSIFIER_ENV.enabled] === undefined ? Boolean(aiConfig.enabled) : parseBoolean(env[FINE_CLASSIFIER_ENV.enabled]);
  const provider=String(env[FINE_CLASSIFIER_ENV.provider] ?? aiConfig.provider ?? '').trim();
  const model=String(env[FINE_CLASSIFIER_ENV.model] ?? aiConfig.model ?? '').trim();
  const baseUrl=String(env[FINE_CLASSIFIER_ENV.baseUrl] ?? aiConfig.baseUrl ?? '').trim();
  const apiKey=String(env[FINE_CLASSIFIER_ENV.apiKey] ?? '').trim();
  let disabledReason=null;
  if (!requestedEnabled) disabledReason='AI_DISABLED';
  else if (!apiKey && provider !== 'mock') disabledReason='MISSING_API_KEY';
  else if (!provider || !model || (!baseUrl && provider !== 'mock')) disabledReason='CONFIG_INCOMPLETE';
  return { requestedEnabled,enabled:disabledReason === null,disabledReason,provider,model,modelVersion:String(aiConfig.modelVersion || model),baseUrl,timeoutMs:Number(aiConfig.timeoutMs ?? 30000),apiKey };
}

export function createFineClassificationProvider(runtime,{ fetchImpl=globalThis.fetch,mockResponder }={}) {
  if (runtime.provider === 'mock') return { invoke:async request => invokeMock(request,mockResponder) };
  if (runtime.provider !== 'openai-compatible') return { invoke:async () => failure('provider_error',`Unsupported provider: ${runtime.provider}`) };
  return { invoke:request => invokeOpenAiCompatible(runtime,request,fetchImpl) };
}

async function invokeMock(request,responder) {
  try {
    const raw=typeof responder === 'function' ? await responder(request) : responder;
    return { ok:true,raw };
  } catch (error) {
    return failure(error?.name === 'AbortError' ? 'timeout' : 'provider_error',error?.message);
  }
}

async function invokeOpenAiCompatible(runtime,request,fetchImpl) {
  const controller=new AbortController();
  const timeout=setTimeout(() => controller.abort(),runtime.timeoutMs);
  try {
    const response=await fetchImpl(endpoint(runtime.baseUrl),{
      method:'POST',signal:controller.signal,
      headers:{ 'content-type':'application/json',authorization:`Bearer ${runtime.apiKey}` },
      body:JSON.stringify({ model:runtime.model,temperature:0,response_format:{ type:'json_object' },messages:[{ role:'system',content:request.system },{ role:'user',content:request.user }] })
    });
    if (!response?.ok) return failure('provider_error',`HTTP ${response?.status ?? 'unknown'}`);
    const payload=await response.json();
    return { ok:true,raw:payload?.choices?.[0]?.message?.content ?? payload?.output_text ?? payload?.output };
  } catch (error) {
    return failure(error?.name === 'AbortError' ? 'timeout' : 'provider_error',error?.message);
  } finally { clearTimeout(timeout); }
}

function endpoint(baseUrl) { const trimmed=String(baseUrl).replace(/\/$/,'');return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/v1/chat/completions`; }
function failure(failureCode,message) { return { ok:false,failureCode,message:String(message ?? failureCode) }; }
function parseBoolean(value) { return ['1','true','yes','on'].includes(String(value).trim().toLowerCase()); }
