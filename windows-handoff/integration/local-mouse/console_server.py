import json,threading,ctypes,subprocess,sys,uuid,time,secrets
import urllib.request,urllib.parse
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
from worker import BUSINESS,write_json
lock=threading.Lock()
child=None
CONTROL_TOKEN=secrets.token_urlsafe(32)

def dashboard(path):
    with urllib.request.urlopen('http://127.0.0.1:37821'+path,timeout=8) as response:return json.load(response)

def task_context():
    data=dashboard('/api/catalog/manual-tasks')
    current=data.get('current') or {}
    task=next((t for t in data['tasks'] if t['id']==current.get('id')),None)
    if not task:raise ValueError('请先在运营台选择采集任务')
    result={'task':task,'mode':'capture','metrics':None}
    if task['purpose']=='复采跟踪':
        result['mode']='recapture'
        result['metrics']=task.get('metrics')
        if not result['metrics']:raise ValueError('复采基线进度不可用，请检查运营台版本')
    return result

def launch_test(body):
    global child
    profile=str(body.get('profile','')).strip()
    uuid.UUID(profile)  # Validate without changing VMLogin's case-sensitive ID.
    target=body.get('target',5)
    context=task_context()
    if body.get('campaign_id')!=context['task']['id']:raise ValueError('任务已变化，请核对当前任务后重新启动')
    mode=context['mode']
    if mode=='recapture':target=context['metrics']['previousCount']
    if type(target) is not int or not 1<=target<=(100000 if mode=='recapture' else 2000):raise ValueError('目标数量无效')
    if child and child.poll() is None:raise ValueError('测试正在启动或运行，请勿重复启动')
    if current_status().get('state') in ['STARTING','RUNNING','WAITING_HUMAN']:raise ValueError('请先结束当前测试')
    BUSINESS.mkdir(parents=True,exist_ok=True)
    with (BUSINESS/'launcher.log').open('a',encoding='utf-8') as output:
        child=subprocess.Popen([sys.executable,str(Path(__file__).parent/'run.py'),'--target',str(target),'--minutes','1440','--profile',profile,'--execute','--auto-bind','--campaign-id',context['task']['id'],'--mode',mode],
            cwd=str(Path(__file__).parent),stdout=output,stderr=output,creationflags=subprocess.CREATE_NO_WINDOW)
    write_json(BUSINESS/'status.json',{'id':uuid.uuid4().hex,'pid':child.pid,'state':'STARTING','added':0,'message':'5秒后开始，请切回VMLogin商品页；请先完成检测绑定','updated_at':time.time()})
def current_status():
    file=BUSINESS/'status.json'
    state=json.loads(file.read_text(encoding='utf-8')) if file.exists() else {'state':'IDLE'}
    if state.get('pid') and state.get('state') in ['STARTING','RUNNING','WAITING_HUMAN']:
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
        kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        kernel.GetExitCodeProcess.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD)]
        handle=kernel.OpenProcess(0x1000,False,state['pid'])
        dead=not handle and ctypes.get_last_error()==87
        if handle:
            code=wintypes.DWORD()
            if kernel.GetExitCodeProcess(handle,ctypes.byref(code)):dead=code.value!=259
            kernel.CloseHandle(handle)
        if dead:state.update(state='STOPPED',message='本地进程已退出，已保存数据保留；请重新启动测试。')
    return state
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,code,data,mime='application/json'):
        raw=data.encode('utf-8') if isinstance(data,str) else json.dumps(data,ensure_ascii=False).encode('utf-8')
        self.send_response(code);self.send_header('Content-Type',mime+'; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        if self.path=='/context':
            try:return self.reply(200,task_context())
            except Exception as e:return self.reply(503,{'message':str(e)})
        if self.path=='/':return self.reply(200,(Path(__file__).parent/'console.html').read_text(encoding='utf-8'),'text/html')
        if self.path!='/status':return self.reply(404,{})
        file=BUSINESS/'status.json'
        try:return self.reply(200,{**current_status(),'control_token':CONTROL_TOKEN})
        except (OSError,ValueError):return self.reply(503,{'message':'状态暂不可读，请稍后刷新'})
    def do_POST(self):
        trusted=self.headers.get('X-Local-Control','')
        if self.headers.get('Origin')!='http://127.0.0.1:37823' and not secrets.compare_digest(trusted,CONTROL_TOKEN):return self.reply(403,{'message':'来源不匹配'})
        if self.path not in ['/command','/start']:return self.reply(404,{})
        try:
            n=int(self.headers.get('Content-Length','0'))
            if not 0<n<2048:raise ValueError('请求无效')
            body=json.loads(self.rfile.read(n))
            with lock:
                if self.path=='/start':
                    launch_test(body)
                    return self.reply(200,{'ok':True})
                state=current_status()
                if body.get('id')!=state['id']:raise ValueError('任务已变化，请刷新')
                if state['state'] not in ['RUNNING','WAITING_HUMAN']:raise ValueError('任务未运行')
                if body.get('action') not in ['pause','resume','stop']:raise ValueError('操作无效')
                if body['action']=='resume' and state['state']!='WAITING_HUMAN':raise ValueError('当前未暂停')
                write_json(BUSINESS/'command.json',{'id':state['id'],'action':body['action']})
            return self.reply(200,{'ok':True})
        except (KeyError,ValueError,OSError) as e:return self.reply(400,{'message':str(e)})
if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',37823),Handler).serve_forever()
