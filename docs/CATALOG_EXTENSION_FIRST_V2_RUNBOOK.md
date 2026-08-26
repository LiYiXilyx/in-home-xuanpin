# Catalog Extension-First V2 Runbook

## 职责边界

- 影刀只接管健康 Chrome、进入 Category Profile、确认 Germany / English / EUR / Top Sales，并在人工验证后重新触发 Resume。
- Browser Extension 扫描商品卡、滚动、触发公开页面上的 See more / Try again / Try more / Load more / Show more、验证新 `goods_id`、提交批次并保存 checkpoint。
- Node 保持负责 Campaign、Queue、staging、electronic exclusion、dedupe、QA 与 Pool Version。
- Extension 不读取 Cookie/Token、不调用 Temu 私有 API、不绕过 CAPTCHA。

## 第一次启用

1. 暂停影刀旧的滚动/点击循环。
2. 在健康 Profile 打开 `chrome://extensions/`。
3. 重新加载“Temu Catalog 与评论采集”扩展（版本 0.3.0）。
4. 回到已确认健康的 Motorcycle Accessories / Top Sales 页面并刷新一次。
5. 确认页面存在真实商品卡、蓝色手工采集按钮和 `Catalog Extension Auto Runner` 面板。

## 已完成的 A/B 100 小样本

V2 验收阶段使用 `non_electronic_unique_count + 100` 的临时 session target 完成验证。A/B 已结束，正式版本不再展示临时 A/B 控件。

每轮 checkpoint 记录：

- round、batch_id、raw_observed、current_unique、non_electronic_unique、excluded_unique、manual_review
- scroll_height、card_count、button_detected、button_label、load_more_attempt、last_progress_at
- load_more_success_count、retry_count、captcha_count、oops_count、manual_intervention_count
- batch_duplicate_count、batch_idempotent_replay、extension_error_count、elapsed_ms

## 加载判定

- 出现新的 `goods_id`：`LOAD_MORE_PROGRESS`。
- DOM click 后 loading 结束、按钮再次出现且没有新 `goods_id`：`LOAD_MORE_RETRYABLE`。
- 同一轮首次触发加一次 retry 均无进展：`LOAD_MORE_RETRYABLE_EXHAUSTED`，进入 `manual_required`。
- CAPTCHA / `bgn_verification`：`CAPTCHA_OR_LOGIN`，立即停止。
- Oops、列表异常或商品卡从正数变为 0：`LISTING_CONTEXT_UNHEALTHY`，立即停止。

这些状态均不得写成 `SOURCE_EXHAUSTED` 或 `PRODUCT_NOT_FOUND`。

## 控制按钮

- `开始自动采集`：按现有 Campaign Gate 开始正式采集；必须由运营者明确点击。
- `暂停`：在当前安全边界停止循环并保存 checkpoint。
- `继续`：复用现有 Campaign / Source / Queue 和已保存的 session target。
- `停止`：停止 Auto Runner，但不完成 Source、不创建新 Campaign、不切换 Product Pool。

Extension 重载后只恢复显示 Node checkpoint，不会自动点击页面。运营者必须明确点击 `继续`。

## CAPTCHA 恢复

1. 不刷新、不反复点击，先完成人工验证。
2. 确认真实商品卡恢复、Category 与 Top Sales 仍正确。
3. 点击 Auto Runner 的 `继续`。
4. Runner 从原 Queue checkpoint 继续；不得重建 Campaign。

## Load More 人工兜底

当 Runner 因两次 DOM 触发均无新 `goods_id` 而进入 `LOAD_MORE_RETRYABLE_EXHAUSTED`：

1. 只人工点击当前 `Try again` / `See more` 一次。
2. 确认 loading 后出现新商品卡；如果出现 CAPTCHA，先完成验证。
3. 点击 Auto Runner 的 `继续`。
4. Runner 从原 session target 和 Queue checkpoint 继续，不能再次增加 100，也不能创建新 Campaign。

人工点击属于正式安全兜底，不应被统计为 Extension 自动成功；checkpoint 必须增加一次 `manual_intervention_count`。

## A/B 采用 Gate

至少比较 A（影刀旧高频流程）与 B（Extension Auto Runner）各 100 个非电子商品：耗时、load-more 成功、retry、CAPTCHA、Oops、人工干预、goods/batch 重复、Extension 错误、context 失效。只有 B 的成功率更高且验证风险不增加，才正式废弃影刀高频列表按钮操作。
