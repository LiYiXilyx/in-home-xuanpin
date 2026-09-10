export function mountPilotViews(shell){
  const paths={auto:'/auto',opportunities:'/opportunities'},frames=new Map();
  for(const [key,path] of Object.entries(paths)){const section=document.createElement('section');section.dataset.view=key;section.hidden=true;section.className='pilot-embedded-view';const frame=document.createElement('iframe');frame.title=key==='auto'?'自动截图队列':'机会商品';frame.dataset.pilotFrame=key;frame.style.cssText='width:100%;height:calc(100vh - 210px);min-height:580px;border:0;display:block;background:#f4f7fa';section.append(frame);shell.append(section);frames.set(key,frame);}
  window.addEventListener('message',event=>{if(event.origin!=='http://127.0.0.1:37822'||![...frames.values()].some(frame=>frame.contentWindow===event.source))return;if(event.data?.type==='pilot-navigate'&&Object.hasOwn(paths,event.data.view))location.hash=event.data.view;});
  return {activate(key){const frame=frames.get(key);if(frame&&!frame.getAttribute('src'))frame.src='http://127.0.0.1:37822'+paths[key]+'?embedded=1';}};
}
