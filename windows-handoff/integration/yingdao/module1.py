"""Staged adapter; not installed in the user's ShadowBot application yet."""
import json
import os
import time
import zipfile
import shutil
from pathlib import Path


class OperatorTask:
    def __init__(self, manifest_path):
        self.manifest_path = Path(manifest_path).resolve(strict=True)
        self.root = self.manifest_path.parent
        self.data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        if self.data.get("schema_version") != 1:
            raise ValueError("任务格式不支持")
        self.batch_id = self.data["batch_id"]
        self.goods = self.data["goods"]
        if not isinstance(self.batch_id, str) or not self.batch_id.strip():
            raise ValueError("批次编号不能为空")
        if not isinstance(self.goods, list) or not 1 <= len(self.goods) <= 50:
            raise ValueError("每批必须选择 1 至 50 个商品")
        ids = [row["goods_id"] for row in self.goods]
        if any(not isinstance(gid, str) or not gid.isdigit() for gid in ids) or len(set(ids)) != len(ids):
            raise ValueError("商品 ID 必须是数字字符串，且不能重复")
        for row in self.goods:
            image = self.local_path(row["image_path"])
            if not image.is_file():
                raise ValueError("商品图片不存在：" + row["goods_id"])
        self.result_dir = self.local_path("results")
        self.result_dir.mkdir(exist_ok=True)
        self.events_path = self.local_path("events.jsonl")

    def local_path(self, relative):
        relative = Path(relative)
        if relative.is_absolute():
            raise ValueError("任务文件必须使用批次内相对路径")
        target = (self.root / relative).resolve()
        try:
            target.relative_to(self.root)
        except ValueError:
            raise ValueError("任务路径越界")
        return target

    def report(self, state, goods_id=None, message="", output=None):
        if state not in {"STARTED", "ITEM_STARTED", "ITEM_COMPLETED", "NEEDS_ATTENTION", "FAILED", "COMPLETED"}:
            raise ValueError("未知任务状态")
        if goods_id is not None and goods_id not in {row["goods_id"] for row in self.goods}:
            raise ValueError("商品不属于本批")
        if state == "ITEM_COMPLETED":
            if goods_id is None:
                raise ValueError("完成商品必须指定商品 ID")
            expected = self.result_dir / (goods_id + ".xlsx")
            if output is None or Path(output).resolve() != expected or not expected.is_file() or not expected.stat().st_size:
                raise ValueError("本商品结果文件尚未保存，不能报告成功")
        event = {"batch_id": self.batch_id, "time": time.time(), "state": state,
                 "goods_id": goods_id, "message": str(message)[:2000],
                 "output": str(Path(output).relative_to(self.root)) if output else None}
        with self.events_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, ensure_ascii=False) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        return event

    def save_export(self, source, goods_id):
        if goods_id not in {row["goods_id"] for row in self.goods}:
            raise ValueError("商品不属于本批")
        source = Path(source).resolve(strict=True)
        with zipfile.ZipFile(source) as archive:
            if not {"[Content_Types].xml", "xl/workbook.xml"}.issubset(archive.namelist()):
                raise ValueError("导出文件不是有效的 XLSX 工作簿")
            if archive.testzip() is not None:
                raise ValueError("导出文件损坏")
        destination = self.result_dir / (goods_id + ".xlsx")
        # Exclusive creation: never overwrite a previous result. Retain the download.
        with source.open("rb") as src, destination.open("xb") as dst:
            shutil.copyfileobj(src, dst)
            dst.flush()
            os.fsync(dst.fileno())
        return destination

    def find_new_export(self, download_dir, before, timeout=30):
        """Only accept one newly created, nonempty, stable XLSX; never pick an old file."""
        directory = Path(download_dir).resolve(strict=True)
        deadline = time.monotonic() + timeout
        previous = None
        while time.monotonic() < deadline:
            files = [p for p in directory.glob("*.xlsx") if str(p.resolve()) not in before and not p.name.startswith("~$")]
            if len(files) > 1:
                raise ValueError("发现多个新导出文件，无法确定归属，请人工核对")
            if files:
                stat = files[0].stat()
                current = (files[0], stat.st_size, stat.st_mtime_ns)
                if current == previous and stat.st_size > 0:
                    return files[0]
                previous = current
            time.sleep(1)
        raise TimeoutError("等待本商品的新 Excel 导出超时；未使用已有文件")


def _search_one(web_page, image_path):
    import xbot_visual
    from . import package
    当前图片完整路径 = str(image_path)
    xbot_visual.web.element.click(browser=web_page, element=package.selector('块元素_entry-card-logo'), simulate=True, move_mouse=False, clicks='click', button='left', keys='null', delay_after='1', anchor_type='center', sudoku_part='MiddleCenter', offset_x='0', offset_y='0', timeout='90')
    xbot_visual.programing.sleep(random_number=False, seconds='2', start_number='1', stop_number='5')
    xbot_visual.image.hover(window_kind='screen', window='', template_images=[package.image_selector('图像')], anchor_type='center', sudoku_part='MiddleCenter', offset_x='0', offset_y='0', timeout='90', delay_after='1')
    xbot_visual.win32.click_mouse(is_move_mouse_before_click=False, point_x='0', point_y='0', relative_to='screen', move_speed='middle', button='left', click_type='click', hardware_driver_click=False, keys='null', delay_after='1')
    xbot_visual.win32.clipboard_set_text(text=当前图片完整路径)
    xbot_visual.win32.send_keys(keys='!n', hardware_driver_input=False, force_ime_eng=False, contains_hotkey=True, send_key_delay='50', delay_after='1')
    xbot_visual.win32.send_keys(keys='^{v}', hardware_driver_input=False, force_ime_eng=False, contains_hotkey=True, send_key_delay='50', delay_after='1')
    xbot_visual.win32.send_keys(keys='{ENTER}', hardware_driver_input=False, force_ime_eng=False, contains_hotkey=True, send_key_delay='50', delay_after='1')
    xbot_visual.web.browser.wait_load_completed(browser=web_page, load_timeout='120', action_after_load_timeout='handleExcept')
    xbot_visual.image.hover(window_kind='screen', window='', template_images=[package.image_selector('图像2')], anchor_type='center', sudoku_part='MiddleCenter', offset_x='0', offset_y='0', timeout='90', delay_after='1')
    xbot_visual.win32.click_mouse(is_move_mouse_before_click=False, point_x='0', point_y='0', relative_to='screen', move_speed='middle', button='left', click_type='click', hardware_driver_click=False, keys='null', delay_after='1')
    xbot_visual.image.hover(window_kind='screen', window='', template_images=[package.image_selector('图像5')], anchor_type='center', sudoku_part='MiddleCenter', offset_x='0', offset_y='0', timeout='90', delay_after='1')
    xbot_visual.win32.click_mouse(is_move_mouse_before_click=False, point_x='0', point_y='0', relative_to='screen', move_speed='middle', button='left', click_type='click', hardware_driver_click=False, keys='null', delay_after='1')
    xbot_visual.image.hover(window_kind='screen', window='', template_images=[package.image_selector('图像4')], anchor_type='center', sudoku_part='MiddleCenter', offset_x='0', offset_y='0', timeout='90', delay_after='1')
    xbot_visual.win32.click_mouse(is_move_mouse_before_click=False, point_x='0', point_y='0', relative_to='screen', move_speed='middle', button='left', click_type='click', hardware_driver_click=False, keys='null', delay_after='1')
    xbot_visual.win32.element.hover(window='0', element=package.selector('按钮_保存S'), delay_after='1', anchor_type='center', sudoku_part='MiddleCenter', offset_x='0', offset_y='0', timeout='90')
    xbot_visual.win32.click_mouse(is_move_mouse_before_click=False, point_x='0', point_y='0', relative_to='screen', move_speed='middle', button='left', click_type='click', hardware_driver_click=False, keys='null', delay_after='1')


def main(args):
    """ShadowBot Python module entry; validation is the default, real trial max 2."""
    if isinstance(args, str):
        import ast
        try:
            args = json.loads(args)
        except json.JSONDecodeError:
            args = ast.literal_eval(args)
    if not isinstance(args, dict):
        raise ValueError("输入参数必须是字典，或字典格式的文本")
    if not isinstance(args.get("manifest_path"), str) or not args["manifest_path"].strip():
        raise ValueError("输入参数缺少任务清单路径 manifest_path")
    task = OperatorTask(args["manifest_path"])
    if args.get("execute") is not True:
        print("任务清单校验通过：" + task.batch_id + "；尚未启动搜图")
        return {"batch_id": task.batch_id, "count": len(task.goods), "validated": True}
    if len(task.goods) > 50:
        raise ValueError("每批最多处理50件商品")
    download_dir = Path(args["download_dir"]).resolve(strict=True)
    if not download_dir.is_dir():
        raise ValueError("下载目录不存在")
    lock = task.local_path("running.lock")
    with lock.open("x", encoding="utf-8") as stream:
        stream.write(str(os.getpid()))
    current = None
    try:
        # No rerun over existing results; choose a new batch to retry.
        completed = set()
        if task.events_path.exists():
            for line in task.events_path.read_text(encoding="utf-8").splitlines():
                event = json.loads(line)
                if event.get("state") == "ITEM_COMPLETED":
                    completed.add(event["goods_id"])
        for row in task.goods:
            existing = task.result_dir / (row["goods_id"] + ".xlsx")
            if existing.exists():
                if row["goods_id"] not in completed:
                    raise ValueError("已有结果缺少完成记录，请核对：" + row["goods_id"])
                with zipfile.ZipFile(existing) as archive:
                    if archive.testzip() or "xl/workbook.xml" not in archive.namelist():
                        raise ValueError("已有结果文件损坏：" + row["goods_id"])
        completed = {gid for gid in completed if (task.result_dir / (gid + ".xlsx")).exists()}
        import xbot_visual
        task.report("STARTED", message="运营台商品搜图任务")
        web_page = xbot_visual.web.create(web_type='chrome', value='www.1688.com', silent_running=False, wait_load_completed=True, load_timeout='120', stop_load_if_load_timeout='handleExcept', chrome_file_name=None, edge_file_name=None, ie_file_name=None, bro360_file_name=None, firefox_file_name=None, arguments=None)
        for row in task.goods:
            current = row["goods_id"]
            if current in completed:
                continue
            task.report("ITEM_STARTED", current)
            before = {str(p.resolve()) for p in download_dir.glob("*.xlsx")}
            _search_one(web_page, task.local_path(row["image_path"]))
            exported = task.find_new_export(download_dir, before, timeout=180)
            saved = task.save_export(exported, current)
            task.report("ITEM_COMPLETED", current, "文件已保存，待运营台解析校验", saved)
        task.report("COMPLETED", message="搜图文件已收集，尚未导入复核")
    except Exception as exc:
        task.report("FAILED", current, str(exc))
        raise
    finally:
        if lock.exists():
            lock.unlink()

