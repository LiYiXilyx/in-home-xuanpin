# Girls' Sets OPEN_ENDED Batch Limit & Capture Transport Policy Fix V1

## 目标与边界

本设计修复 `OPEN_ENDED` Manual Bind 采集把 `maxCards=null` 错算为 `0`、随后首条即退出的问题，并为不同 Campaign 建立集中式 Capture Transport Policy。仅对现有 Girls' Sets Initial Campaign 做一次有限生产采集验收；不删除已有 1 条数据，不重建 Campaign/Profile，不自动滚动或点击 See more，不改变 Motorcycle、Full Refresh、Active Pool、taxonomy 或 YingDao。

## 已确认根因

`catalog-manual-passive-runner.js` 对 OPEN_ENDED 调用 `capturePassive({maxCards:null})`。`catalog-capture.js` 当前计算 `Math.max(0, Math.min(300, Number(maxCards)||0))`，得到 `limit=0`；循环加入第一条后 `cards.length >= 0` 成立，因此每次最多提交 1 条。

上一轮严格交集修复又把全部 Manual Bind Campaign 统一要求为 DOM/Network 全覆盖。这保护了严格任务，但错误阻止 Capture-only Initial 使用可靠 DOM 原始卡片。数量限制与 transport gate 必须分别修复。

## 数量解析

新增唯一入口 `resolvePassiveBatchLimit(maxCards)`：

- `null`/`undefined`：返回 `MAX_CARDS_PER_BATCH`（300）。
- 正整数：返回 `min(maxCards, 300)`。
- `0`、负数、NaN、非整数：抛出 `INVALID_PASSIVE_BATCH_LIMIT`，0 writes。

`0` 永远不表示不限数量。OPEN_ENDED 业务语义仍为无总目标，但每次人工点击最多提交 300 条。

## Capture Transport Policy

新增集中式 `resolveCaptureTransportPolicy({campaign, profile})`，仅返回：

- `DOM_REQUIRED_NETWORK_OPTIONAL`
- `NETWORK_ENRICHED_REQUIRED`

解析顺序：

1. Campaign config 中冻结的合法 policy 优先；非法值 HARD FAIL。
2. 兼容现有不可变 Campaign：`profile_kind=CAPTURE_ONLY`、`campaign_type=initial`、`browser_control_mode=MANUAL_BIND_PASSIVE_CAPTURE` 时，确定性解析为 `DOM_REQUIRED_NETWORK_OPTIONAL`，来源 `DERIVED_CAPTURE_ONLY_INITIAL_V1`。
3. 其余 Campaign 均为 `NETWORK_ENRICHED_REQUIRED`，来源 `LEGACY_STRICT_DEFAULT_V1`。

新 Campaign 创建时冻结解析结果到 Campaign config；本轮不修改现有 Girls' Sets Profile 或历史 Campaign 行。

## 候选生成

候选始终从当前真实 DOM 按 DOM 顺序遍历，Network-only 永不提交。

`DOM_REQUIRED_NETWORK_OPTIONAL`：

- 同 goods_id 有有效 Network record：调用 `mergeDomNetwork`，标记 `NETWORK_ENRICHED`、`network_observed=true`。
- 无 Network record：DOM card 必须满足 goods_id、有效 Temu source/canonical URL、非空 title、当前 binding/category/profile/timestamp；缺少价格、销量、评分、评论或图片保存为 null，标记 `DOM`、`network_observed=false`。

`NETWORK_ENRICHED_REQUIRED`：仅提交 DOM 与 Network goods_id 严格交集；保持现有 Motorcycle/Refresh 行为。

服务端 `validateManualPassiveBatch` 使用同一 policy resolver：DOM-optional 允许合格 `DOM`，strict 仍要求有效 Network 证据。两者都验证 Page Binding、DE/English/EUR、Category/Profile、URL、Top Sales，并拒绝 Network-only。

## 页面身份与 Transport Gate

页面身份检查独立于 transport：country、language、currency、listing path、category、breadcrumb、sort、商品卡、非 CAPTCHA、非 SEARCH_NO_RESULTS 全部必须 PASS。

Transport 状态：

- DOM optional 且 eligible DOM > 0：`READY_WITH_DOM`；交集不足是 warning，不阻断。
- Strict 且 intersection > 0：`READY_NETWORK_ENRICHED`。
- 无合格候选：`BLOCKED`。

展示 `DOM_VISIBLE_GOODS`、`NETWORK_CACHED_GOODS`、`DOM_NETWORK_INTERSECTION`、`DOM_ONLY_ELIGIBLE`、`NETWORK_ONLY_REJECTED`、`TOTAL_ELIGIBLE_FOR_CURRENT_POLICY`。商品数量增加不改变 binding fingerprint；页面身份字段变化仍使 binding 失效。

## 结果统计契约

数据库批次响应是 received/new/duplicate/excluded 的权威来源：

- received = `batch.receivedCount`
- new = `audit.acceptedGoods`（并与 unique delta 交叉校验）
- duplicates = `batch.duplicateCount` / 正式 dedupe
- excluded = `batch.excludedCount`
- failed = 正式失败计数；无字段时为 0，不从候选数推测
- current = 刷新后的 `campaign.nonElectronicUniqueCount`

Transport 保存统计来自本批实际提交并经服务端验证的 cards，随 batch audit 返回 `networkEnrichedSaved`、`domOnlySaved`、`networkOnlyRejected`。不得用 Network cache 总量冒充落库量。Toast 与面板显示收到、新增、重复、业务排除、失败、累计及 transport 分项。

## 安全与兼容

- identity 保持 `platform + goods_id`。
- 已有 goods_id 由服务端 Campaign staging dedupe；重复点击不新增。
- 网络数据只能增强同 goods_id DOM card；Network-only 0 persistence。
- Full Refresh 原销量证据和 target gate 不变。
- Girls' Sets Profile/Campaign 数量保持 1。
- Preview Export 必须显式绑定当前 Campaign/Category/revision，行数等于当前有效唯一数。
- 自动测试只使用 temporary/fixture SQLite；生产写入仅限最终授权的一次当前页 capture 和随后 scoped preview export。

## TDD 与交付

TDD 覆盖 null/undefined/显式 limit、300 上限、两种 transport、DOM 最低字段、Network-only 拒绝、dedupe/See more delta、真实统计 Toast、页面 gate、Motorcycle/Refresh/YingDao 回归。Design、Plan、各任务独立 commit；feature 和 stable 仅普通 push。最终在稳定 runtime 重跑 full suite，失败集合必须精确等于已批准 7 项，新增失败为 0。

生产验收前重新核验 Campaign/Profile/status/queue/source/page/binding/policy；只点击一次采集。若 unique 未增加则停止。成功后严格 scoped 重导 Preview Excel，校验行数/Category/Campaign/图片统计，Finder 仅打开目录。
