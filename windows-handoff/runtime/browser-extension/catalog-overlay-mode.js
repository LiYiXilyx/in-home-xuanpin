'use strict';

(() => {
  const MODES=Object.freeze({MANUAL_BIND:'MANUAL_BIND',LEGACY_AUTO_RUNNER:'LEGACY_AUTO_RUNNER',NO_CONTEXT:'NO_CONTEXT',BLOCKED:'BLOCKED'});
  const MANUAL=new Set(['MANUAL_BIND_PASSIVE_CAPTURE','MANUAL_NAVIGATION_PASSIVE_CAPTURE']);
  function resolveCatalogOverlayMode(context){
    const campaign=context?.campaign;
    if(!campaign)return MODES.NO_CONTEXT;
    const control=String(campaign.browserControlMode??'');
    if(MANUAL.has(control))return MODES.MANUAL_BIND;
    if(control==='FULL_REFRESH_EXTENSION_AUTO')return MODES.LEGACY_AUTO_RUNNER;
    return MODES.BLOCKED;
  }
  globalThis.TemuCatalogOverlayMode=Object.freeze({...MODES,resolveCatalogOverlayMode});
})();
