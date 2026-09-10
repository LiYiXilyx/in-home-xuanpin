# Catalog Scale V2 Runbook

当前阶段：Scale Day1 数据底座。本文只定义离线模型和安全边界；Catalog Extension、localhost Catalog API、影刀和真实 Temu 采集从 Day2/Day3 开始。

## 不可变安全规则

- 商品身份始终是 `platform + goods_id`。
- `source_url` 与 `canonical_url` 只是历史证据、兼容引用或导航 fallback。
- 历史 URL 显示 sold out、一次搜索 No results、一次 campaign 未出现，都不能直接判定商品下架。
- 不删除历史 `products`、`product_snapshots`、`reviews`、memberships、jobs、errors 或 classifications。
- 新 campaign 在 staging、QA 和 pool version Gate 全部通过前，不修改旧 active Pool。
- 默认目标为 `non_electronic_unique_count = 3000`。

## Day1 数据流

```text
Category Profile
→ Campaign
→ Sources / Source Runs / RPA Queue
→ Capture Batch（campaign + source + batch_id 幂等）
→ 电子规则筛选
   ├─ 硬排除 → catalog_exclusion_observations
   └─ passed/manual_review_required → catalog_staging_products
→ QA
→ Pool Version Gate
```

`manual_review_required` 不计入 `non_electronic_unique_count`，不得用于凑目标数量。

## Campaign计数

- `raw_observed_count`：首次接收的幂等批次卡片总数。
- `electronic_excluded_count`：排除审计中可识别 goods_id 的唯一数。
- `non_electronic_unique_count`：staging 中电子筛选为 `passed` 的唯一数。
- `business_eligible_count`：上述 passed 商品中业务准入为真的数量。
- `reviewable_unique_count`：上述 passed 商品中可抓评论的数量。

## Refresh语义

旧 active 商品本轮未出现时，仅写：

```text
catalog_campaign_product_observations.observation_status = not_seen_in_campaign
```

不得调用旧 `persistCatalogBatch() → deactivateMissing()` 作为 Scale Refresh 的切池方式。实际激活必须由 QA 通过后的 Pool Version 事务负责。

## Pool Version Gate

激活前必须同时满足：

1. campaign 状态为 `completed`；
2. `qa_status = passed`；
3. campaign 默认 Gate 的实际数量达到 `target_count`。

失败或低数量 campaign 保留 staging、batch 和 exclusion audit，不创建 active pool version，也不修改旧 memberships。

## Migration执行边界

Day1 migration：`017_catalog_scale_v2.sql`。

开发和验收只在临时测试数据库执行。未经单独授权，不对 `data/temu_research_v2.db` 执行017。

## Day1验证命令

```powershell
node --test test/unit/category-profile.test.mjs
node --test test/integration/catalog-campaign.test.mjs
node --test test/integration/migrations.test.mjs
npm run check
npm test
git diff --check
```
