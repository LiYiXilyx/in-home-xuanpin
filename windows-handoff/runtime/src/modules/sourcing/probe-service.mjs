import fs from 'node:fs';
import path from 'node:path';
import { chromium as defaultChromium } from 'playwright';
import { MACHINE_ROLES,assertMachineRole,machineName } from './machine-role.mjs';
import { createStructuredLogger } from './structured-log.mjs';

const RUN_ID_RE=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SENSITIVE_NAME_RE=/(?:cookie|token|authorization|password|passwd|secret|session|credential|captcha|verification|one.?time|otp)/i;
const SENSITIVE_TEXT_RE=/(?:bearer\s+[a-z0-9._~-]+|(?:cookie|token|authorization|password|passwd|secret)\s*[:=]\s*[^\s"'<>]+)/gi;
const CHALLENGE_RE=/(?:captcha|verify|verification|slider|challenge|验证码|滑块|安全验证|短信验证|账号确认)/i;

export function validateProbeRunId(runId){
  const value=String(runId??'').trim();
  if(!RUN_ID_RE.test(value))throw new Error('--run-id 只能包含字母、数字、点、下划线和连字符，长度不超过 128。');
  return value;
}

export function sanitizeProbeText(value){
  const redacted=String(value??'').replace(SENSITIVE_TEXT_RE,'[REDACTED]').slice(0,2000);
  return CHALLENGE_RE.test(redacted)?'[REDACTED_SENSITIVE_CHALLENGE]':redacted;
}

export function sanitizeProbeUrl(value){
  const raw=String(value??'');
  try{
    const url=new URL(raw);
    for(const key of [...url.searchParams.keys()])if(SENSITIVE_NAME_RE.test(key))url.searchParams.set(key,'[REDACTED]');
    url.username='';url.password='';url.hash='';
    return sanitizeProbeText(url.href);
  }catch{return sanitizeProbeText(raw);}
}

export function is1688PageUrl(value){
  try{return /(^|\.)1688\.com$/i.test(new URL(value).hostname);}catch{return false;}
}

export function sanitizeHtmlFallback(html){
  return String(html??'')
    .replace(/<!--[\s\S]*?-->/g,'')
    .replace(/<(script|noscript|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'<$1 data-probe-redacted="true"></$1>')
    .replace(/\s(?:on[a-z]+|srcdoc|nonce)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')
    .replace(/\s([\w:-]*(?:cookie|token|authorization|password|passwd|secret|session|captcha|verification|otp)[\w:-]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,' $1="[REDACTED]"')
    .replace(/(<input\b[^>]*?\svalue\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'$1"[REDACTED]"')
    .replace(SENSITIVE_TEXT_RE,'[REDACTED]');
}

function outputPaths(projectRoot,runId){
  const outputDir=path.resolve(projectRoot,'outputs','1688-probe',runId);
  return {outputDir,summary:path.join(outputDir,'probe-summary.json'),screenshot:path.join(outputDir,'page.png'),html:path.join(outputDir,'page.html'),elements:path.join(outputDir,'elements.json'),frames:path.join(outputDir,'frames.json'),log:path.join(outputDir,'runner.log')};
}

async function sanitizedDomSnapshot(frame){
  const html=await frame.evaluate(()=>{
    const clone=document.documentElement.cloneNode(true);
    const sensitive=/(?:cookie|token|authorization|password|passwd|secret|session|credential|captcha|verification|one.?time|otp)/i;
    const challenge=/(?:captcha|verify|verification|slider|challenge|验证码|滑块|安全验证|短信验证|账号确认)/i;
    clone.querySelectorAll('script,noscript,style').forEach(node=>{node.textContent='';node.setAttribute('data-probe-redacted','true');});
    clone.querySelectorAll('*').forEach(node=>{
      const fingerprint=[node.id,node.className,node.getAttribute?.('name'),node.getAttribute?.('aria-label'),node.getAttribute?.('title'),node.getAttribute?.('alt')].filter(value=>typeof value==='string').join(' ');
      if(challenge.test(fingerprint)&&!['HTML','BODY'].includes(node.tagName)){
        node.replaceChildren(document.createTextNode('[REDACTED_SENSITIVE_CHALLENGE]'));
        node.setAttribute('data-probe-redacted','challenge');
      }
      for(const attribute of [...node.attributes]){
        if(/^on/i.test(attribute.name)||['srcdoc','nonce'].includes(attribute.name.toLowerCase()))node.removeAttribute(attribute.name);
        else if(sensitive.test(attribute.name))node.setAttribute(attribute.name,'[REDACTED]');
        else if(['href','src','action','formaction'].includes(attribute.name.toLowerCase())){
          try{const url=new URL(attribute.value,document.baseURI);for(const key of [...url.searchParams.keys()])if(sensitive.test(key))url.searchParams.set(key,'[REDACTED]');url.username='';url.password='';url.hash='';node.setAttribute(attribute.name,url.href);}catch{/* keep non-URL attribute */}
        }
      }
      if(node.tagName==='INPUT'||node.tagName==='TEXTAREA')node.setAttribute('value','[REDACTED]');
    });
    return `<!doctype html>\n${clone.outerHTML}`;
  });
  return sanitizeHtmlFallback(html);
}

async function collectElements(frame,frameIndex){
  return frame.evaluate(({frameIndex})=>{
    const clean=value=>String(value??'').replace(/\s+/g,' ').trim().slice(0,500);
    const visible=node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0'&&rect.width>0&&rect.height>0;};
    const describe=node=>({frame_index:frameIndex,tag:node.tagName.toLowerCase(),type:clean(node.getAttribute('type')),text:clean(node.innerText||node.textContent),id:clean(node.id),class:clean(typeof node.className==='string'?node.className:''),name:clean(node.getAttribute('name')),['aria-label']:clean(node.getAttribute('aria-label')),placeholder:clean(node.getAttribute('placeholder')),role:clean(node.getAttribute('role')),visible:visible(node)});
    const all=[...document.querySelectorAll('input,button,a')].filter(visible).map(describe);
    const interactive=[...document.querySelectorAll('input,button,a,[role="button"]')];
    const fingerprint=node=>[node.innerText,node.textContent,node.id,typeof node.className==='string'?node.className:'',node.getAttribute('name'),node.getAttribute('aria-label'),node.getAttribute('placeholder'),node.getAttribute('title')].join(' ');
    const pick=(nodes,matcher,{visibleOnly=true,limit=200}={})=>nodes.filter(node=>(!visibleOnly||visible(node))&&matcher(node)).slice(0,limit).map(describe);
    const fileInputs=pick([...document.querySelectorAll('input[type="file"]')],()=>true,{visibleOnly:false});
    const imageSearch=pick(interactive,node=>/(?:图片搜索|以图搜款|以图搜图|找同款|搜同款|image\s*search|search\s*by\s*image)/i.test(fingerprint(node)));
    const upload=pick(interactive,node=>/(?:上传图片|上传照片|选择图片|本地图片|upload\s*(?:image|photo|file)|choose\s*(?:image|photo|file))/i.test(fingerprint(node)));
    const searchBoxes=pick([...document.querySelectorAll('input')],node=>node.type==='search'||/(?:搜索|搜商品|search)/i.test(fingerprint(node)));
    const resultNodes=[...document.querySelectorAll('[class*="product" i],[class*="offer" i],[class*="result" i],[class*="card" i],[data-offer-id],[data-product-id],[role="listitem"]')];
    const resultContainers=pick(resultNodes,node=>/(?:product|offer|result|card|商品|货品|结果)/i.test(fingerprint(node))||node.hasAttribute('data-offer-id')||node.hasAttribute('data-product-id'));
    return {visible_elements:all,detections:{file_inputs:fileInputs,image_search_entries:imageSearch,upload_controls:upload,search_boxes:searchBoxes,result_product_containers:resultContainers}};
  },{frameIndex});
}

async function frameEvidence(page){
  const frames=page.frames(),items=[],elements=[];
  for(let index=0;index<frames.length;index+=1){
    const frame=frames[index],parent=frame.parentFrame();
    let title='',accessible=true,error=null;
    try{title=sanitizeProbeText(await frame.title());}catch(cause){accessible=false;error=sanitizeProbeText(cause.message);}
    const sensitiveChallengeSignal=CHALLENGE_RE.test(`${frame.name()} ${frame.url()} ${title}`);
    items.push({frame_index:index,parent_frame_index:parent?frames.indexOf(parent):null,name:sanitizeProbeText(frame.name()),url:sanitizeProbeUrl(frame.url()),title,accessible,child_frame_count:frame.childFrames().length,sensitive_challenge_signal:sensitiveChallengeSignal,error});
    if(accessible){try{elements.push(await collectElements(frame,index));}catch(cause){items[index].elements_error=sanitizeProbeText(cause.message);}}
  }
  return {frames:items,elements};
}

async function sensitiveMasks(page){
  const selector='input[type="password"],input[autocomplete="one-time-code"],[id*="captcha" i],[class*="captcha" i],[id*="verify" i],[class*="verify" i],[id*="slider" i],[class*="slider" i],[id*="challenge" i],[class*="challenge" i],[name*="captcha" i],[name*="verify" i],[aria-label*="验证码"],[aria-label*="安全验证"],img[alt*="验证码"],iframe[src*="captcha" i],iframe[src*="verify" i]';
  return page.frames().map(frame=>frame.locator(selector));
}

function aggregateElements(frameResults){
  const safe=descriptor=>Object.fromEntries(Object.entries(descriptor).map(([key,value])=>[key,typeof value==='string'?sanitizeProbeText(value):value]));
  const visible_elements=frameResults.flatMap(item=>item.visible_elements??[]).map(safe),keys=['file_inputs','image_search_entries','upload_controls','search_boxes','result_product_containers'];
  const detections=Object.fromEntries(keys.map(key=>[key,frameResults.flatMap(item=>item.detections?.[key]??[]).map(safe)]));
  return {visible_elements,detections,counts:{visible_elements:visible_elements.length,...Object.fromEntries(keys.map(key=>[key,detections[key].length]))}};
}

export async function run1688Probe({runId,projectRoot=process.cwd(),cdpEndpoint=process.env.CHROME_CDP_ENDPOINT??'http://127.0.0.1:9222',chromium=defaultChromium,connect,now=()=>new Date().toISOString(),machineRoleCheck=true}={}){
  const safeRunId=validateProbeRunId(runId);if(machineRoleCheck)assertMachineRole(MACHINE_ROLES.RUNNER,'1688 Probe');
  const paths=outputPaths(projectRoot,safeRunId);if(fs.existsSync(paths.outputDir))throw new Error(`Probe 输出目录已存在，拒绝覆盖：${paths.outputDir}`);
  fs.mkdirSync(path.dirname(paths.outputDir),{recursive:true});fs.mkdirSync(paths.outputDir,{recursive:false});const log=createStructuredLogger(paths.log,{runId:safeRunId,clock:now});
  log({step:'PROBE_START',status:'RUNNING',cdp_endpoint:sanitizeProbeUrl(cdpEndpoint)});
  try{
    const browser=connect?await connect(cdpEndpoint):await chromium.connectOverCDP(cdpEndpoint);
    const pages=browser.contexts().flatMap(context=>context.pages()).filter(page=>!page.isClosed());
    const matches=pages.filter(page=>is1688PageUrl(page.url()));
    if(matches.length===0)throw new Error('已连接 Chrome，但没有找到打开的 1688 页面。');
    const page=matches.at(-1),startedAt=now(),title=sanitizeProbeText(await page.title()),url=sanitizeProbeUrl(page.url());
    log({step:'PAGE_SELECTED',status:'OK',url,title,matching_1688_pages:matches.length});
    const evidence=await frameEvidence(page),elements=aggregateElements(evidence.elements);
    const html=await sanitizedDomSnapshot(page.mainFrame());fs.writeFileSync(paths.html,`${html}\n`,'utf8');
    await page.screenshot({path:paths.screenshot,fullPage:true,animations:'disabled',mask:await sensitiveMasks(page)});
    fs.writeFileSync(paths.elements,`${JSON.stringify(elements,null,2)}\n`,'utf8');fs.writeFileSync(paths.frames,`${JSON.stringify({frames:evidence.frames},null,2)}\n`,'utf8');
    const finishedAt=now(),challengeCount=evidence.frames.filter(item=>item.sensitive_challenge_signal).length;
    const summary={probe_version:'1688_RUNNER_PROBE_V0',run_id:safeRunId,status:'PASS',machine_role:MACHINE_ROLES.RUNNER,machine_name:machineName(),started_at:startedAt,finished_at:finishedAt,cdp_endpoint:sanitizeProbeUrl(cdpEndpoint),page:{url,title},matching_1688_pages:matches.length,frame_count:evidence.frames.length,element_counts:elements.counts,sensitive_challenge_signal_count:challengeCount,network_capture:false,mtop_inspection:false,cookies_read:false,temu_database_access:false,artifacts:{'probe-summary.json':'probe-summary.json','page.png':'page.png','page.html':'page.html','elements.json':'elements.json','frames.json':'frames.json','runner.log':'runner.log'}};
    fs.writeFileSync(paths.summary,`${JSON.stringify(summary,null,2)}\n`,'utf8');log({step:'PROBE_COMPLETE',status:'PASS',frame_count:evidence.frames.length,element_counts:elements.counts});
    return {...summary,output_dir:paths.outputDir};
  }catch(error){log({step:'PROBE_FAILED',status:'FAIL',error:sanitizeProbeText(error.message)});throw error;}
}
