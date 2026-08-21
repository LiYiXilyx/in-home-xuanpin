# 项目当前状态

## 当前阶段

Week1 PASS / Week2 准备阶段。

Gate D 已通过：真实 Temu 德国站摩托配件 Top Sales 商品池已完成 1,000 条采集、去重、图片缓存、分类与 Excel 验收。

## 已完成能力

- 商品采集：通过页面健康检查后，从当前 Temu 商品列表采集；支持深滚动、`Try again` 人工加载门、checkpoint、暂停、继续、取消与失败重试。
- 1,000 商品池：Gate D job `job_f902639b70a5412daa74b73602fda888` 已完成，发现、写入、成功均为 1,000。
- 数据库：v2 SQLite 已正式使用，稳定商品身份为 `platform + goods_id`。
- 快照：`products`、`catalog_memberships`、`product_snapshots`、`crawl_job_items`、`crawl_events`、`data_quality_checks` 已启用并保持幂等。
- 图片：本地图片缓存支持 browser / Node fallback、格式校验和 SHA-256；Gate D active 商品可用图片覆盖率为 99.2%（992 / 1,000）。
- Excel：从 v2 SQLite 导出商品池、数据质量、任务记录、字段说明四张工作表；带嵌入图片、完整 URL 超链接、筛选、冻结标题行及人工字段按 goods_id 保护。
- 分类：Week1 规则分类已完成，保留分类理由、置信度、规则版本和 `needs_review`。
- 运营台：支持任务查看、暂停/继续/取消、重试、导出/打开 Excel、打开结果目录和页面健康诊断。
- External Chrome：支持连接由运营人员启动的带 CDP 端口 Chrome；系统只连接，不复制 profile、不读写 Cookie/Token、不关闭用户 Chrome。

## 当前数据库状态

- products：1,027
- active memberships：1,000
- product snapshots：2,200
- 最新 job：`job_9cf98ab389cc4958bd4d216d579761df`（export，completed，目标商品池 1,000）
- Gate D catalog job：`job_f902639b70a5412daa74b73602fda888`（completed，1,000 / 1,000 / 1,000）
- 最新 Excel：`outputs/week1-mvp/Temu运营商品池-20260821-095300-599.xlsx`

## 当前代码状态

- 当前分支：`refactor/week1-catalog-core`
- 最新 commit：`bc22b4a fix: stabilize export QA and manual values`
- GitHub 已同步至：`github/refactor/week1-catalog-core`
- 本机交接快照创建前已有未跟踪文件：`docs/TEMU_WEEK2_PRODUCT_INSIGHT_CODEX_PLAN_V3第二周计划.md`（未提交，作为 Week2 计划文档保留）。

## 下一阶段

Week2 计划：`docs/TEMU_WEEK2_PRODUCT_INSIGHT_CODEX_PLAN_V3第二周计划.md`。

从 Day8 开始：市场分析模块。

## 已知风险

- 评论采集风险：Temu 详情页评论区可能受登录、验证码、分页、动态渲染和频率限制影响；不得绕过验证码或伪造数据。
- Temu 详情页风险：详情页 URL、字段布局、库存与地区可见性可能变化；应先做页面健康/字段校验，再写入正式数据。
- 浏览器环境差异：独立 profile 曾出现搜索或类目空结果。优先使用运营人员人工确认正常的 External Chrome + CDP 模式；继续保持 Germany / English / EUR，并在采集前检查 `READY`。

## 家里电脑继续步骤

1. 克隆仓库后切换至 `refactor/week1-catalog-core`，执行 `git pull github refactor/week1-catalog-core`。
2. 检查 Node、npm、Chrome、Playwright、SQLite 数据库路径、图片与 Excel 输出目录；不要复制公司 Chrome profile、Cookie 或 Token。
3. 阅读本文件和 Week2 计划文档，确认 Gate D 数据与环境状态。
4. 从 Day8 市场分析模块开始；不要重做 Week1 已验收的采集、数据库、图片、Excel、分类和运营台核心能力。
