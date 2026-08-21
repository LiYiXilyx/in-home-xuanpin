import { configuredCdpEndpoint,isCdpReady,openBrowserSession,closeBrowserSession } from '../../browser/cdp-session.mjs';

export function createBrowserController(config,{ openSession=openBrowserSession,ready=isCdpReady }={}) {
  let session=null;
  return {
    async status() { return { connected:await ready(configuredCdpEndpoint(config),{ timeoutMs:900 }),port:Number(config.browser.debugPort ?? 9227) }; },
    async open() {
      if (await ready(configuredCdpEndpoint(config),{ timeoutMs:900 })) return { connected:true,alreadyOpen:true,message:'采集 Chrome 已经打开。' };
      session=await openSession(config);
      return { connected:true,alreadyOpen:false,message:'采集 Chrome 已打开，请人工登录并准备 Top Sales 页面。' };
    },
    async closeConnection() { await closeBrowserSession(session,config); session=null; }
  };
}
