# 当前项目阶段

Week1：PASS

Week2：

- Day8 PASS
- Day8.1 PASS
- Day8.2 PASS

Day9：External CDP 方案终止。

原因：

- `SESSION_CONTEXT_PROBLEM`
- `CDP_ATTACHED_ENVIRONMENT_INCOMPATIBLE`

当前方案：Day9.5 Semi-Automatic Daily Chrome Review Capture。

# 当前已完成

- `browser-extension/manifest.json`：Chrome Manifest V3、最小 `activeTab` 权限、仅允许 `https://www.temu.com/*` 与 `http://127.0.0.1:37821/*`。
- `browser-extension/content-script.js`：仅处理用户当前已打开的 Temu 商品页，显示“采集当前商品评论”按钮并读取已显示的评论节点。
- `browser-extension/popup.html` 与 `popup.js`：显示 `goods_id`、当前任务匹配结果、`cutoff_date`、开始采集按钮和状态。
- `browser-extension/background.js`：以 `credentials: 'omit'` 调用固定本机 Extension API。
- localhost Extension API：查询任务匹配及接收当前页面评论批次；仅扩展端点启用无凭据 CORS。
- 复用既有 review parser、review repository、30 天 cutoff、稳定 review ID/fingerprint dedupe 和 SQLite 覆盖记录。
- `goods_id` 与当前 `www.temu.com` 商品 URL 双重校验；非当前 Day9 任务商品被拒绝。
- 安全设计：不读取或导出 Cookie、Token、Local Storage 敏感数据或 Chrome profile；扩展只请求当前标签的临时访问权。
- 测试：Manifest/敏感权限静态测试及 localhost API 集成测试已加入；`npm run check`、`npm test`、`git diff --check` 已通过。

# 当前未完成

尚未执行真实单商品评论 smoke。

# 明天公司电脑唯一下一任务

Day9.5：单商品真实评论 smoke。

流程：

公司电脑 `git pull`
→ 加载 `browser-extension`
→ 启动运营台
→ 创建/准备 1 商品 Day9 任务
→ 日常 Chrome 打开目标商品
→ Extension 匹配 `goods_id`
→ 人工点击采集
→ 评论写入 SQLite
→ QA

# 明天禁止

- 不重新尝试 External CDP
- 不创建新 profile 实验
- 不开始 3 商品
- 不开始 10 商品
- 不开始 50 商品
- 不开始 Day10
- 不做 AI 评论分析

# 当前核心数据

本交接检出副本没有 `config.json`，也没有任何本地 SQLite 数据库；数据库不纳入 Git，因此不能在此处可靠地记录正式数据数量，禁止伪造。

公司电脑准备 smoke 前，在正式运营台数据库查询并记录：

- `products`
- `catalog_memberships`
- `product_snapshots`
- `catalog_memberships` 中 `active=1` 的数量（active memberships）

最新 migration：`013_review_session_recovery.sql`。

# Git信息

- branch：`refactor/week1-catalog-core`
- HEAD（本次 Day9.5 handoff 提交前）：`a8a3e3eb5fd8c4fd85c6a2652ae71251d91a1e96`
- commit message：`feat: add Day9 session recovery and operator Chrome workflow`
- 创建本文档前的 git status：仅包含 Day9.5 的 browser extension、localhost API、review operator extension 适配、对应测试和本文档；无无关文件。
