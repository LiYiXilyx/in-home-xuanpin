# Catalog Scale Day4 — Refresh 1000 Runbook

## 安全边界

- 商品身份始终是 `platform + goods_id`；URL 只作历史证据和导航 fallback。
- 不删除 `products`、`product_snapshots`、`reviews` 或历史 memberships。
- `not_seen_in_campaign` 只是本轮观察结果，不会直接把 membership 改成 inactive。
- 电子硬排除只写 exclusion audit，不进入 staging、snapshot 或新 Pool Version。
- 真实页面操作只由影刀接管现有健康 Chrome；Node 是正式 SQLite 的唯一写入者。

## 执行顺序

1. 停止其他生产 SQLite 写进程并创建 consistent backup。
2. 应用 `018_catalog_refresh_baseline.sql`。
3. 用 `tools/catalog-refresh-admin.mjs create` 创建独立 `campaign_type=refresh` Campaign。
4. 创建时系统冻结当时 active memberships 对应的旧商品集合，后续对账不受运行期间变化影响。
5. 影刀接管已确认健康的 Motorcycle Accessories / Top Sales 页面，复用 Day3 的自动循环：滚动、See more、等待、触发 Catalog Extension。
6. 每轮 Extension 通过 localhost API 写 staging；验证码或列表上下文异常进入 `manual_required` 并从原 Campaign checkpoint 恢复。
7. 达到 1000 个非电子唯一商品后完成 source。
8. 运行 `materialize`：按 `platform + goods_id` upsert products，每个 staging 商品写入本轮唯一 snapshot；新 membership 初始不激活，旧 membership 的 active 状态不因 not-seen 改变。
9. 运行 `qa`：自动检查数量对账、snapshot、reviews 不变、重复、电子混入和字段覆盖率。
10. 只有 Campaign `completed` 且 QA `passed` 后运行 `activate`；Pool Version 切换和回滚审计在同一事务完成。

## QA 阈值

- goods_id 100%，duplicate 0，电子商品进入新池 0。
- title、price、image 各不低于 95%。
- sales、rating、review_count 各不低于 90%。
- `snapshots_inserted = new_observed_unique_count`。
- reviews 前后必须完全一致。
- `intersection + new_goods = new_observed`。
- `intersection + not_seen = old_active`。

## 导航风险语义

允许记录 `historical_url_status`、`fresh_navigation_status`、类目卡可用、搜索上下文错配和未解析数量。没有执行逐商品历史 URL 验证时保持 `not_checked`，不得伪造为 available，也不得映射为 `PRODUCT_NOT_FOUND`。

## 加载状态

- `LOAD_MORE_PROGRESS`：点击后出现新的 `goods_id`，正常 checkpoint 并继续。
- `LOAD_MORE_RETRYABLE`：点击后转圈但没有新增，`Try again` 重新出现；等待后只允许有限重试。
- `MANUAL_VERIFICATION_REQUIRED`：出现 CAPTCHA 或 `bgn_verification`；立即进入 `manual_required`，不得自动绕过。
- `LISTING_CONTEXT_UNHEALTHY`：出现 Oops 或商品卡归零；暂停并保留 checkpoint。

`LOAD_MORE_RETRYABLE` 一次或两次失败不能证明来源耗尽。后三种状态均不得提交 `SOURCE_EXHAUSTED`；Node 会以 `CATALOG_SOURCE_EXHAUSTION_NOT_PROVEN` 拒绝错误完成。

## 失败处理

数量不足、字段覆盖不足、snapshot 不精确、reviews 变化或电子商品混入时，Campaign 转为 `qa_failed`，staging 与审计保留，新 Pool Version 不激活。不得新建 Campaign 来掩盖可恢复的 checkpoint。
