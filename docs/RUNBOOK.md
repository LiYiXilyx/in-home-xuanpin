# Temu 选品运营台使用手册

本手册供运营人员使用。日常操作不需要打开 VS Code，也不需要输入 npm 命令。系统只读取你在独立采集 Chrome 中准备好的公开 Temu 页面，不会绕过登录、验证码或平台访问控制。

系统支持两种浏览器模式：`Managed Chrome` 由运营台维护独立 profile；`External Chrome` 只连接运营人员自行启动并开启 CDP 的 Chrome。External 模式不会创建或复制 profile，不会修改 Cookie、Token、登录或站点状态，也不会在运营台退出时关闭用户 Chrome。其连接地址由管理员在 `browser.cdpEndpoint` 配置，运营人员准备好页面后点击“连接已有 Chrome”。

## A. 第一次使用

1. 保持项目文件夹完整，不要移动其中的 `data`、`browser-profile-day4`、`outputs` 和 `config.json`。
2. 双击根目录的 `启动Temu运营台.vbs`。
3. 等待浏览器自动打开 `Temu 选品运营台`。若 15 秒后仍未打开，查看 `logs/dashboard.log`，或联系开发人员。
4. 页面右上角显示“采集 Chrome 已连接”后，才能开始采集。
5. External 模式必须先由运营人员登录 Temu、设置 Germany / English / EUR、进入摩托配件并选择 Top Sales，再点击“连接已有 Chrome”和“验证当前页面”。只有状态为 `READY` 才能开始。

## B. 打开 Chrome

点击“打开采集 Chrome”。系统会打开专用 Chrome，它与日常浏览器资料分开。不要复制或替换这个浏览器的 profile。

## C. 登录 Temu

在专用 Chrome 中人工登录 Temu。不要把 Cookie、Token 或验证码发给任何人。登录完成后保留 Chrome，不要关闭。

## D. 进入类目

进入德国站 `Automotive → Motorcycles & Powersports Accessories`。页面必须确实显示摩托车或动力运动配件商品。

## E. 选择 Top Sales

在类目页面选择 `Top Sales` 排序，等待商品卡片正常出现。若运营台提示“未确认 Top Sales”，返回 Chrome 重新选择并等待页面加载完成。

## F. 开始采集

回到运营台，按当天验收要求点击“开始 100”或“开始 300”。Day 7 验收前不要点击“开始 1000”。开始后页面会显示 job_id、目标数、已发现、已保存、成功和失败数量。

同一时间只能有一个浏览器采集任务。若提示已有任务运行，请先处理当前任务。

## G. 暂停

点击“暂停”后不要强制关闭程序。运营台会显示“等待安全边界”，采集程序先保存 checkpoint，再在一轮滚动结束的位置暂停。已成功数据不会删除。

## H. 继续

确认 Chrome 页面仍正确后点击“继续”。系统使用原 job_id 和数据库 checkpoint 恢复，不会新建同 job 快照，也不会重复商品身份。

## I. 失败重试

点击“重试失败”只会接受网络超时、Chrome 断开等可恢复错误。页面类目错误、永久数据错误等不会被盲目重试；先按提示修正页面或配置。

## J. 导出 Excel

任务完成后点击“导出 Excel”。Excel 只从 v2 SQLite 正式数据库生成，导出不会重新访问 Temu 图片 CDN，也不会把 Excel 内容写回数据库。

## K. 打开 Excel

点击“打开 Excel”会打开最新有效版本。商品主图、商品链接、数据质量、任务记录、字段说明和既有人工备注都会保留。

如果运营台提示电脑未设置 Excel/WPS，请先安装 Microsoft Excel 或 WPS，并在 Windows 中把 `.xlsx` 设为该程序的默认打开方式。

## K.1 清除 Excel（测试用）

点击“清除 Excel”后必须在确认窗口中再次确认。系统会把当前导出的 Excel 移入 `outputs/week1-mvp/.excel-history/` 历史备份，而不是删除数据库、图片缓存或人工备注来源。之后点击“导出 Excel”即可生成一份新的 Excel。

如果提示文件被占用，请先关闭 Excel/WPS 中打开的所有运营 Excel，再重新点击清除。

## L. 网络或 VPN 异常

若提示网络连接异常：

1. 检查公司网络和 VPN 是否可用。
2. 在采集 Chrome 中刷新当前 Temu 页面，确认图片和商品正常显示。
3. 不要删除数据库或 Chrome profile。
4. 页面恢复后点击“继续”或“重试失败”。

## M. 验证码或登录人工关卡

程序不会绕过验证码。请在采集 Chrome 中人工完成验证码或登录，确认商品列表恢复后，再回运营台点击“继续”。

## N. Chrome 被关闭

已写入数据不会丢失。重新点击“打开采集 Chrome”，登录并准备同一类目 Top Sales 页面，然后对原任务点击“继续”或“重试失败”。

## O. Excel 被占用

如果 Excel/WPS 正打开固定文件，导出会自动保存带时间戳的新版本。关闭旧 Excel 后，可点击“打开 Excel”打开最新有效版本。不要手动覆盖或删除仍在使用的文件。

## P. Dashboard 被关闭

采集任务和状态保存在 SQLite，不依赖网页内存。重新双击 `启动Temu运营台.vbs` 后，历史任务、暂停/中断状态、checkpoint 和事件日志仍会显示。若采集子进程仍在运行，它会继续写数据库；若已中断，点击“继续”。

## Q. 绝对不能删除的文件或目录

- `data/temu_research_v2.db` 及同目录的 `-wal`、`-shm` 文件
- `browser-profile-day4/`
- `outputs/week1-mvp/image-cache/`
- `outputs/week1-mvp/Temu运营商品池*.xlsx`
- `config.json`
- `db/migrations/`
- `logs/` 中正在用于排查的日志

不要用旧 Excel 覆盖数据库，不要复制日常 Chrome profile 到采集 profile，不要删除失败任务；失败历史是恢复和排查依据。

## 完整运营流程

双击启动入口 → 打开采集 Chrome → 人工登录 Temu → 进入摩托配件类目 → 选择 Top Sales → 点击开始 → 查看进度 → 安全暂停 → 继续原 job → 导出 Excel → 打开 Excel。

完成后可以关闭运营台网页。不要在任务运行或正在导出时强制关机。
