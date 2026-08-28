# Temu 自有扩展演进计划 V1
## Network Interceptor → 差评采集 → 1688 以图寻源

版本：V1.0
日期：2026-08-27
适用仓库：`LiYiXilyx/in-home-xuanpin`
建议分支：以当前实际分支为准，开始前必须检查 `git branch --show-current`
当前业务阶段：`OPPORTUNITY_PRODUCT_CONFIRMATION`
计划性质：Codex 可执行工程计划 / 技术路线图 / 验收方案

---

# 0. 文档定位

本计划基于两类输入制定：

1. 当前 Temu 自动化选品项目已经完成的 Catalog、分类、机会分析、Review Queue、Browser Extension 和 SQLite 能力；
2. 对用户上传的 `THunt-Product-Analysis-Tool.zip` 所做的本地源码结构分析。

从第三方扩展中值得借鉴的是架构思想：

```text
Temu 页面自己发出请求
↓
被动监听 fetch / XHR 响应副本
↓
从 JSON 中提取 goods_id 和结构化商品数据
↓
与 DOM 解析结果按 goods_id 合并
↓
再进入自己的数据链路
```

本计划不复制第三方扩展压缩 bundle，不调用其私有后端，不复用其账号、认证、签名、Token 或云端服务。

本计划分为三条能力轨道：

```text
A. Temu Network Interceptor
   → 优先增强商品池采集

B. Negative Review Collector
   → 机会产品人工确认后，增强差评采集

C. 1688 Image Search
   → 机会产品人工确认后，建立供应商寻源
```

三条能力最终汇合为：

```text
机会产品
↓
差评痛点
+
1688供应商能力
↓
Supplier × Pain Point Matrix
↓
最终产品判断
```

---

# 1. 当前项目状态

以下状态必须在开始前由 Codex 重新核对，不允许仅凭本文件猜测。

当前已知状态：

- 正式 Active Pool：约 1,500 个非电子唯一商品；
- Opportunity Analysis 已完成；
- Opportunity Analysis 状态：`PASS`；
- 当前人工 Gate：`OPPORTUNITY_PRODUCT_CONFIRMATION`；
- 当前数据库 migration 最大编号：用户最近结果为 `022_opportunity_analysis.sql`；
- 当前核心 Reviews：147；
- 尚未启动本轮差评抓取；
- 尚未启动本轮 1688 寻源；
- 当前 5 个机会候选仅为待确认结果，不代表已经批准开发。

当前候选：

1. 通用摩托车换挡杆；
2. Honda CRF300L/Rally 装饰改装件；
3. 通用摩托车尾包/后座包；
4. CNC 链条调节轴块；
5. CNC 摩托车脚踏支架。

其中带品牌、车型、IP、年份适配风险的商品必须继续保留 `CAUTION_WATCH`，不得仅凭机会分进入采购。

---

# 2. 业务主线与技术支线

## 2.1 业务主线

当前业务主线仍然是：

```text
Opportunity Analysis
↓
最终 3—5 个机会产品
↓
老板 / 邵伟人工确认
↓
已确认产品
↓
差评抓取 + 1688 寻源并行
```

评论不是第一轮选品工具。

只有被人工确认的商品，才允许创建：

- Negative Review Queue；
- 1688 Sourcing Queue。

## 2.2 技术支线

Track A 的 Network Interceptor 可以在人工确认前先开发，因为它主要增强 Extension 数据获取能力。

但 Track A 不得：

- 重新计算 Opportunity Analysis；
- 改变机会候选；
- 改变 Active Pool；
- 自动扩容 Catalog；
- 启动评论或 1688；
- 把网络响应中的额外商品直接写入正式 SQLite。

## 2.3 推荐执行顺序

```text
阶段 0：
冻结当前 Opportunity Analysis
↓
阶段 A：
Network Interceptor V1（Observe-only + DOM Enrichment）
↓
OPPORTUNITY_PRODUCT_CONFIRMATION
↓
┌─────────────────────┬─────────────────────┐
│                     │                     │
阶段 B                阶段 C
差评采集              1688以图寻源
│                     │
└──────────┬──────────┘
           ↓
阶段 D：
Supplier × Pain Point Matrix
↓
最终候选产品
```

---

# 3. 从 THunt 源码结构中得到的技术结论

## 3.1 本地扩展结构

上传扩展是 Chrome Manifest V3 扩展，包含：

```text
manifest.json
js/temu-response-interceptor.js
js/content.js
js/background.js
js/popup.js
js/search.js
```

其中：

- `temu-response-interceptor.js` 体积很小，负责页面网络响应监听；
- `content.js`、`popup.js`、`search.js` 为打包压缩后的大文件；
- 部分商品丰富字段、评论 AI、上架时间和趋势数据依赖第三方服务器；
- 仅凭 ZIP 无法复制其云端能力。

## 3.2 Network Interceptor

可观察到的模式：

```text
document_start
+
MAIN world
+
hook window.fetch
+
hook XMLHttpRequest
+
response.clone()
+
window.postMessage
```

监听的响应类型包括：

- 搜索商品；
- 类目商品；
- 首页商品；
- 商品详情；
- 商品推荐；
- 批量商品查询。

核心价值：

> 页面成功收到 JSON 后，可以在 DOM 渲染前后拿到结构化商品对象。

## 3.3 DOM 与网络数据合并

可观察到的架构：

```text
Network JSON Cache
+
DOM Parser
+
goods_id Merge
```

网络数据用于补充：

- title；
- price；
- sales；
- rating；
- review count；
- image；
- 原始结构字段。

DOM 继续提供：

- 当前真实页面链接；
- 当前页面上下文；
- 页面可见性；
- 当前商品卡证据。

## 3.4 评论能力

第三方扩展包含评论列表相关请求与数据处理，但部分 AI 分析依赖其自己的云端。

本项目只借鉴：

- 评论响应字段结构；
- review_id 去重；
- 分页/覆盖状态；
- 原始证据保存。

不复用其云端评论 AI。

## 3.5 1688 能力

第三方扩展包含：

- 1688 以图搜索入口；
- 关键词/类目搜索入口；
- 图片上传和搜索结果处理。

本项目不调用第三方私有 1688 服务。

本项目将通过自己的真实浏览器、公开页面和本地数据链路重新实现。

---

# 4. 不可突破的安全边界

所有 Track 统一遵守：

## 4.1 不绕平台验证

禁止：

- 绕 CAPTCHA；
- 绕登录验证；
- 伪造账号；
- 复制 Token；
- 复制 Cookie；
- 主动生成平台签名；
- 重放平台风控参数。

遇到验证：

```text
manual_required
↓
人工完成
↓
resume
```

## 4.2 Passive Interception Only

Network Interceptor V1 只允许：

```text
Temu 页面自己发出请求
↓
扩展读取响应副本
```

禁止：

- 主动构造 Temu 私有 API；
- 自动翻页 API；
- 修改请求参数；
- 修改请求 Header；
- 修改响应；
- 重放请求；
- 从网络响应中恢复账号秘密。

## 4.3 不复制第三方私有代码

允许：

- 借鉴模块边界；
- 借鉴数据流；
- 借鉴通用技术模式。

禁止：

- 复制压缩 bundle；
- 复制第三方认证逻辑；
- 调用第三方服务器；
- 使用第三方付费账号信息；
- 将第三方扩展重新打包发布。

## 4.4 商品身份不变

始终：

```text
platform + goods_id
```

URL 只作为：

- 当前观察链接；
- 历史导航证据；
- fallback。

---

# 5. 总体目标架构

```text
                           Temu 页面
                              │
             ┌────────────────┴────────────────┐
             │                                 │
       Network Interceptor                 DOM Observer
       fetch / XHR clone              Existing DOM Parser
             │                                 │
             ↓                                 ↓
       Network Product Cache              DOM Product
             │                                 │
             └────────────────┬────────────────┘
                              ↓
                     Product Merger
                   goods_id strict match
                              ↓
                   Browser Extension
                              ↓
                       localhost API
                              ↓
                           Node.js
                              ↓
                            SQLite
                              ↓
          ┌───────────────────┼───────────────────┐
          │                   │                   │
      Catalog Pool       Negative Reviews      1688 Sourcing
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ↓
                   Product Opportunity
```

---

# 6. Track A：Temu Network Interceptor

# A0. 目标

增强现有 `Temu Catalog 与评论采集` 扩展，使商品字段不再完全依赖 DOM。

V1 目标：

```text
DOM 商品卡
+
Network JSON Enrichment
```

V1 不允许：

```text
Network-only 商品
→ 正式 SQLite
```

---

# A1. 开始前 Checkpoint

Codex 必须先执行：

```bash
git status
git branch --show-current
git rev-parse HEAD
npm run check
git diff --check
```

记录：

- Active Pool Version；
- active memberships；
- products；
- snapshots；
- reviews；
- Opportunity Snapshot；
- migration max。

如果当前 Opportunity Analysis 尚未 commit：

先创建 checkpoint：

```text
feat: checkpoint opportunity analysis
```

不要 push，除非另行授权。

---

# A2. 当前 Extension 审计

Codex必须读取实际文件，不允许假设：

```text
browser-extension/manifest.json
browser-extension/content-script.js
browser-extension/background.js
browser-extension/catalog-parser.js
browser-extension/catalog-capture.js
browser-extension/catalog-auto-runner.js
browser-extension/review-loader.js
```

如果文件名不同，以仓库实际为准。

输出：

```text
# Current Extension Architecture

- Manifest版本
- host permissions
- content scripts
- MAIN / ISOLATED world
- Catalog入口
- Review入口
- localhost消息链
- popup/页面按钮
- current batch schema
```

---

# A3. 文件规划

建议新增：

```text
browser-extension/temu-network-interceptor-main.js
browser-extension/catalog-network-endpoints.js
browser-extension/catalog-network-parser.js
browser-extension/catalog-network-cache.js
browser-extension/catalog-product-merger.js
browser-extension/catalog-network-diagnostics.js
```

建议修改：

```text
browser-extension/manifest.json
browser-extension/content-script.js
browser-extension/catalog-parser.js
browser-extension/catalog-capture.js
browser-extension/background.js
```

测试建议：

```text
test/unit/catalog-network-endpoints.test.mjs
test/unit/catalog-network-parser.test.mjs
test/unit/catalog-network-cache.test.mjs
test/unit/catalog-product-merger.test.mjs
test/integration/catalog-network-extension.test.mjs
```

---

# A4. MAIN World Interceptor

`temu-network-interceptor-main.js`：

- `run_at = document_start`；
- `world = MAIN`；
- 安装一次；
- 使用全局安装标记防重复；
- Hook `window.fetch`；
- Hook `XMLHttpRequest.open/send`。

必须保证：

```text
原请求行为不变
原响应行为不变
页面拿到的response不变
```

Fetch 处理：

```text
original fetch
↓
return original response
↓
对 response.clone() 做异步读取
```

XHR 处理：

```text
记录请求URL
↓
loadend时读取responseText副本
↓
不修改原XHR状态
```

---

# A5. Endpoint Allowlist

新增统一 matcher：

```javascript
isCatalogProductEndpoint(url)
isReviewEndpoint(url)
```

V1 Catalog allowlist 可从实际页面观察中确认，初始候选包括：

```text
/api/poppy/v1/search
/api/poppy/v1/opt
/api/alexa/homepage/goods_list
/api/poppy/v1/goods_detail
/api/market/domino/batch/query_goods
bff-api/category/get_select_product_list
bff-api/category/real_category_goods_list
bff-api/product/get_products_by_keywords
```

规则：

- endpoint 字符串集中配置；
- 不在多个模块散落；
- 无关请求不读取；
- 非 JSON 响应跳过；
- 解析失败只记 diagnostics；
- 不阻塞页面。

---

# A6. Payload 限制

防止大响应拖垮页面：

- 最大响应字节数；
- 最大解析数组长度；
- 最大对象遍历数；
- 最大嵌套深度；
- 单次最多提取商品数；
- 单 endpoint 超时保护。

建议初值：

```text
maxPayloadBytes = 2 MB
maxDepth = 8
maxVisitedObjects = 10,000
maxProductsPerResponse = 1,000
```

最终值配置化。

---

# A7. MAIN → Isolated World 通信

MAIN World 发送：

```json
{
  "type": "TEMU_NETWORK_RESPONSE",
  "version": 1,
  "payload": {
    "url": "",
    "status": 200,
    "observed_at": "",
    "body": {}
  }
}
```

Content Script 必须验证：

- `event.source === window`；
- message type；
- version；
- payload schema；
- URL属于当前 Temu 页面；
- endpoint在allowlist。

Node 仍须二次校验。

---

# A8. Network Response Parser

`catalog-network-parser.js` 采用：

```text
endpoint-specific extractor
+
bounded generic fallback
```

至少实现：

```text
parseSearchResponse()
parseCategoryResponse()
parseGoodsListResponse()
parseDetailResponse()
```

统一字段：

```json
{
  "goods_id": "",
  "title": null,
  "image_url": null,
  "price_amount": null,
  "currency": null,
  "sales_count": null,
  "rating": null,
  "review_count": null,
  "raw_network": {},
  "endpoint": "",
  "observed_at": ""
}
```

goods id兼容：

```text
goods_id
goodsId
data.goods_id
data.goodsId
```

所有 `goods_id` 标准化为字符串。

---

# A9. Network Cache

`catalog-network-cache.js`：

```text
Map<goods_id, NetworkProductRecord>
```

每条记录：

```json
{
  "goods_id": "",
  "latest_product": {},
  "first_seen_at": "",
  "last_seen_at": "",
  "observation_count": 0,
  "endpoints": []
}
```

要求：

- 同 goods_id 去重；
- 更新 latest；
- endpoint审计；
- LRU或oldest eviction；
- Extension reload后可清空；
- 不保存Cookie、Token；
- 不无限增长。

建议：

```text
maxEntries = 1000
```

---

# A10. DOM + Network Merge

`catalog-product-merger.js`：

只有：

```text
dom.goods_id === network.goods_id
```

才允许 merge。

字段优先级：

| 字段 | 优先级 |
|---|---|
| goods_id | identity，不覆盖 |
| source_url | DOM 当前真实 href |
| canonical_url | 现有 identity 逻辑 |
| title | 有效 network > DOM |
| image_url | 有效 network > DOM |
| price_amount | 有效 network > DOM |
| sales_count | 有效 network > DOM |
| rating | 有效 network > DOM |
| review_count | 有效 network > DOM |

Network值必须通过验证：

- 非空；
- 非 NaN；
- 非负；
- 合理范围；
- 类型正确。

无效 network 数据不得覆盖健康 DOM。

---

# A11. 字段来源审计

每个商品增加调试信息：

```json
{
  "capture_transport": "NETWORK_ENRICHED",
  "field_provenance": {
    "title": "network",
    "price_amount": "network",
    "sales_count": "dom",
    "source_url": "dom"
  }
}
```

Transport：

```text
DOM
NETWORK_ENRICHED
NETWORK_ONLY
```

V1只允许前两种进入正式 batch。

`NETWORK_ONLY`：

- 只统计；
- 不写 SQLite；
- 不计 Campaign；
- 不计 Pool；
- 不计 Opportunity。

---

# A12. Diagnostics

Catalog 面板增加：

```text
network_responses_intercepted
network_endpoint_counts
network_parse_errors
network_unique_goods
network_cache_size
dom_unique_goods
network_enriched_goods
network_only_observed
network_merge_conflicts
```

注意：

```text
network_responses_intercepted
!=
商品数
```

---

# A13. Observe-only Smoke

条件：

- 单元测试PASS；
- Review回归PASS；
- Extension reload。

打开：

```text
Temu Germany
English
EUR
Motorcycle Accessories
Top Sales
```

只观察：

- network responses > 0；
- endpoint counts合理；
- network goods > 0；
- 页面功能正常。

禁止：

- 创建新 Campaign；
- 写 SQLite；
- 自动滚动长任务。

---

# A14. Enrichment Smoke

Observe-only PASS后：

- DOM解析当前页面；
- Network Cache增强；
- 抽样10个goods_id；
- 对比 title/price/sales/rating/review count；
- 检查 source_url仍来自DOM；
- 输出 provenance。

仍然不写正式 SQLite。

---

# A15. Track A PASS标准

必须：

- 页面 fetch 不受影响；
- XHR 不受影响；
- CAPTCHA机制不变；
- goods_id正确；
- cache去重正确；
- DOM parser继续工作；
- network enrichment无字段污染；
- Review Extension回归PASS；
- Active Pool不变；
- Opportunity Snapshot不变；
- reviews不变。

---

# A16. Track A Phase 2（暂不自动执行）

未来可评估：

```text
NETWORK_ONLY
→ Catalog Batch
```

但必须先增加：

- endpoint source context；
- current category/source绑定；
- recommendation排除；
- page/campaign context验证；
- network-only QA；
- 专门 migration（如确有必要）。

Phase 1完成后必须停止，不得自动进入Phase 2。

---

# 7. Track B：Negative Review Collector

# B0. 启动条件

只有：

```text
OPPORTUNITY_PRODUCT_CONFIRMATION = approved
```

才允许启动。

输入不是50个随机商品。

输入是：

```text
最终人工确认的3—5个机会产品
```

---

# B1. 目标

只抓差评，用于回答：

```text
用户哪里不满意？
问题有多高频？
问题能否解决？
能否形成差异化卖点？
```

V1差评定义：

```text
rating <= 3
```

4星评论不自动作为差评，后续可单独评估。

---

# B2. 正式链路

```text
Confirmed Opportunity Product
↓
Negative Review Queue
↓
Fresh Navigation
↓
Detail Verified
↓
打开评论区域
↓
页面自己产生Review Request
↓
Passive Network Interceptor
↓
Review Parser
↓
rating <= 3
↓
SQLite
↓
Evidence
```

DOM Review Loader继续作为fallback。

---

# B3. 复用现有能力

优先复用：

- Review Queue；
- Fresh Navigation；
- navigation verify；
- Extension Context；
- review_id dedupe；
- fingerprint dedupe；
- coverage；
- checkpoint；
- pause/resume；
- CAPTCHA人工Gate。

不得重写已稳定模块。

---

# B4. 文件规划

建议新增：

```text
browser-extension/review-network-parser.js
browser-extension/review-negative-filter.js
browser-extension/review-network-cache.js
src/modules/reviews/negative-review-service.mjs
src/db/repositories/review-evidence-repository.mjs
src/modules/analysis/pain-point-evidence-service.mjs
```

测试：

```text
test/unit/review-network-parser.test.mjs
test/unit/review-negative-filter.test.mjs
test/integration/negative-review-capture.test.mjs
test/integration/review-evidence.test.mjs
```

---

# B5. Review Endpoint

第三方扩展中可观察到评论列表相关 endpoint，但本项目不得仅凭第三方源码直接假定当前 Temu endpoint稳定。

正式步骤：

1. 在健康页面打开评论；
2. 使用 Network diagnostics观察真实请求；
3. 确认 endpoint；
4. 保存 fixture；
5. 再实现 parser。

禁止：

- 主动调用未知评论接口；
- 重放签名；
- 抄取第三方请求头；
- 复制第三方Token。

---

# B6. Review字段

至少保存：

```text
review_id
goods_id
rating
review_date
review_text
review_title
variant
country
images
videos
helpful_count
seller_reply
source_endpoint
source_page
page_or_cursor
captured_at
raw_response_hash
```

没有就 null。

不得推测。

---

# B7. Negative Filter

V1规则：

```text
rating <= 3
AND
review_id / fingerprint valid
```

允许无文本低星评论保存为：

```text
negative_rating_only
```

空文本不得伪造痛点。

---

# B8. 去重

唯一优先：

```text
platform + review_id
```

Fallback：

```text
goods_id
+ rating
+ normalized_text
+ review_date
+ variant
```

必须继续保证：

- review_id duplicate = 0；
- fingerprint duplicate = 0；
- dedupe_key duplicate = 0。

---

# B9. Coverage语义

只抓差评时必须明确：

```text
negative_review_coverage
```

不能把它描述为：

```text
全部评论完整覆盖
```

停止原因：

```text
NEGATIVE_CUTOFF_REACHED
NEGATIVE_NO_MORE
NEGATIVE_MAX_ROUNDS
CAPTCHA_OR_LOGIN
NAVIGATION_NOT_RESOLVED
```

complete / partial必须诚实。

---

# B10. 证据链

每个痛点必须能回到：

```text
pain_point
↓
assignment
↓
review_id
↓
原评论
```

建议表：

```text
review_pain_point_runs
review_pain_point_assignments
review_pain_point_evidence
```

如果现有schema可支持，优先复用。

---

# B11. AI痛点分析

AI只负责：

- 痛点主题；
- 聚类；
- 严重度；
- 可改进性；
- 使用场景；
- 供应商提问生成。

程序负责：

- 评论数；
- 比例；
- rating分布；
- 日期；
- evidence绑定。

AI输出固定JSON：

```json
{
  "pain_point": "",
  "severity": "low|medium|high",
  "fixability": "low|medium|high|unknown",
  "evidence_review_ids": [],
  "supplier_question": "",
  "confidence": 0.0,
  "reason": ""
}
```

---

# B12. Track B Gate

阶段门：

```text
B1：1个已确认商品 Smoke
B2：3—5个确认商品
B3：痛点分析
B4：证据 QA
```

不得一次扩到全部商品。

---

# B13. Track B PASS标准

- 只处理 approved 商品；
- goods_id严格一致；
- 差评rating规则正确；
- 去重0；
- evidence可追溯；
- CAPTCHA不绕过；
- Product Pool不变；
- Opportunity结果不变；
- AI不自己计算比例；
- 输出可用于1688提问。

---

# 8. Track C：1688 Image Search

# C0. 启动条件

只有已确认机会产品可创建：

```text
1688 Sourcing Job
```

未确认商品不得批量寻源。

---

# C1. 目标

从 Temu 已确认机会商品出发：

```text
商品图片
↓
1688以图搜索
↓
供应商/商品候选
↓
清洗去重
↓
供应商对比
↓
询盘
```

本项目不复用第三方扩展的私有1688后端。

---

# C2. 正式架构

```text
Confirmed Product
↓
Image Selection
↓
Image Preparation
↓
Real Browser 1688 Image Search
↓
1688 Result Extension Parser
↓
localhost API
↓
SQLite Supplier Candidates
↓
Supplier Ranking
↓
Human Confirmation
↓
Supplier Questions
```

---

# C3. 图片选择

每个产品建议：

- 主图1张；
- 结构图1张；
- 适配/安装图1张。

图片必须记录：

```text
goods_id
image_url
local_path
image_hash
image_role
selected_by
selected_at
```

不得自动去除版权标识并重新发布。

裁剪仅用于搜索输入，需保留原图证据。

---

# C4. 文件规划

建议新增：

```text
browser-extension/1688-result-parser.js
browser-extension/1688-capture.js
src/modules/sourcing/image-preparation-service.mjs
src/modules/sourcing/1688-search-service.mjs
src/modules/sourcing/supplier-ranking-service.mjs
src/db/repositories/sourcing-repository.mjs
src/server/controllers/sourcing-controller.mjs
docs/1688_IMAGE_SEARCH_RUNBOOK.md
```

---

# C5. 数据模型

开始前检查现有 migration max。

如需新增，建议表：

```text
sourcing_jobs
sourcing_job_images
sourcing_search_runs
sourcing_offers
sourcing_suppliers
sourcing_offer_supplier_links
sourcing_questions
sourcing_responses
```

不要写死 migration编号。

---

# C6. 1688 Offer字段

至少保存：

```text
offer_id
offer_url
title
image_url
price_min
price_max
price_tiers
moq
sales_or_deal_count
supplier_id
supplier_name
supplier_location
supplier_years
factory_or_trader
oem_odm
stock_status
delivery_time
badges
captured_at
raw_json
```

没有就 null。

---

# C7. Supplier字段

至少：

```text
supplier_id
supplier_name
company_name
location
years_on_platform
factory_flag
trade_flag
business_scope
response_rate
repeat_purchase_signal
service_score
delivery_score
verified_badges
```

这些字段只能根据页面实际显示记录。

不得猜测“工厂”。

---

# C8. 去重

Offer优先：

```text
platform + offer_id
```

Supplier优先：

```text
platform + supplier_id
```

图片搜索多次得到同offer：

只保留一条identity，增加 observation。

---

# C9. 以图搜索运行Gate

阶段：

```text
C1：1个机会产品，1张图
C2：1个产品，3张图
C3：3个确认产品
C4：每个产品Top20 Offer
```

每一阶段都要检查：

- 搜索结果相关性；
- 价格异常；
- 重复；
- 非同类商品；
- 供应商重复。

---

# C10. Supplier Ranking

确定性基础分建议：

| 维度 | 权重 |
|---|---:|
| 图片/产品相关性 | 25% |
| 价格空间 | 20% |
| MOQ友好度 | 15% |
| 供应稳定性 | 15% |
| 交付能力 | 10% |
| 工厂/OEM能力 | 10% |
| 数据完整度 | 5% |

AI可解释，不负责基础数值计算。

---

# C11. 固定供应商问题

至少：

1. 你们是工厂还是贸易商？
2. MOQ是多少？
3. 是否有现货？
4. 交期多久？
5. 是否支持定制？
6. 售后如何处理？
7. 是否可提供样品？
8. 是否有欧盟/目标市场相关检测或材料说明？
9. 是否可解决当前核心差评痛点？
10. 修改材质/规格后成本增加多少？

---

# C12. 发送安全Gate

V1只生成问题和候选名单。

不自动发送。

需要人工确认：

```text
SUPPLIER_CONTACT_CONFIRMATION
```

后续如做影刀自动发送：

- 限速；
- 人工确认模板；
- 逐供应商审计；
- CAPTCHA人工处理；
- 不自动承诺采购。

---

# C13. Track C PASS标准

- 只处理approved商品；
- 图片证据完整；
- 1688结果可追溯；
- offer/supplier去重；
- 不调用第三方私有服务；
- 不保存账号秘密；
- Top20可人工复核；
- 供应商问题与差评痛点可结合。

---

# 9. Track D：Supplier × Pain Point Matrix

B和C完成后生成：

```text
Supplier × Pain Point Matrix
```

每行：

```text
机会商品
痛点
痛点比例
证据评论
供应商
供应商Offer
供应商是否可解决
解决方式
成本变化
MOQ
交期
风险
```

最终回答：

```text
市场有问题吗？
问题能解决吗？
谁能解决？
解决后成本是否仍有利润？
```

---

# 10. 机会产品人工确认包

当前应先输出一个简洁确认包，而不是继续技术开发。

每个候选：

- 商品；
- 所属细分；
- 细分机会分；
- 商品机会分；
- 销量；
- 价格；
- Top3；
- GMV/SKU；
- 物流；
- 适配；
- IP；
- 推荐动作；
- 是否批准。

确认状态：

```text
approved
rejected
needs_more_evidence
```

只有 `approved` 进入 B/C。

---

# 11. 数据库版本建议

当前 migration 最大编号应由 Codex实际检查。

优先策略：

- Track A V1 不新增 migration；
- Track B 只有 provenance/evidence无法复用时再新增；
- Track C 需要 sourcing 表时新增。

建议预留但不写死：

```text
下一空闲migration：Opportunity Confirmation / Review Evidence
后续：1688 Sourcing
```

禁止：

- 修改已应用 migration；
- 两个不同功能共用同编号；
- 没有备份直接迁移正式库。

---

# 12. API规划

## 12.1 Catalog Network Diagnostics

建议只读：

```text
GET /api/catalog/network-diagnostics
```

V1不要求网络响应直接POST到Node。

## 12.2 Negative Review

建议：

```text
POST /api/reviews/negative-batch
GET  /api/reviews/negative-context
POST /api/reviews/negative-complete
```

如现有Review API可自然扩展，优先复用。

## 12.3 1688

建议：

```text
POST /api/sourcing/jobs
GET  /api/sourcing/context
POST /api/sourcing/1688/batch
POST /api/sourcing/jobs/:id/complete
GET  /api/sourcing/jobs/:id/status
```

所有API：

- 仅localhost；
- schema validation；
- payload限制；
- idempotency；
- 不接受任意文件路径；
- 不返回secret。

---

# 13. 测试总矩阵

## Track A

- Fetch不破坏；
- XHR不破坏；
- endpoint matcher；
- parser；
- cache；
- merge；
- provenance；
- diagnostics；
- Review回归。

## Track B

- Review JSON解析；
- rating filter；
- review_id dedupe；
- fingerprint；
- coverage；
- evidence；
- AI JSON schema；
- Product Pool保护。

## Track C

- 图片任务；
- Offer解析；
- Supplier解析；
- 去重；
- idempotency；
- ranking；
- question generation；
- 人工Gate。

## 全量

```bash
npm run check
git diff --check
npm run test:unit
npm run test:integration
npm test
```

已知 Windows Excel renderer failure 单独记录，不要顺手修改无关模块。

---

# 14. QA要求

每个阶段QA至少检查：

- 输入数量；
- 输出数量；
- identity唯一；
- duplicate；
- schema；
- data provenance；
- raw evidence；
- Product Pool前后；
- reviews前后；
- migration；
- SQLite integrity；
- Extension回归；
- Git diff。

阶段失败：

- 不伪造完成；
- 保留审计；
- 不自动进入下一阶段。

---

# 15. 推荐时间表

| 天 | 任务 |
|---|---|
| Tech Day 1 | Opportunity checkpoint + Extension架构审计 |
| Tech Day 2 | Network Interceptor + endpoint matcher |
| Tech Day 3 | Parser + Cache + Merge + Tests |
| Tech Day 4 | Observe-only Smoke + Enrichment Smoke |
| Business Gate | 3—5机会产品人工确认 |
| Review Day 1 | 1商品差评Network Smoke |
| Review Day 2 | 3—5商品差评采集 |
| Review Day 3 | 痛点证据与AI聚类 |
| Sourcing Day 1 | 1商品1688以图搜索 |
| Sourcing Day 2 | 3—5商品Offer与Supplier采集 |
| Sourcing Day 3 | Supplier Ranking + 固定问题 |
| Integration Day | Supplier × Pain Point Matrix |

B与C可在人工确认后并行。

---

# 16. 最终交付物

## Track A

- Network Interceptor源码；
- endpoint配置；
- Network Parser；
- Cache；
- Merger；
- Diagnostics；
- Fixtures；
- Runbook；
- 测试报告。

## Track B

- Negative Review Queue；
- Review网络解析；
- 差评证据；
- 痛点分析；
- Excel/JSON报告；
- 供应商问题。

## Track C

- 1688 Image Search Job；
- Offer候选；
- Supplier候选；
- 排名；
- 问题模板；
- Sourcing Excel。

## Track D

- Supplier × Pain Point Matrix；
- 3—10最终候选；
- 风险清单；
- 下一步采购建议。

---

# 17. Codex 总控提示词

```md
# Temu Extension Evolution — Master Control

你现在执行一项分阶段技术改造：

A. Network Interceptor
B. Negative Review Collector
C. 1688 Image Search

严格顺序：

1. 先读取当前仓库、migration、Extension、Opportunity状态。
2. 当前业务停在 OPPORTUNITY_PRODUCT_CONFIRMATION。
3. Track A可以先开发，但不得修改Opportunity结果。
4. Track B/C只有人工确认approved商品后才能开始。
5. 不复制第三方压缩代码。
6. 不调用第三方私有后端。
7. 不读取Cookie/Token。
8. 不绕验证码。
9. Network V1只做Passive Interception。
10. V1只允许DOM goods_id被Network增强。
11. NETWORK_ONLY不写SQLite。
12. 每个阶段单独checkpoint、测试和报告。
13. 不自动进入下一阶段。

第一步只输出：

# Repository and Extension Reconnaissance

## Git
## Migration
## Current Opportunity Gate
## Existing Catalog Extension
## Existing Review Extension
## Current APIs
## Reusable Modules
## Conflicts
## Track A File Plan
## Risks
## READY / NOT READY

不要立刻写代码。
```

---

# 18. Track A Codex执行提示词

```md
# Track A — Temu Network Interceptor V1

只执行Track A Phase 1。

目标：

实现Passive Network Interception，
用network JSON增强现有DOM商品，
不接收network-only商品入库。

必须：

- MAIN world
- document_start
- fetch clone
- XHR passive listen
- endpoint allowlist
- endpoint-specific parser
- bounded generic fallback
- LRU cache
- strict goods_id merge
- field provenance
- diagnostics
- observe-only smoke
- enrichment smoke

禁止：

- 主动调用Temu私有API
- 重放请求
- 绕风控
- NETWORK_ONLY入库
- 修改Opportunity
- 修改Active Pool
- 开始评论
- 开始1688

完成后输出：

# Temu Network Interceptor V1 Result

## Architecture
## Files
## Endpoint Allowlist
## Parser
## Cache
## Merge
## Provenance
## Diagnostics
## Observe-only
## Enrichment
## Regression
## Data Integrity
## Tests
## Phase 2 Recommendation
## PASS / FAIL

完成后停止。
```

---

# 19. Track B Codex执行提示词

```md
# Track B — Confirmed Product Negative Review Collector

前置：

必须存在 approved Opportunity Product。

只处理approved商品。

目标：

通过现有Fresh Navigation + Review Extension，
优先利用页面产生的Review网络响应，
采集rating<=3的差评。

必须：

- 1商品Smoke
- network parser
- DOM fallback
- review_id去重
- fingerprint
- negative coverage
- evidence
- AI固定JSON
- pain point比例由程序计算
- supplier question生成

禁止：

- 未确认商品入队
- 抓全商品评论
- 自动绕验证
- AI自己计数
- 修改Product Pool
- 开始采购

完成后停止。
```

---

# 20. Track C Codex执行提示词

```md
# Track C — 1688 Image Search and Supplier Pool

前置：

必须存在 approved Opportunity Product。

只处理approved商品。

目标：

真实浏览器执行1688以图搜索，
建立Offer/Supplier候选池。

必须：

- 图片任务
- 真实浏览器
- 1688结果Parser
- localhost API
- SQLite
- offer/supplier去重
- Top20
- ranking
- 固定问题
- pain point question
- 人工联系Gate

禁止：

- 调用THunt私有1688接口
- 复制其认证
- 自动大规模发消息
- 自动承诺采购
- 绕登录/验证码

完成后停止。
```

---

# 21. 最终PASS定义

完整计划最终PASS需要：

## A

- Network Interceptor稳定；
- DOM/Network合并正确；
- 不污染数据；
- Review回归正常。

## B

- 已确认产品差评完整可追溯；
- 痛点有证据；
- 比例由程序计算；
- AI只做语义。

## C

- Offer/Supplier候选真实；
- 去重；
- 价格/MOQ/交期可比较；
- 可生成固定提问。

## D

- 痛点与供应商能力对应；
- 最终候选可解释；
- 风险明确；
- 可进入采购/样品阶段。

---

# 22. 最终原则

本计划不是为了复制 THunt。

真正目标是：

> 把第三方扩展中已验证有效的“网络响应 + DOM + goods_id合并”架构思想，重新实现为一套完全由当前项目控制、可审计、可测试、可继续演进的 Temu 选品基础设施。

最终技术必须服务于业务漏斗：

```text
商品池
→ 机会产品
→ 人工确认
→ 差评 + 1688
→ 供应商能否解决用户痛点
→ 最终选品
```
