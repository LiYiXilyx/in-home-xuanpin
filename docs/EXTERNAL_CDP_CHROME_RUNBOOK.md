# External CDP Chrome 使用说明
[EXTERNAL_CDP_CHROME_RUNBOOK.md](C:/Users/Administrator/Documents/ChatGPT/选品上架-家里版本/temu选品/docs/EXTERNAL_CDP_CHROME_RUNBOOK.md)
## 1. 这个方法叫什么

这个运行方式叫：

**External Chrome / External CDP 模式（外部 Chrome 调试连接模式）**。

运营台不负责创建或管理 Chrome profile，只通过 Chrome DevTools Protocol（CDP）连接一个由运营人员提前启动的 Google Chrome。当前使用的本地调试端口是 `9222`。

普通方式已经启动的 Chrome 不能临时附加 CDP。Chrome 必须在启动时带上 `--remote-debugging-port=9222`，并使用一个专用的 `user-data-dir`。

## 2. 为什么使用这个模式

此前 Managed Chrome 的独立 profile 在 Temu 中出现过以下问题：

- 点击 Categories 后没有正常商品结果；
- 搜索普通关键词仍显示 `No results`；
- 类目页显示 `Oops! The items are gone.`；
- 页面提示网络连接异常；
- 相同网络下，人工准备的 Chrome 页面却可以正常展示商品。

External CDP 模式允许运营人员先在一个可正常访问 Temu 的 Chrome 中人工完成登录、国家、语言、币种、类目和 Top Sales 设置，再让运营台只读连接该 Chrome。它不会复制日常 Chrome profile，不读取或打印 Cookie、Token，也不会在运营台退出时强制关闭用户 Chrome。

这次恢复商品类目操作的关键是：

1. 使用带 CDP 端口的 External Chrome；
2. 人工进入真实可见的摩托车配件商品列表；
3. 运营台验证 `READY` 后才允许采集；
4. 当多个 Temu 标签页同时打开时，运营台优先选择类目/搜索列表页，不再误选商品详情页。

## 3. 推荐启动步骤（运营人员）

日常使用不需要打开 CMD，也不需要输入 Chrome 命令：

1. 双击项目根目录的 `启动Temu采集Chrome.vbs`，它只负责使用 `C:\TemuExternalChrome` 启动 CDP 9222，不打开 CMD、不强制导航 Temu；
2. 在该 Chrome 中人工登录并准备摩托配件 Top Sales 页面；
3. 双击 `启动Temu运营台.vbs`，它只启动运营台并连接已经存在的 Chrome，不改变浏览器页面；
4. 点击“验证当前页面”。

脚本不会复制日常 Chrome profile，不会自动登录，不会绕过验证码，也不会关闭用户 Chrome。

## 4. 手工启动步骤（仅故障恢复）

### 第一步：关闭 Google Chrome

完全退出所有 Google Chrome 窗口。Microsoft Edge 和 Temu 运营台可以继续保持打开。

### 第二步：运行 External Chrome

按 `Win + R`，粘贴以下命令并回车：

```text
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\TemuExternalChrome"
```

如果提示找不到 Chrome，尝试：

```text
"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\TemuExternalChrome"
```

`C:\TemuExternalChrome` 是专门用于 External CDP 的数据目录。它不是日常 Chrome 的默认 profile，也不会复制日常 Chrome 的 Cookie 或站点状态。

### 第三步：人工准备 Temu 页面

在新打开的 Chrome 中：

1. 打开 Temu；
2. 人工登录；
3. 设置 `Germany / English / EUR`；
4. 从 Temu 首页进入摩托车配件类目；
5. 选择 `Top Sales`；
6. 确认页面中真实显示商品卡片。

不要长期复用带 `_x_sessn_id`、`refer_page_id` 等会话参数的旧地址。优先从 Temu 首页、Categories 或站内搜索重新进入。

### 第四步：连接运营台

1. 保持 External Chrome 不关闭；
2. 回到 Temu 选品运营台；
3. 点击“连接已有 Chrome”；
4. 点击“验证当前页面”。

验证通过后应显示：

- `External Chrome 已连接 · CDP 9222`
- `PRODUCT_LIST_VISIBLE = YES`
- `CATEGORY_CONFIRMED = YES`
- `TOP_SALES_CONFIRMED = YES`
- `PAGE_HEALTH = READY`

只有状态为 `READY` 时，开始采集按钮才会启用。

## 5. 多个 Temu 标签页

可以同时打开多个 Temu 标签页，但建议目标摩托车配件列表页保持打开。运营台会优先选择类目或搜索商品列表页，并降低单个商品详情页的优先级。

如果诊断参数显示了错误页面：

1. 切换到目标摩托车配件标签页；
2. 确认 Top Sales 和商品卡片仍可见；
3. 再次点击“验证当前页面”。

## 6. 常见问题

### 无法连接 CDP 9222

- 确认 Chrome 是通过上述命令启动；
- 确认没有另一个程序占用 9222；
- 普通双击启动的 Chrome 不具备该端口；
- 完全退出 Chrome 后重新执行命令。

### 显示 NOT_READY

根据页面状态处理：

- `CAPTCHA_OR_LOGIN`：人工登录或完成验证码；
- `SEARCH_NO_RESULTS`：从 Temu 首页重新搜索或进入类目；
- `STALE_CATEGORY_PAGE`：不要复用旧会话 URL，从首页重新进入；
- `NETWORK_ERROR`：检查当前网络或 VPN；
- `CATEGORY_NOT_CONFIRMED`：进入摩托车配件类目；
- `SORT_NOT_CONFIRMED`：重新选择 Top Sales。

系统不会绕过验证码，也不会在 `NOT_READY` 状态下强制采集或写入空商品池。

## 7. 安全边界

- 不复制日常 Chrome profile；
- 不读取或输出 Cookie、Token、Authorization；
- 不自动登录；
- 不绕过验证码；
- 不强制关闭 External Chrome；
- 运营台关闭时只断开 CDP；
- 页面未达到 `READY` 时禁止采集。

## 8. 推荐日常流程

```text
双击启动Temu采集Chrome.vbs
→ 人工准备 Top Sales 页面
→ 双击启动Temu运营台.vbs并自动连接
→ 人工登录并准备 Germany / English / EUR
→ 进入摩托车配件 + Top Sales
→ 连接已有 Chrome
→ 验证当前页面
→ READY
→ 开始采集
→ 导出 Excel
```
