import path from 'node:path';
import { AppError } from '../../shared/errors.mjs';
import { browserMode,configuredCdpEndpoint,isCdpReady,openBrowserSession,connectOperatorSession,closeBrowserSession } from '../../browser/cdp-session.mjs';
import { requireCurrentOperatorTemuPage } from '../../browser/operator-page.mjs';
import { createFreshBrowserProfile,saveBrowserRuntime } from '../../browser/profile-manager.mjs';
import { inspectCurrentPageHealth,profileHealthWarning } from '../../modules/catalog/page-health.mjs';

export function createBrowserController(config,{
  openSession=openBrowserSession,connectSession=connectOperatorSession,ready=isCdpReady,currentPage=requireCurrentOperatorTemuPage,
  inspectPage=inspectCurrentPageHealth,createFresh=createFreshBrowserProfile,saveRuntime=saveBrowserRuntime
}={}) {
  let session=null;
  let lastValidation=null;
  let observations=[];
  const mode=() => browserMode(config);
  const modeLabel=() => mode() === 'external_cdp' ? 'External Chrome':'Managed Chrome';
  const profileName=() => mode() === 'external_cdp' ? '不适用':path.basename(config.browser.profileDir);
  const displayPort=() => endpointPort(configuredCdpEndpoint(config)) ?? Number(config.browser.debugPort ?? 9227);
  async function validate() {
    const endpointReady=await ready(configuredCdpEndpoint(config),{ timeoutMs:900 });
    const explicitlyConnected=mode() !== 'external_cdp' || Boolean(session);
    if (!endpointReady || !explicitlyConnected) {
      const code=!endpointReady ? 'CDP_UNREACHABLE':'EXTERNAL_CDP_NOT_CONNECTED';
      return remember({ status:'NOT_READY',code,checks:{ CDP_CONNECTED:false,TEMU_PAGE:false,
      LOGIN_STATUS:'UNKNOWN',COUNTRY:'UNKNOWN',LANGUAGE:'UNKNOWN',CURRENCY:'UNKNOWN',PRODUCT_LIST_VISIBLE:false,
      CATEGORY_CONFIRMED:false,TOP_SALES_CONFIRMED:false,PAGE_HEALTH:code } });
    }
    try {
      session=session ?? await connectSession(config);
      const page=await currentPage(session.context);
      const result=await inspectPage(page,config,config.catalog.jobs[0]);
      result.diagnostics={ ...(result.diagnostics ?? {}),tabs:await safeTabDiagnostics(session.context,page) };
      return remember(result);
    } catch (error) {
      return remember({ status:'NOT_READY',code:error?.code ?? 'PAGE_VALIDATION_FAILED',checks:{ CDP_CONNECTED:true,TEMU_PAGE:false,
        LOGIN_STATUS:'UNKNOWN',COUNTRY:'UNKNOWN',LANGUAGE:'UNKNOWN',CURRENCY:'UNKNOWN',PRODUCT_LIST_VISIBLE:false,
        CATEGORY_CONFIRMED:false,TOP_SALES_CONFIRMED:false,PAGE_HEALTH:error?.code ?? 'PAGE_VALIDATION_FAILED' } });
    }
  }
  function remember(result) {
    observations.push({ code:result.code,query:result.query,homeHealthy:Boolean(result.homeHealthy) });
    observations=observations.slice(-20);
    lastValidation={ ...result,profileWarning:profileHealthWarning(observations),checkedAt:new Date().toISOString() };
    return publicValidation(lastValidation);
  }
  return {
    async status() {
      const endpointAvailable=await ready(configuredCdpEndpoint(config),{ timeoutMs:900 });
      return { connected:mode() === 'external_cdp' ? Boolean(session) && endpointAvailable:endpointAvailable,endpointAvailable,
        mode:mode(),modeLabel:modeLabel(),port:displayPort(),profileName:profileName(),pageHealth:lastValidation ? publicValidation(lastValidation):null };
    },
    async open() {
      if (mode() !== 'managed_profile') throw new AppError('External Chrome 模式不会打开或管理浏览器，请点击“连接已有 Chrome”。',{ code:'BROWSER_MODE_EXTERNAL' });
      if (await ready(configuredCdpEndpoint(config),{ timeoutMs:900 })) return { connected:true,alreadyOpen:true,profileName:profileName(),port:Number(config.browser.debugPort),message:'采集 Chrome 已经打开。' };
      session=await openSession(config);
      lastValidation=null;
      return { connected:true,alreadyOpen:false,profileName:profileName(),port:Number(config.browser.debugPort),message:'采集 Chrome 已打开，请人工登录并准备 Top Sales 页面。' };
    },
    async connectExisting() {
      if (mode() !== 'external_cdp') throw new AppError('当前是 Managed Chrome 模式，请使用“打开采集 Chrome”。',{ code:'BROWSER_MODE_MANAGED' });
      if (!await ready(configuredCdpEndpoint(config),{ timeoutMs:900 })) {
        throw new AppError('无法连接已有 Chrome。请确认 Chrome 已开启 CDP，并检查配置的 endpoint。',{ code:'CDP_UNREACHABLE',retriable:true });
      }
      const alreadyOpen=Boolean(session);
      session=session ?? await connectSession(config);
      lastValidation=null;observations=[];
      return { connected:true,alreadyOpen,mode:mode(),modeLabel:modeLabel(),profileName:profileName(),port:displayPort(),
        message:'已连接已有 Chrome。系统只读取当前页面，不会关闭或修改用户 Chrome。' };
    },
    async createFresh() {
      if (mode() !== 'managed_profile') throw new AppError('External Chrome 模式不会创建 profile，请由运营人员准备 Chrome 后点击连接。',{ code:'BROWSER_MODE_EXTERNAL' });
      const fresh=await createFresh(config);
      const freshConfig={ ...config,browser:{ ...config.browser,profileDir:fresh.profileDir,debugPort:fresh.debugPort,cdpEndpoint:'' } };
      const freshSession=await openSession(freshConfig);
      config.browser.profileDir=fresh.profileDir;config.browser.debugPort=fresh.debugPort;config.browser.cdpEndpoint='';
      await saveRuntime(config);
      session=freshSession;lastValidation=null;observations=[];
      return { connected:true,profileName:fresh.profileName,port:fresh.debugPort,
        message:`新的采集 Chrome 已创建：${fresh.profileName}。旧 profile 已保留，请重新人工登录 Temu。` };
    },
    validate,
    async assertReady() {
      const result=await validate();
      if (result.status !== 'READY') throw new AppError('当前页面尚未通过验证，禁止开始采集。',{ code:result.code ?? 'PAGE_NOT_READY',retriable:true,details:{ status:result.status } });
      return result;
    },
    async closeConnection() { await closeBrowserSession(session,config); session=null; }
  };
}

function endpointPort(endpoint) {
  try { const value=new URL(endpoint);return value.port ? Number(value.port):(value.protocol === 'https:' ? 443:80); }
  catch { return null; }
}

async function safeTabDiagnostics(context,selectedPage) {
  const result=[];
  const pages=typeof context?.pages === 'function' ? context.pages():[];
  for (const [index,page] of pages.filter(item => !item.isClosed()).entries()) {
    const url=safeUrl(page.url());
    const visible=await page.evaluate(() => document.visibilityState === 'visible').catch(() => false);
    result.push({ index:index+1,selected:page === selectedPage,visible,host:url?.host ?? '',path:url?.pathname ?? '',
      queryParamNames:url ? Array.from(new Set(url.searchParams.keys())).slice(0,20):[],title:String(await page.title().catch(() => '')).slice(0,120) });
  }
  return result;
}
function safeUrl(value) { try { return new URL(value); } catch { return null; } }

function publicValidation(value) {
  if (!value) return null;
  return { status:value.status,code:value.code,checks:value.checks,productLinkCount:value.productLinkCount ?? 0,
    diagnostics:value.diagnostics ?? null,profileWarning:value.profileWarning ?? null,checkedAt:value.checkedAt ?? null };
}
