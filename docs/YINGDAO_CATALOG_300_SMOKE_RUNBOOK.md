# 影刀 Catalog 300 Smoke Runbook

仅用于 Scale Day3：Motorcycle Accessories / Germany / English / EUR / Top Sales。影刀不得读取 SQLite、Cookie、Token 或浏览器 profile，也不得自行去重或判断电子商品。

## 前置条件

1. 正式 Review localhost 服务已停止。
2. `review_queue` 非终态数量为 0。
3. 正式 SQLite 已完成一致性备份并应用 `017_catalog_scale_v2.sql`。
4. Catalog campaign 状态为 `running`，且已创建 source/RPA queue。
5. Chrome 已重新加载本仓库 `browser-extension/`，Temu 页面可见“采集当前商品列表”。

## API 顺序

服务固定为 `http://127.0.0.1:37821`。

1. `POST /api/catalog-rpa/claim-next`

   ```json
   { "campaign_id": "..." }
   ```

   保存返回的 `queue.id` 与 `queue.claimToken`。影刀不得自行生成 claim token。

2. 从 Temu 首页进入目标类目，确认 Germany / English / EUR / Top Sales 后调用：

   `POST /api/catalog-rpa/source-opened`

   ```json
   { "queue_id": "...", "claim_token": "...", "page_url": "..." }
   ```

3. 每轮点击页面按钮“采集当前商品列表”。等待 `#temu-catalog-capture-status[data-state="completed"]`，读取其 `data-batch-id`、`data-raw-observed-count`、`data-non-electronic-unique-count`。

4. 每轮调用 `POST /api/catalog-rpa/checkpoint`：

   ```json
   {
     "queue_id": "...",
     "claim_token": "...",
     "status": "capturing",
     "checkpoint": {
       "scroll_rounds": 1,
       "load_more_count": 0,
       "new_goods_per_round": [40],
       "stale_rounds": 0,
       "manual_gate_count": 0,
       "last_batch_id": "...",
       "product_card_count": 40,
       "page_url": "..."
     }
   }
   ```

5. 滚动到底并检测 `Try more`、`Try again`、`Load more`、`See more`。点击后必须等待新的 `goods_id` 出现，再采下一批。等待期间 checkpoint 状态可设为 `waiting_load_more`。

6. 遇到 CAPTCHA、No results、Oops、类目/排序错位、商品卡归零或连续无新增时，调用 `POST /api/catalog-rpa/manual-required`，错误使用 `CATALOG_CONTEXT_MISMATCH`、`SEARCH_CONTEXT_MISMATCH` 或 `LISTING_CONTEXT_UNHEALTHY`，然后停止自动操作。不得绕过 CAPTCHA。

7. 人工确认页面恢复后调用 `POST /api/catalog-rpa/resume`，继续原 queue、claim token 和 checkpoint。重新提交同一 batch 必须得到 idempotent replay。

8. Gate 达到 300 后调用 `POST /api/catalog-rpa/source-complete`，`stop_reason` 使用 `TARGET_GATE_REACHED`。

## 停止条件

- `non_electronic_unique_count >= 300`；或
- 进入 `manual_required` 等待人工；或
- source 明确完成且 Node QA 决定下一步。

不得激活 Pool Version，不得修改旧 `products`、snapshots、reviews 或 active memberships。
