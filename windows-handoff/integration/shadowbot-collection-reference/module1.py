"""Python 3.7 compatible. Import in a NEW ShadowBot test application only."""
import json,time,base64,urllib.request,urllib.parse
import os,uuid,traceback
import re
from pathlib import Path
from datetime import datetime
OPERATOR_VERSION=2
BUSINESS=Path('F:/Temu运营数据/Temu辅助采集测试')
JOB_ID=None

def operator_command():
    file=BUSINESS/'command.json'
    if not JOB_ID or not file.exists():return ''
    value=json.loads(file.read_text(encoding='utf-8'))
    file.unlink()
    return value.get('action','') if value.get('id')==JOB_ID else ''

def write_json(file,value):
    file.parent.mkdir(parents=True,exist_ok=True)
    temp=file.with_suffix('.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')
    os.replace(str(temp),str(file))

class HumanResumed(Exception):
    pass

class HumanNeeded(RuntimeError):
    pass

class TimeLimit(Exception):
    pass

class UserStopped(Exception):
    pass

class PageUnavailable(RuntimeError):
    pass

def decode_response(data):
    if data.get('status')!='OK':raise PageUnavailable('VMLogin暂时无法访问页面')
    try:
        result=data['value']
        if isinstance(result,str):result=json.loads(result)
        if isinstance(result,dict) and 'exceptionDetails' in result:
            raise PageUnavailable('VMLogin页面执行异常（可能正在跳转或验证）')
        if isinstance(result,dict) and 'result' in result:
            remote=result['result']
            if not isinstance(remote,dict) or 'value' not in remote:
                raise PageUnavailable('VMLogin返回的页面结果暂不可用')
            result=remote['value']
            if isinstance(result,str):result=json.loads(result)
        return result
    except (KeyError,ValueError,TypeError) as error:
        raise PageUnavailable('VMLogin页面返回格式暂不可用') from error

def wait_for_human(read,show,pause,identity,log,reason='页面需要登录、验证或重新绑定'):
    """Never resume automatically, even when the login dialog disappears."""
    log('等待人工处理：'+reason+'。处理后返回原商品页，必要时重新检测绑定，再点击继续采集。')
    failures=0
    while True:
        try:
            decision=operator_command() or show()
            s=read() if decision=='resume' else None
            failures=0
        except PageUnavailable as error:
            failures+=1
            if failures==1 or failures%30==0:
                log('仍在暂停，页面暂不可读：'+str(error)+'；请人工处理后返回原页，必要时在影刀停止运行')
            pause(2)
            continue
        if decision=='stop':raise UserStopped('人工结束采集，已保存数据保留')
        if decision=='resume':
            if (s and s.get('version')==1 and not any(s.get(k) for k in ('hidden','stopped','blocked','error','busy','retry'))
                    and s.get('bound') and (s.get('campaign'),s.get('url'))==identity):
                log('人工确认恢复，继续原任务和剩余目标')
                return
            log('暂不能继续：请回到原页面，完成验证并检测、绑定原任务')
        pause(1)

HUMAN_PANEL="""(()=>{
let p=document.getElementById('hybrid-human-wait');
if(!p){p=document.createElement('div');p.id='hybrid-human-wait';
p.style.cssText='position:fixed;right:16px;top:16px;z-index:2147483647;background:white;color:#17324a;padding:20px;border:3px solid #e49319;font:16px sans-serif';
const t=document.createElement('p');t.textContent='采集已暂停：请查看运营台原因，人工处理后返回原商品页并绑定原任务。';p.append(t);
for(const pair of [['resume','继续采集'],['stop','结束本轮']]){const b=document.createElement('button');b.textContent=pair[1];b.style.cssText='padding:12px;margin:8px;background:#1769d2;color:white;border:0';b.onclick=()=>p.dataset.decision=pair[0];p.append(b);}
document.documentElement.append(p);}
const d=p.dataset.decision||'';p.dataset.decision='';return d;})()"""

def main(args):
    global JOB_ID
    JOB_ID=None
    request=BUSINESS/'request.json'
    job=None
    if request.exists():
        candidate=json.loads(request.read_text(encoding='utf-8'))
        if candidate.get('state')=='QUEUED':
            job=candidate;JOB_ID=job['id'];args=job['args'];job['state']='RUNNING';write_json(request,job)
    root=Path('F:/Temu运营数据/Temu辅助采集测试/日志')
    root.mkdir(parents=True,exist_ok=True)
    file=root/(datetime.now().strftime('%Y-%m-%d_%H-%M-%S')+'_'+uuid.uuid4().hex[:8]+'.log')
    def log(message):
        line=datetime.now().strftime('%Y-%m-%d %H:%M:%S')+' '+str(message)
        with file.open('a',encoding='utf-8') as stream:
            stream.write(line+'\n');stream.flush();os.fsync(stream.fileno())
        try:
            from xbot import print as output
            output(line)
        except Exception:
            pass
        if job:
            job['message']=str(message);job['updated_at']=time.time()
            if '等待人工处理' in str(message):job['state']='WAITING_HUMAN'
            elif '人工确认恢复' in str(message):job['state']='RUNNING'
            count=re.search(r'累计 (\d+) 件，本轮新增 (\d+) 件',str(message))
            if count:job['count']=int(count[1]);job['added']=int(count[2])
            write_json(BUSINESS/'status.json',job)
    log('START 运行开始；日志文件：'+str(file))
    try:
        result=_run(args,log)
        if job:
            job['state']='COMPLETED' if result.get('completed') else 'STOPPED';job['result']=result
        log('SUCCESS '+json.dumps(result,ensure_ascii=False))
        return dict(result,log_path=str(file))
    except UserStopped:
        if job:job['state']='STOPPED'
        log('人工结束本轮，已保存数据保留')
        return {'completed':False,'reason':'USER_STOPPED','log_path':str(file)}
    except Exception as error:
        if job:job['state']='FAILED'
        log('ERROR '+str(error)+'\n'+traceback.format_exc())
        raise RuntimeError(str(error)+'；详细日志：'+str(file)) from error

def collect_loop(inspect,click,scroll,wait_ready,pause,initial,target,log,progress=None):
    if progress is None:progress={}
    saved_ids=set();first=True;retries=0;still=0;captures=progress.get('captures',0);more_clicks=progress.get('more_clicks',0)
    while True:
        s=inspect()
        added=s['count']-initial['count']
        if added>=target:
            log('目标完成：新增 {} 件，保存 {} 次，See more {} 次'.format(added,captures,more_clicks))
            return {'completed':True,'added':added,'captures':captures,'see_more_clicks':more_clicks}
        if s['retry']:
            raise HumanNeeded('出现 Try again / Try more，请人工处理后继续')
        if first or set(s['ids'])-saved_ids:
            # Stable membership prevents capturing each intermediate loading update.
            previous=[None];matches=[0]
            def stable(x):
                if x['retry']:return True
                signature=tuple(sorted(set(x['ids'])))
                valid=bool(signature) and not x.get('loading',False) and not x['busy']
                matches[0]=matches[0]+1 if valid and signature==previous[0] else 0
                previous[0]=signature
                return matches[0]>=3
            s=wait_ready(stable)
            if s['retry']:continue
            ids=set(s['ids'])
            if not first and not ids-saved_ids:continue
            before=s['receipt'];log('商品列表已稳定，点击采集（本次可见新ID {} 个）'.format(len(ids-saved_ids)))
            click('测试_采集')
            result=wait_ready(lambda x:x['receipt']>before and not x['busy'])
            saved_ids.update(ids);first=False;captures+=1
            progress['captures']=captures
            progress['count']=result['count']
            progress['no_growth']=progress.get('no_growth',0)+1 if result['count']<=s['count'] else 0
            log('保存确认：累计 {} 件，本轮新增 {} 件'.format(result['count'],result['count']-initial['count']))
            if progress['no_growth']>=5:
                progress['no_growth']=0
                raise HumanNeeded('连续5次采集没有新增商品，请检查重复商品、过滤结果或页面加载后继续')
            continue
        if s['more']:
            ids=set(s['ids']);log('点击 See more，等待新商品，最长90秒')
            click('测试_更多');more_clicks+=1
            progress['more_clicks']=more_clicks
            wait_ready(lambda x:x['retry'] or bool(set(x['ids'])-ids));still=0;continue
        old=s['y'];scroll()
        for _ in range(6):pause(.5);s=inspect()
        still=still+1 if s['y']==old else 0
        if still>=3:raise HumanNeeded('连续滚动未前进，也没有加载按钮，请人工检查；已保存数据保留')

def _run(args,log):
    if isinstance(args,str): args=json.loads(args)
    args=args or {}
    profile=args.get('profile_id')
    if not profile: raise ValueError('填写 VMLogin profile_id')
    minutes=float(args.get('minutes',5));target=int(args.get('target',5))
    if not 0<minutes<=1440 or not 1<=target<=2000: raise ValueError('运行时限1至1440分钟，新增目标1至2000件')
    def evaluate(script):
        body=urllib.parse.urlencode({'profileId':profile,'body':base64.b64encode(('JSON.stringify('+script+')').encode()).decode()}).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:35000/api/v1/profile/ExecuteScript',data=body),timeout=20) as response: data=json.load(response)
        except (OSError,ValueError) as error:
            raise PageUnavailable('VMLogin连接或页面响应暂不可用') from error
        return decode_response(data)
    def read_state():
        return evaluate("(()=>{const s=JSON.parse(document.getElementById('hybrid-test-panel')?.dataset.state||'null');if(s){const nodes=[...document.querySelectorAll('input[type=password],[role=dialog]')].filter(n=>n.getBoundingClientRect().width&&n.getBoundingClientRect().height);s.blocked=s.blocked||nodes.some(n=>n.matches('input[type=password]')||/sign in|log in|登录|登入|verification|验证码/i.test(n.innerText));}return s;})()")
    def inspect():
        nonlocal deadline
        if operator_command()=='stop':raise UserStopped()
        try:s=read_state()
        except PageUnavailable:
            if not identity:raise
            s=None
        if identity and (not s or s.get('blocked') or not s.get('bound') or s.get('url')!=identity[1]):
            started=time.monotonic()
            wait_for_human(read_state,lambda:evaluate(HUMAN_PANEL),time.sleep,identity,log)
            deadline+=time.monotonic()-started
            try:evaluate("(()=>{document.getElementById('hybrid-human-wait')?.remove();return true;})()")
            except PageUnavailable:pass
            raise HumanResumed()
        if not s or s.get('version')!=1: raise RuntimeError('未找到新增测试插件，请先人工检测绑定')
        if s['hidden'] or s['stopped'] or s['blocked'] or s['error'] or not s['bound']: raise RuntimeError('页面未绑定、已停止、进入后台或出现异常：'+str(s.get('error','')))
        if identity and (s['campaign'],s['url'])!=identity: raise RuntimeError('页面或任务变化，停止')
        if time.monotonic()>deadline: raise TimeLimit()
        return s
    identity=None;deadline=time.monotonic()+minutes*60
    if args.get('auto_bind'):
        expected=args.get('campaign_id')
        if not expected:raise ValueError('运营台未指定采集任务')
        log('检测并绑定运营台所选任务')
        evaluate("(()=>{const p=document.getElementById('hybrid-test-panel');if(!p)throw Error('请加载新版采集插件');p.dataset.expectedCampaign="+json.dumps(expected)+";p.dispatchEvent(new Event('hybrid-auto-bind'));return true;})()")
        for _ in range(60):
            time.sleep(.5);s=read_state()
            if s and s.get('error'):raise RuntimeError(s['error'])
            if s and s.get('bound') and not s.get('busy'):break
        else:raise RuntimeError('自动绑定未完成，请检查页面是否与所选任务类目一致')
    initial=inspect();identity=(initial['campaign'],initial['url'])
    if args.get('campaign_id') and identity[0]!=args['campaign_id']:raise RuntimeError('所选任务不一致，已停止')
    if not args.get('execute',False): return {'validated':True,'campaign':identity[0],'count':initial['count']}
    import xbot_visual
    from . import package
    def click(template):
        inspect()
        try:xbot_visual.image.hover(window_kind='screen',window='',template_images=[package.image_selector(template)],anchor_type='center',sudoku_part='MiddleCenter',offset_x='0',offset_y='0',timeout='10',delay_after='0')
        except Exception as error:raise HumanNeeded('找不到点击按钮，请人工检查窗口、遮挡或页面变化：'+str(error)) from error
        inspect()
        xbot_visual.win32.click_mouse(is_move_mouse_before_click=False,point_x='0',point_y='0',relative_to='screen',move_speed='middle',button='left',click_type='click',hardware_driver_click=False,keys='null',delay_after='0')
    def wait_ready(predicate,seconds=90):
        end=time.monotonic()+seconds
        while time.monotonic()<end:
            s=inspect()
            if predicate(s): return s
            time.sleep(.5)
        raise HumanNeeded('等待加载或保存超时，请人工检查页面，已保存数据保留')
    def scroll():
        inspect()
        evaluate("(()=>{window.scrollBy({top:Math.max(200,innerHeight*.75),behavior:'instant'});return true;})()")
    try:
        progress={}
        while True:
            try:
                return collect_loop(inspect,click,scroll,wait_ready,time.sleep,initial,target,log,progress)
            except HumanResumed:
                # Restart the page observation, keeping the original database baseline.
                # Receipt counters may reset when navigation reinjects the extension.
                continue
            except (HumanNeeded,PageUnavailable) as error:
                log(str(error))
                started=time.monotonic()
                wait_for_human(read_state,lambda:evaluate(HUMAN_PANEL),time.sleep,identity,log,str(error))
                deadline+=time.monotonic()-started
                try:evaluate("(()=>{document.getElementById('hybrid-human-wait')?.remove();return true;})()")
                except PageUnavailable:pass
            except TimeLimit:
                return {'completed':False,'reason':'TIME_LIMIT','added':max(0,progress.get('count',initial['count'])-initial['count']),'message':'本轮到时结束，成果已保存，可继续原任务'}
    except Exception as error:
        log('辅助采集已停止：'+str(error))
        raise
