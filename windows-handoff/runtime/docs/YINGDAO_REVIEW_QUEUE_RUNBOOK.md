# 影刀 RPA 评论队列助手（Day9.7）

本文仅用于“日常真实 Chrome + 影刀 + Browser Extension + localhost Node API”。不要使用 External CDP，也不要让影刀读取 SQLite、Cookie、Token 或浏览器 profile。

## 职责边界

- 影刀：领取 goods_id、从 Temu 当前类目或站内搜索商品卡定位同一 goods_id、点击商品卡、核对详情页 goods_id、点击页面右下角“采集当前商品评论”、等待结果。
- Extension：展开评论、切换 Most recent、滚动、解析并提交批次。
- Node：队列状态、cutoff、checkpoint、去重和 SQLite 写入。

## localhost API

固定地址：`http://127.0.0.1:37821`

### 领取下一商品

`POST /api/rpa/review-queue/claim-next`

请求 JSON：

```json
{"jobId":"评论任务ID"}
```

响应中的 `result.item` 为 `null` 表示队列已无 pending 商品；否则只使用：

- `id`
- `goodsId`
- `status`
- `navigationRequired`

`sourceUrl` 已停止对影刀公开。数据库历史 URL 只保留为导航证据，不能作为首选详情入口。

### Fresh Navigation 解析

影刀在当前 Temu 类目页扫描商品卡 href，并将卡片列表提交给：

`POST /api/rpa/review-queue/{id}/navigation/resolve`

```json
{
  "goodsId":"队列goods_id",
  "sourcePageUrl":"当前类目或搜索结果页URL",
  "currentCategoryCards":[{"href":"商品卡href"}],
  "siteSearchCards":[]
}
```

当前类目没有匹配卡时，再从 Temu 站内搜索结果提交 `siteSearchCards`。返回 `NAVIGATION_NOT_RESOLVED` 时进入人工复核，不要立刻标记商品不存在。

### Fresh 详情验证

点击匹配商品卡并进入详情后调用：

`POST /api/rpa/review-queue/{id}/navigation/verify`

```json
{
  "goodsId":"地址栏实际goods_id",
  "detailUrl":"当前详情页URL",
  "detailText":"当前页面可见状态文本"
}
```

只有返回 `detailVerified=true` 和 `FRESH_DETAIL_VERIFIED` 后，队列才进入 `waiting_operator`，Extension 才能写评论。

旧的 `/waiting-operator` 接口保留兼容，但没有已验证的 fresh navigation 记录时会返回 `NAVIGATION_NOT_RESOLVED`，不能再用于跳过站内解析。

### 页面打开失败

`POST /api/rpa/review-queue/{id}/fail`

```json
{"goodsId":"队列goods_id","errorCode":"PAGE_TIMEOUT","errorMessage":"商品页等待超时"}
```

### 查询状态

`GET /api/rpa/review-queue?job_id=评论任务ID`

Extension 开始写入后，状态自动变成 `capturing`；结束后自动变成 `completed`。影刀只轮询状态，不直接写完成状态。

## 影刀流程节点

1. HTTP 请求：领取下一商品。
2. 判断 `result.item` 是否为空；为空则正常结束。
3. 保持日常 Chrome 的正常 Temu 会话，从当前摩托配件类目扫描商品卡。
4. 按卡片 href 中的 goods_id 查找队列 goods_id，并调用 navigation/resolve。
5. 类目未找到时进入 Temu 站内搜索，再扫描搜索结果卡；仍未找到则记录 `NAVIGATION_NOT_RESOLVED` 并交人工复核。
6. 优先直接点击匹配商品卡，不使用历史 URL 打开详情。
7. 从详情地址栏提取 goods_id，与队列 goodsId 比较，并调用 navigation/verify。
8. 只有 `FRESH_DETAIL_VERIFIED` 才点击页面右下角“采集当前商品评论”。
9. 若出现 Temu 评论规则说明，由运营人员人工点击 OK；不绕过验证码或登录关卡。
10. 每 2 秒查询队列状态，最长等待 10 分钟。
11. `completed`：返回第 1 步；`failed`：记录并返回第 1 步；超时：调用失败接口。

## Day9.7 验收边界

本轮队列只加入以下 3 个 goods_id：

- `601101179368252`（整车防护罩）
- `601105407963474`（排气系统部件）
- `601099520926372`（车把与横把附件）

不要把 512 个 business eligible 商品加入队列，不要开始 10 商品或 Day10。
