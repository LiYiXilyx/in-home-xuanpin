import ctypes
from pathlib import Path
import pyautogui as pg
from PIL import Image
pg.FAILSAFE=True
pg.PAUSE=.25
TEMPLATES={'测试_采集':'capture.png','测试_更多':'more.png'}

def load_template(name):
    # Pillow supports Unicode Windows paths. Pass pixels to PyScreeze/OpenCV,
    # rather than letting cv2.imread try to decode the Chinese file path.
    file=Path(__file__).parent/'templates'/TEMPLATES[name]
    with Image.open(file) as source:
        return source.convert('RGB')

def title_matches(actual,expected):
    actual=' '.join(actual.split()).casefold()
    expected=' '.join((expected or '').split()).casefold()
    return bool(expected) and (actual==expected or actual.startswith(expected+' - ') or actual.endswith(' - '+expected))

def find_button(name,expected_title=None):
    # Locate only inside the currently visible foreground browser window.
    from ctypes import wintypes
    user=ctypes.windll.user32
    user.GetForegroundWindow.restype=wintypes.HWND
    user.GetWindowTextW.argtypes=[wintypes.HWND,wintypes.LPWSTR,ctypes.c_int]
    user.GetWindowRect.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.RECT)]
    handle=user.GetForegroundWindow();title=ctypes.create_unicode_buffer(512)
    user.GetWindowTextW(handle,title,512)
    if not title_matches(title.value,expected_title):
        raise RuntimeError('前台窗口不匹配。当前：'+title.value+'；需要：'+str(expected_title)+'。请切回商品页')
    rect=wintypes.RECT();user.GetWindowRect(handle,ctypes.byref(rect))
    width,height=pg.size();left=max(0,rect.left);top=max(0,rect.top)
    region=(left,top,min(width,rect.right)-left,min(height,rect.bottom)-top)
    if region[2]<=0 or region[3]<=0:raise RuntimeError('请将浏览器移到主显示器')
    template=load_template(name)
    points=[]
    for box in pg.locateAllOnScreen(template,confidence=.92,region=region):
        p=pg.center(box)
        if all(abs(p.x-x)>15 or abs(p.y-y)>15 for x,y in points):points.append((p.x,p.y))
        if len(points)>1:raise RuntimeError('有多个相似按钮，请人工检查，未点击')
    if len(points)!=1:raise RuntimeError('未找到按钮，请检查窗口、缩放或遮挡')
    return points[0]

def click_template(name,inspect):
    try:
        state=inspect()
        point=find_button(name,state.get('title'))
        # Avoid intermediate hover events over product cards along a long path.
        pg.moveTo(*point,duration=0)
        state=inspect()
        fresh=find_button(name,state.get('title'))
        if abs(fresh[0]-point[0])>3 or abs(fresh[1]-point[1])>3:
            raise RuntimeError('按钮位置发生变化，未点击')
        pg.click()
    except pg.FailSafeException:
        raise KeyboardInterrupt()
