# Catalog UI Delivery Manifest

## Mount Point

Catalog 独占 `#catalog-module-root`。YingDao 独占其 sibling `#yingdao-module-root`。Catalog 的 mount、refresh、loading、error、render 与 destroy 只操作传入的 Catalog root；YingDao root 可以为空、不存在或晚于 Catalog 挂载。

## Entry Functions

- `mountCatalogPanel({ root, pollIntervalMs, fetchImpl, scheduler, api, randomUUID })`：挂载并返回 Catalog controller。
- `refreshCatalogPanel()`：刷新当前已挂载 Catalog controller；未挂载时 HARD FAIL。
- Controller：`refresh()`、`getState()`、`destroy()`。

## DOM Namespace

Catalog DOM ID 与模块专属 class 统一使用 `catalog-*`。共享视觉 primitive 仅为 `.panel`、`.primary`、`.eyebrow`。Catalog 不查询或渲染 `yingdao-*` DOM，也不重绘 `document.body`。

## State Namespace

`catalogState` 的正式字段为 `profiles`、`selectedProfile`、`currentCampaign`、`currentPool`、`quantityPolicy`、`initialQa`、`activation`、`loading`、`error`、`mounted`、`lastRefreshedAt`。它不包含 `yingdaoState`、`currentRun` 或 `random5State`。

## API Namespace

Catalog UI 客户端只调用 `/api/catalog/...`。Campaign create、Initial QA 与 Activation 继续由现有明确 Category/Profile/Campaign safety gate 保护，不提供 implicit resume 或 global fallback。

## Polling

Catalog 自己持有 `catalogPollingTimer`，默认每 1500 ms 刷新 Profiles 与明确 current Campaign。并发 refresh 会合并；destroy 只清理 Catalog timer。旧 Dashboard 的 `/api/status` polling 仍由 `ui/app.js` 持有。

## Events Emitted

- `catalog:context-changed`
- `catalog:pool-activated`

事件 detail 是冻结的 `category_key`、`category_profile_version`、`campaign_id`、`pool_version_id` 副本。事件仅是可选增强提示，dispatch 缺失或失败不改变 Catalog 正确性。

## Events Consumed

Catalog V1 不消费 YingDao event。YingDao 不得依赖 Catalog event 才能恢复正式来源 identity；页面刷新、事件丢失或延迟加载后，应重新使用严格 scoped read API。

## Read APIs Exposed To YingDao

`GET /api/catalog/pools/:pool_version_id/products?category_key=:category_key&category_profile_version=:category_profile_version`

三个 identity 必须同时提供并与 Pool 精确匹配。端点无 latest/global active fallback，按 `platform ASC, goods_id ASC` deterministic 返回 `platform`、`goods_id`、`title`、`image_url`、`image_status` 及完整 scope。它不写数据库。

## Catalog Write APIs Not Available To YingDao

YingDao 集成不得调用或代理 Catalog 的 Campaign create、capture batch、Initial QA、Activation、membership、Pool、queue 或 claim 写接口。当前 localhost 没有模块级身份认证，因此这是集成契约，不是安全沙箱；不要虚构权限隔离能力。

## Files Owned By Catalog UI

- `ui/modules/catalog/panel.js`
- `ui/modules/catalog/state.js`
- `ui/modules/catalog/model.js`
- `ui/modules/catalog/api.js`
- `ui/modules/catalog/catalog.css`
- `ui/operator-campaign.js`（旧 import 的 thin compatibility re-export）

## Files Shared With Operator Shell

- `ui/index.html`：只提供 shared stylesheet、`#catalog-module-root`、`#yingdao-module-root` 与 legacy Dashboard markup。
- `ui/app.js`：legacy Dashboard shell 加 Catalog import/root resolve/mount；Browser Health、Jobs、Excel、Review、notice/toast 与 `/api/status` polling 仍留在此文件。
- `ui/styles.css`：shared/legacy Dashboard 样式，不再拥有 Catalog 专属 selector。
- `src/server/router.mjs` 与 `src/server/index.mjs`：Catalog route registration/injection 的共享后端 wiring。

## Integration Instructions

YingDao 应从本 Manifest 对应的最终累计 `SHARED_UI_COMMIT` 更新、rebase 或 merge；不能只 cherry-pick 最后的 Manifest commit，因为 Tasks 1–8 才包含实际模块边界。

允许在 `ui/app.js` 的安全修改仅限：import `mountYingdaoPanel`、解析自己的 `#yingdao-module-root`、与 Catalog 并列 mount。不得重写 Catalog import/mount/controller、legacy `refresh()`/timer，或 `/api/catalog/` write contract。YingDao 正式来源必须持有明确 `pool_version_id + category_key + category_profile_version`，通过 scoped GET 重新读取；不得读取全局 latest active products。

YingDao 推荐创建 `ui/modules/yingdao/panel.js`、独立 `yingdaoState`、`yingdaoPollingTimer` 与 `yingdao-*` DOM。Catalog 不实现 Random5、1688 搜索/价格/候选、影刀导入导出或 YingDao image-cache workflow。
