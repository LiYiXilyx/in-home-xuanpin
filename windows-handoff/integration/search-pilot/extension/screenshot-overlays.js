// Screenshot-only presentation guard. Does not alter extension state or bindings.
globalThis.TemuScreenshotOverlayGuard=function(action,token){
 const key='__temuScreenshotOverlayGuardV1';
 const state=globalThis[key]??=( {leases:new Map(),style:null} );
 const release=id=>{const timer=state.leases.get(id);if(timer)clearTimeout(timer);state.leases.delete(id);if(!state.leases.size){state.style?.remove();state.style=null;}};
 if(action==='restore'){release(token);return true;}
 if(action!=='hide')throw Error('Invalid screenshot guard action');
 if(!state.style?.isConnected){const style=document.createElement('style');style.dataset.temuScreenshotGuard='true';style.textContent=['temu-catalog-operator-overlay','temu-catalog-auto-overlay','temu-market-evidence-overlay'].map(id=>`#${id}#${id}{display:none!important}`).join('\n');(document.head||document.documentElement).append(style);state.style=style;}
 const id=Date.now().toString(36)+Math.random().toString(36).slice(2);state.leases.set(id,setTimeout(()=>release(id),60000));return id;
};

// Keep collection panels hidden throughout search browsing, including SPA navigation.
(()=>{const key='__temuSearchPanelVisibilityV1';if(globalThis[key]){globalThis[key]();return;}
 let style=null;const update=()=>{const u=new URL(location.href),search=u.pathname.includes('search_result')||u.searchParams.has('search_key');
 if(search&&!style?.isConnected){style=document.createElement('style');style.textContent='#temu-catalog-operator-overlay#temu-catalog-operator-overlay,#temu-catalog-auto-overlay#temu-catalog-auto-overlay{display:none!important}';(document.head||document.documentElement).append(style);}
 else if(!search&&style){style.remove();style=null;}
 };globalThis[key]=update;update();setInterval(update,500);
})();
