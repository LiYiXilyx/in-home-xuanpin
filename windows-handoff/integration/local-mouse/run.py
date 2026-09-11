import argparse,time,json,sys,subprocess,urllib.request,msvcrt
from pathlib import Path
from worker import main
parser=argparse.ArgumentParser()
parser.add_argument('--profile',required=True)
parser.add_argument('--execute',action='store_true')
parser.add_argument('--auto-bind',action='store_true')
parser.add_argument('--campaign-id')
parser.add_argument('--mode',choices=['capture','recapture'],default='capture')
parser.add_argument('--target',type=int,default=5)
parser.add_argument('--minutes',type=int,default=10)
args=parser.parse_args()
run_lock=None
if args.execute:
    # OS releases this lock even if the terminal is forcibly closed.
    run_lock=(Path(__file__).parent/'running.lock').open('a+b')
    run_lock.seek(0);run_lock.write(b'0');run_lock.flush();run_lock.seek(0)
    try:msvcrt.locking(run_lock.fileno(),msvcrt.LK_NBLCK,1)
    except OSError:
        print('已有本地鼠标测试运行，请先结束原任务。');sys.exit(1)
try:
    urllib.request.urlopen('http://127.0.0.1:37823/status',timeout=2).close()
except OSError:
    subprocess.Popen([sys.executable,str(Path(__file__).parent/'console_server.py')],creationflags=subprocess.CREATE_NO_WINDOW)
print('独立本地鼠标测试。请将VMLogin商品页放在主屏前台，先检测并绑定。')
print('5秒后开始；鼠标移到主屏左上角可阻止下一次鼠标点击；终端 Ctrl+C 可结束。')
time.sleep(5)
try:
    result=main(dict(profile_id=args.profile,minutes=args.minutes,target=args.target,execute=args.execute,auto_bind=args.auto_bind,campaign_id=args.campaign_id,mode=args.mode))
    print(json.dumps(result,ensure_ascii=False,indent=2))
    if not args.execute:
        from mouse_backend import find_button
        print('采集按钮定位：',find_button('测试_采集',result.get('title')),'；没有点击')
except KeyboardInterrupt:
    print('已手动结束，已保存商品保留。')
except Exception as e:
    print('已停止：'+str(e))
    sys.exit(1)
