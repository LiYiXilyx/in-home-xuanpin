# Temu 商品池 3000 扩容、影刀 RPA 与 Codex 并行开发执行方案

版本：V1.0  
类型：Codex 可执行工程计划  
适用仓库：`LiYiXilyx/in-home-xuanpin`  
建议工作分支：`feat/catalog-3000-rpa`  
建议阶段名称：`Week1.5 / Catalog Scale V2`

---

# 0. 文档定位

本文件不是重新推翻第一周，而是在第一周已经完成的商品池底座上增加一条“可扩容、可重跑、可审计”的 3000 商品采集链路。

第一周已有能力继续保留：

- `platform + goods_id` 稳定商品身份；
- `products / catalog_memberships / product_snapshots` 分层；
- SQLite 为正式数据源；
- checkpoint / pause / resume / retry；
- 图片缓存、质量门、Excel 与运营台；
- 100 / 300 / 1000 阶段门；
- 旧商品池安全保护。

本次新增能力：

- 影刀控制真实 Chrome 的重复页面操作；
- Browser Extension 读取商品卡 DOM；
- Node localhost API 接收批次并写 SQLite；
- 多来源采集；
- 跨来源 `goods_id` 去重；
- 1000 基线重新抓取；
- 1000 → 1500 → 2000 → 2500 → 3000 扩容；
- 每个来源的贡献、重叠和耗时审计；
- 新旧商品池版本化与安全切换；
- Codex 双轨并行开发规则。

核心原则：

> 不重新造一套商品数据库，不把影刀变成第二个数据库，不让 Excel 成为任务真相源。

---

# 1. 当前问题与改造结论

## 1.1 第一周链路为什么“能完成但不够流畅”

当前商品采集已经支持滚动、识别 `Try again / Try more / Load more / See more / Show more`，但在页面未产生新商品时会进入人工关卡。

这套设计适合 1000 商品验收，但扩展到 3000 时会出现：

- 页面深度更大；
- `Try more` 出现次数增加；
- 单一页面可能不能提供 3000 个唯一商品；
- 人工点击频率升高；
- 一次任务持续时间太长；
- 页面状态、验证码、网络异常概率上升；
- 失败后重新从当前页面恢复的运营成本上升。

## 1.2 不建议整体推翻第一周

不做：

- 删除现有 Playwright 采集器；
- 重写 SQLite 数据模型；
- 改用 Excel 当正式数据源；
- 重新创建第二套 `products`；
- 为影刀单独维护一套商品表；
- 一口气从 1000 直接跑 3000；
- 两个进程同时写同一个生产 SQLite。

建议：

> 保留第一周核心，新增 Catalog Scale V2 作为第二条采集入口。

## 1.3 3000 的口径

必须同时报告两种数量：

```text
observed_unique_count
= 抓到的唯一 goods_id 数量

business_eligible_count
= 经过电子 / USB / 电池 / 认证 / 价格等业务规则后可研究的数量
```

默认 Gate 目标：

```text
observed_unique_count = 3000
```

不得把 3000 行 DOM 观察、重复卡片或跨来源重复当成 3000 商品。

如果老板明确要求“3000 个业务可做商品”，则将 Gate 改为：

```text
business_eligible_count = 3000
```

系统需要继续抓取超过 3000 个 observed 商品，直到 eligible 达标或来源耗尽。

---

# 2. 总体架构

```text
                         Temu

                           │

                    真实 Chrome

                           │
              ┌────────────┴────────────┐
              │                         │
          影刀 RPA              Browser Extension
       页面导航、滚动、点击          商品卡结构化读取
              │                         │
              └────────────┬────────────┘
                           │
                     localhost API
                           │
                         Node.js
         任务 / 去重 / 规则 / 质量 / 事务 / QA
                           │
                         SQLite
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
     Product Pool       Snapshots        Excel / 分析
```

## 2.1 影刀职责

影刀负责：

- 打开真实 Chrome；
- 从 Temu 首页或站内路径进入目标类目；
- 选择 Germany / English / EUR；
- 选择 Top Sales；
- 滚动；
- 点击 `Try more / Try again / See more / Load more`；
- 等待商品卡加载；
- 触发 Browser Extension 的“采集当前列表批次”；
- 轮询 localhost 任务状态；
- 遇到验证码时暂停并提示人工；
- 来源完成后领取下一个来源任务。

影刀不负责：

- 直接写 SQLite；
- 计算 goods_id；
- 去重；
- 商品身份判断；
- 质量门；
- 切换 active 商品池；
- 分类或评分；
- 保存 Cookie / Token。

## 2.2 Browser Extension 职责

新增 Catalog Capture 模式。

负责：

- 读取当前页面 URL、页面标题和脱敏页面状态；
- 提取商品卡；
- 提取当前可见的：
  - `goods_id`
  - `href`
  - `title`
  - `image_url`
  - `price`
  - `sales`
  - `rating`
  - `review_count`
  - 当前 DOM 顺序
- 将批次发送给 localhost API；
- 不持久化业务数据；
- 不负责跨批次去重；
- 不自动遍历全站。

## 2.3 Node / SQLite 职责

Node 负责：

- campaign / source / queue 管理；
- 批次 schema validation；
- `goods_id` 提取和身份校验；
- 跨批次、跨来源去重；
- 首次发现顺序；
- 来源贡献统计；
- snapshot；
- 图片任务；
- 质量门；
- Product Pool 事务切换；
- Excel / QA；
- 审计与错误记录。

---

# 3. 是否可以让“第一周扩容”和“当前 Week2”并行

## 3.1 结论

可以并行，但必须区分：

### 可以并行

- 两个 Codex 会话；
- 两个 Git worktree；
- 两条功能分支；
- 单元测试；
- fixture 集成测试；
- 一个轨道跑生产采集，另一个轨道做只读分析或测试数据库开发。

### 不建议并行

- 同一个工作目录同时让两个 Codex 修改代码；
- 两个进程同时执行 migration；
- 两个生产任务同时写同一个 SQLite；
- 影刀商品池任务和影刀评论任务同时控制同一个 Chrome；
- 公司、家里两台电脑各自写不同正式数据库，之后手工合并。

## 3.2 推荐双轨

### Track A：Catalog 3000

分支：

```text
feat/catalog-3000-rpa
```

工作目录：

```text
../in-home-xuanpin-catalog-3000
```

负责：

- 影刀商品池队列；
- Catalog Extension；
- 多来源；
- 1000 refresh；
- 3000 expansion；
- 商品池 QA。

### Track B：Week2 Review / Insight

分支：

```text
feat/week2-review-insight
```

工作目录：

```text
../in-home-xuanpin-week2
```

负责：

- 评论覆盖；
- 生命周期；
- 评论洞察；
- 产品机会。

## 3.3 Git worktree 命令示例

在主仓库工作区干净后：

```bash
git fetch origin

git worktree add ../in-home-xuanpin-catalog-3000 \
  -b feat/catalog-3000-rpa \
  refactor/week1-catalog-core

git worktree add ../in-home-xuanpin-week2 \
  -b feat/week2-review-insight \
  refactor/week1-catalog-core
```

Windows CMD 可分行执行。

## 3.4 文件所有权

| 区域 | Track A | Track B |
|---|---|---|
| `src/modules/catalog/**` | 独占 | 不修改 |
| `browser-extension/catalog-*` | 独占 | 不修改 |
| `src/modules/reviews/**` | 不修改 | 独占 |
| `src/modules/analysis/**` | 只读/最小修改 | 独占 |
| `src/db/repositories/catalog-*` | 独占 | 不修改 |
| `src/db/repositories/review-*` | 不修改 | 独占 |
| `src/cli.mjs` | 共享，合并时处理 | 共享，合并时处理 |
| `src/server/router.mjs` | 共享，合并时处理 | 共享，合并时处理 |
| `package.json` | 共享，合并时处理 | 共享，合并时处理 |
| migration test | 共享，合并时处理 | 共享，合并时处理 |

## 3.5 Migration 编号预留

执行前先检查当前最大 migration。

建议：

```text
Week2 Review / Insight：016—019
Catalog 3000：020—024
```

如果编号已经占用，Codex必须选择下一个连续区间，并更新本文件的实际执行记录。

禁止两个分支创建同名编号的不同 migration。

## 3.6 生产数据库规则

正式数据库只允许一个权威副本。

推荐：

```text
公司电脑 = 正式生产数据库与真实 Chrome / 影刀运行机
家里电脑 = 代码开发、测试数据库、fixture
```

真实运行时：

- Catalog 采集窗口：暂停 Review RPA；
- Review 采集窗口：暂停 Catalog RPA；
- 只读分析可以从 SQLite consistent backup 运行；
- 不在 OneDrive、网盘或网络共享目录直接运行 SQLite。

---

# 4. 数据模型扩展

建议 migration 区间：020—024。

## 4.1 `catalog_campaigns`

用途：一轮 1000 refresh 或 3000 扩容的总任务。

| 字段 | 说明 |
|---|---|
| `id` | campaign ID |
| `name` | 例如 `catalog-refresh-1000-20260825` |
| `campaign_type` | `refresh / expansion` |
| `target_observed_count` | 1000 / 1500 / 2000 / 2500 / 3000 |
| `target_eligible_count` | 可为空 |
| `baseline_pool_count` | 启动前 active 数量 |
| `status` | pending/running/paused/qa_failed/completed/failed/cancelled |
| `observed_unique_count` | 当前唯一商品 |
| `business_eligible_count` | 当前可做商品 |
| `source_count` | 来源数 |
| `completed_source_count` | 完成来源数 |
| `config_json` | Campaign 配置快照 |
| `started_at/finished_at` | 时间 |

## 4.2 `catalog_sources`

用途：定义每个站内来源。

| 字段 | 说明 |
|---|---|
| `id` | source ID |
| `campaign_id` | 所属 campaign |
| `source_key` | 稳定键 |
| `source_type` | category/search/product_family |
| `level2/level3` | 业务类目 |
| `search_keyword` | 站内关键词 |
| `navigation_hint_json` | 影刀导航提示 |
| `sort_order` | Top Sales |
| `priority` | 执行优先级 |
| `target_quota` | 来源目标 |
| `status` | pending/opening/capturing/exhausted/completed/failed/manual_required |
| `last_error_code` | 最后错误 |
| `created_at/updated_at` | 时间 |

## 4.3 `catalog_source_runs`

记录每个来源的贡献。

| 字段 | 说明 |
|---|---|
| `source_id` | 来源 |
| `raw_observation_count` | DOM总观察 |
| `source_unique_count` | 来源内唯一数 |
| `campaign_new_unique_count` | 对 campaign 的净新增 |
| `campaign_overlap_count` | 与其他来源重叠 |
| `eligible_new_count` | 新增可做商品 |
| `load_more_count` | 加载更多次数 |
| `scroll_rounds` | 滚动轮数 |
| `stop_reason` | TARGET_REACHED/SOURCE_EXHAUSTED/MANUAL_STOP等 |
| `started_at/finished_at` | 时间 |

## 4.4 `catalog_staging_products`

Campaign 暂存区。

关键字段：

- `campaign_id`
- `goods_id`
- `first_source_id`
- `first_seen_sequence`
- `latest_title`
- `latest_source_url`
- `canonical_url`
- `image_url`
- `price`
- `sales`
- `rating`
- `review_count`
- `business_eligible`
- `business_exclusion_code`
- `quality_status`
- `raw_json`
- `first_seen_at`
- `last_seen_at`

唯一：

```text
UNIQUE(campaign_id, goods_id)
```

## 4.5 `catalog_rpa_queue`

影刀任务队列。

状态：

```text
pending
opening
waiting_page_ready
capturing
waiting_load_more
manual_required
completed
failed
cancelled
```

字段：

- `campaign_id`
- `source_id`
- `status`
- `claim_token`
- `claimed_at`
- `heartbeat_at`
- `checkpoint_json`
- `attempt_count`
- `last_error_code`
- `last_error_message`

## 4.6 `catalog_pool_versions`

建议记录每次安全商品池版本：

- `pool_version_id`
- `campaign_id`
- `product_count`
- `eligible_count`
- `status`
- `activated_at`
- `superseded_at`
- `qa_summary_json`

第一版可以继续使用 `catalog_memberships.active`，但必须有 pool version 审计。

---

# 5. 3000 商品来源策略

## 5.1 不再依赖“一个页面必须吐出 3000”

当前单一类目页即使可以持续 Try more，也不应把 3000 全压在一个页面。

采用：

```text
主类目 Top Sales
+
细分类目
+
产品族关键词
+
跨来源 goods_id 去重
```

## 5.2 建议来源层级

第一层：

- Motorcycle Accessories 主类目 / Top Sales。

第二层，优先使用 Day8.2 已识别产品族：

- 整车防护罩；
- 排气系统部件；
- 车把与横把附件；
- 坐垫与靠背；
- 边包与鞍包；
- 收纳/尾包；
- 尾包与后座包；
- 化油器；
- 锁具与防盗装置；
- 防护罩；
- 维护工具；
- 后视镜；
- 非电子装饰件。

第三层：

- 站内关键词补量。

## 5.3 来源目标配额示例

| 来源 | 初始配额 |
|---|---:|
| 主类目 Top Sales | 1000 |
| 整车防护罩 | 250 |
| 排气系统部件 | 300 |
| 车把/横把附件 | 300 |
| 收纳/尾包 | 300 |
| 坐垫/靠背 | 200 |
| 化油器/燃油系统 | 250 |
| 维修工具 | 200 |
| 防盗锁具 | 150 |
| 后视镜/视野安全 | 150 |
| 其他非电子细类 | 动态补齐 |

这些是原始来源配额，不等于最终净新增数。

## 5.4 电子与 USB

采集时不删除观察记录。

处理方式：

```text
观察到
→ 暂存
→ 业务筛选
→ excluded
→ 不计入 eligible
```

如果目标只是 observed 3000，excluded 仍计 observed。

如果目标是 eligible 3000，excluded 不计目标。

---

# 6. 影刀商品采集流程

## 6.1 API

建议增加：

```text
POST /api/catalog-rpa/campaigns
GET  /api/catalog-rpa/next-source
POST /api/catalog-rpa/source-opened
POST /api/catalog-rpa/batch
POST /api/catalog-rpa/checkpoint
POST /api/catalog-rpa/manual-required
POST /api/catalog-rpa/source-complete
GET  /api/catalog-rpa/status
```

## 6.2 影刀单来源流程

```text
领取 source
↓
打开 Temu 首页
↓
确认 Germany / English / EUR
↓
从站内进入类目或搜索
↓
切 Top Sales
↓
等待商品卡
↓
触发 Extension 读取当前批次
↓
POST batch
↓
滚动
↓
发现 Try more / See more
↓
点击
↓
等待新 goods_id
↓
再次提交批次
↓
达到 source quota / 无更多 / campaign目标
↓
source complete
↓
领取下一来源
```

## 6.3 人工关卡

遇到：

- CAPTCHA；
- 登录失效；
- 网络提示；
- No results；
- Oops! items are gone；
- 页面类目或排序不正确；
- `Try more` 点击后持续无新增。

处理：

```text
manual_required
↓
影刀停止
↓
人工修复
↓
点击继续
↓
Node验证当前页面
↓
继续checkpoint
```

不得自动破解验证码。

## 6.4 批次幂等

每个批次包含：

```json
{
  "campaign_id": "",
  "source_id": "",
  "batch_id": "",
  "page_url": "",
  "captured_at": "",
  "cards": []
}
```

唯一：

```text
campaign_id + source_id + batch_id
```

重复 POST 不应重复写入。

---

# 7. 重新抓取现有 1000 的正确方式

## 7.1 不是删除再抓

禁止：

- 清空 products；
- 删除旧 snapshots；
- 删除旧 active pool；
- 把本次 URL 当新商品身份。

正确：

```text
旧1000商品池
↓
创建 refresh campaign
↓
重新观察
↓
按 goods_id upsert
↓
新增 snapshot
↓
完成 QA
↓
激活 refresh pool version
```

## 7.2 未再次出现的旧商品

一次 refresh 没出现，不代表真实下架。

标记：

```text
not_seen_in_campaign
```

只有满足以下之一才考虑 inactive：

- 连续 N 次正式 campaign 未出现；
- 人工确认；
- 业务规则明确淘汰；
- 独立详情验证可靠。

不要因旧 URL 显示 sold out 就直接 gone。

## 7.3 Refresh 1000 验收

必须：

- 1000 unique goods_id；
- 新 snapshot = 1000；
- products 不因重复运行大幅增长；
- 旧商品身份保留；
- 来源贡献可审计；
- 重跑幂等；
- 图片覆盖 ≥95%；
- Excel 与数据库一致；
- active pool 不缩小到低于安全阈值。

---

# 8. 扩容阶段门

## Gate S0：离线与接口

必须：

- migration 幂等；
- queue 状态机；
- Extension fixture；
- batch 幂等；
- campaign staging；
- source contribution；
- Product Pool 安全切换测试。

## Gate S1：300 RPA Smoke

目标：

```text
新影刀 + Extension Catalog 模式
真实抓 300
```

验证：

- Try more 自动化；
- 断点；
- CAPTCHA 人工恢复；
- 批次重复；
- queue 恢复；
- 不污染旧1000。

## Gate S2：Refresh 1000

重新抓现有 1000。

通过后：

- 生成新 baseline；
- 不删除旧历史；
- 确认新模式可以替代人工点击。

## Gate S3：1500

目标 active observed unique：

```text
1500
```

必须报告：

- 来源贡献；
- 500 个净新增来自哪里；
- overlap；
- excluded；
- eligible。

## Gate S4：2000

新增来源，不靠重复滚动堆数。

## Gate S5：2500

重点验证：

- 长任务恢复；
- 多次人工关卡；
- 图片任务分批；
- Excel性能。

## Gate S6：3000

最终：

- unique goods_id = 3000；
- 重复率 = 0；
- 来源贡献报告；
- Product Pool 版本切换；
- 分类与业务筛选重跑；
- Excel/数据库/QA一致。

---

# 9. 推荐执行时间表

| Day | 任务 |
|---|---|
| Scale Day 1 | 分支/worktree、备份、migration、campaign/source schema |
| Scale Day 2 | Catalog Extension、localhost batch API、fixture |
| Scale Day 3 | 影刀 Catalog Queue、300真实 smoke |
| Scale Day 4 | Refresh 1000、QA、baseline pool version |
| Scale Day 5 | 扩容到1500 |
| Scale Day 6 | 扩容到2000 |
| Scale Day 7 | 扩容到2500 |
| Scale Day 8 | 扩容到3000、分类、Excel、最终验收 |

任何 Gate 失败，不进入下一 Gate。

---

# 10. Scale Day 1：安全基线与数据库

## 前置条件

- 当前分支与工作区确认；
- 正式 DB consistent backup；
- 当前 migration 列表；
- 当前 products / active / snapshots 计数；
- 当前 review 任务状态；
- 不启动浏览器。

## 文件矩阵

新增：

```text
db/migrations/020_catalog_campaigns.sql
src/db/repositories/catalog-campaign-repository.mjs
src/modules/catalog-scale/catalog-campaign-service.mjs
test/integration/catalog-campaign.test.mjs
docs/CATALOG_3000_RUNBOOK.md
```

修改：

- migration test；
- 配置 schema；
- package scripts。

## DoD

- campaign/source/staging/queue schema；
- migration两次幂等；
- 低数量不切池；
- 核心数据不变；
- 测试通过。

## Codex Prompt

```md
只执行 Catalog Scale Day 1，不要开始 Day 2。

目标：
建立 3000 商品扩容的 campaign/source/staging/queue 数据底座。

必须先读取当前 migration 最大编号。
如020已占用，使用下一个安全区间。

禁止：
- 打开Temu
- 抓商品
- 修改Product Pool
- 修改reviews
- 开始Week2下一阶段
- push/merge，除非另外授权

必须实现：
catalog_campaigns
catalog_sources
catalog_source_runs
catalog_staging_products
catalog_rpa_queue
catalog_pool_versions

测试：
- migration两次
- schema checksum
- campaign状态
- source状态
- batch幂等
- 低数量安全拒绝
- Product Pool核心计数不变

完成后输出：

# Catalog Scale Day 1 Result
## 1. Git状态
## 2. Migration
## 3. 表结构
## 4. Repository
## 5. 状态机
## 6. 测试
## 7. 核心数据前后
## 8. PASS/FAIL

完成后停止。
```

---

# 11. Scale Day 2：Catalog Browser Extension 与 API

## 文件矩阵

新增：

```text
browser-extension/catalog-capture.js
browser-extension/catalog-parser.js
src/server/controllers/catalog-rpa-controller.mjs
src/modules/catalog-scale/catalog-batch-service.mjs
test/unit/catalog-extension.test.mjs
test/integration/catalog-rpa-api.test.mjs
```

## API要求

- 只绑定 127.0.0.1；
- runtime token；
- CORS仅扩展来源；
- schema validation；
- goods_id 校验；
- batch 幂等；
- 不信任 Extension 原始输入。

## DoD

- fixture能解析商品卡；
- 1000批次模拟去重；
- 重复batch不增数据；
- 电子标记不删除；
- staging不修改active pool。

## Codex Prompt

```md
只执行 Catalog Scale Day 2，不要开始 Day 3。

目标：
增加 Browser Extension Catalog Capture 模式和 localhost API。

Extension只读取当前页面商品卡，不负责跨批次去重。

Node必须：
- 验证campaign/source/batch
- 解析goods_id
- 标准化字段
- 写staging
- 更新source contribution
- checkpoint

禁止：
- 自动打开Temu
- 影刀真实运行
- Product Pool切换
- 修改评论采集逻辑

完成后输出文件、API、schema、测试、QA和PASS/FAIL。
```

---

# 12. Scale Day 3：影刀队列与300真实验证

## 影刀流程文件

输出：

```text
docs/YINGDAO_CATALOG_3000_BUILD_GUIDE.md
docs/YINGDAO_CATALOG_3000_RUNBOOK.md
```

Node API必须允许影刀：

- 领取来源；
- 标记页面打开；
- 保存checkpoint；
- 标记人工关卡；
- 标记来源完成。

## 300验收

- 使用真实 Chrome；
- Germany / English / EUR；
- Motorcycle Accessories / Top Sales；
- 自动点击 Try more；
- Extension批次；
- 300 unique；
- Product Pool仍保持旧1000；
- staging和source report完整。

## Codex Prompt

```md
只执行 Catalog Scale Day 3。

目标：
完成影刀Catalog Queue接口和300商品真实smoke。

不进入1000 refresh。

成功标准：
- 300 unique goods_id
- 自动Try more
- 至少一次checkpoint
- 可暂停/恢复
- batch重复=0
- Product Pool不变
- source贡献报告完成

失败时保留campaign，不伪造完成。
```

---

# 13. Scale Day 4：重新抓取1000

## 目标

创建：

```text
campaign_type=refresh
target_observed_count=1000
```

## QA

- unique = 1000；
- 与旧 active 1000 重叠数；
- 新商品数；
- 未再次出现数；
- products增长原因；
- snapshot新增1000；
- 图片覆盖；
- 字段完整率；
- source_url新鲜度；
- active切换前后；
- Excel。

## Codex Prompt

```md
只执行 Catalog Scale Day 4。

使用新影刀 + Extension链路，重新抓1000商品。

禁止清空旧数据。

要求输出：
- 旧1000与新1000交集
- 新增
- 未再次发现
- snapshot新增
- 图片
- QA
- Pool Version

只有全部安全门通过才允许激活新baseline。
```

---

# 14. Scale Day 5—8：1500到3000

每个阶段只增加目标，不重复改架构。

统一 Prompt 模板：

```md
只执行 Catalog Scale Gate <TARGET>。

当前安全基线：
<PREVIOUS_TARGET>

目标：
observed unique = <TARGET>

要求：
1. 先使用未完成来源。
2. 来源耗尽后增加新的非电子细分类/搜索来源。
3. 报告每个来源：
   raw
   unique
   campaign_new
   overlap
   eligible_new
   stop_reason
4. 不用重复商品补数。
5. 不使用假数据。
6. 不降低质量阈值。
7. Gate通过后生成pool version。
8. Product Pool切换必须事务化。

输出：
# Catalog Scale <TARGET> Result
## campaign
## 来源
## unique
## eligible
## overlap
## snapshots
## images
## QA
## Pool前后
## PASS/FAIL
```

执行顺序：

```text
1500
→ 验收
→ 2000
→ 验收
→ 2500
→ 验收
→ 3000
```

---

# 15. 3000最终质量阈值

| 指标 | 要求 |
|---|---|
| observed unique goods_id | 3000 |
| 重复率 | 0 |
| goods_id / canonical_url | 100% |
| site/language/currency/category/sort | 100% |
| title/price/image | ≥95% |
| sales/rating/review_count | ≥90% 或诚实为null |
| 图片可用率 | ≥95% |
| 来源贡献 | 每个source可审计 |
| Pool切换 | 事务通过 |
| checkpoint | 中断恢复不重写 |
| batch幂等 | 重放无新增重复 |
| Excel | 3000行，与数据库一致 |
| 分类 | 3000全部有当前分类状态 |
| 业务筛选 | eligible/excluded/pending合计3000 |
| 原历史 | 不删除 |

---

# 16. 并行运行矩阵

| 工作 | 可与Catalog真实采集并行吗 |
|---|---|
| Codex写评论分析代码（测试DB） | 可以 |
| Day10/Day11读取consistent backup | 可以 |
| 评论影刀控制同一Chrome | 不可以 |
| 评论任务写同一生产SQLite | 不建议 |
| Excel从只读备份导出 | 可以 |
| migration | 不可以并行 |
| 商品图片缓存 | 可低并发，但建议采集后执行 |
| AI离线分析已抓评论 | 可以 |

推荐排班：

```text
上午：Catalog 影刀真实采集
下午：Review 影刀
晚上：离线分析 / Excel / 测试
```

或者按天分窗口。

---

# 17. 数据回滚

每个 Gate 前：

- consistent backup；
- 记录 integrity check；
- 记录核心计数；
- 记录 active pool version。

Gate失败：

- campaign保留 failed/qa_failed；
- staging保留审计；
- active pool不切换；
- 不删除已成功 snapshots；
- 可从checkpoint继续或创建新campaign；
- 回滚只切 pool version，不回滚历史数据。

---

# 18. 最终交付物

代码：

- campaign/source/staging/queue；
- Catalog Extension；
- localhost API；
- 影刀接口；
- pool version；
- QA。

数据：

- refresh 1000 campaign；
- 1500/2000/2500/3000 campaign；
- 3000 active pool；
- source contribution；
- snapshots；
- business screening；
- classification。

文档：

- `CATALOG_3000_RUNBOOK.md`
- `YINGDAO_CATALOG_3000_BUILD_GUIDE.md`
- `YINGDAO_CATALOG_3000_RUNBOOK.md`
- `CATALOG_3000_ACCEPTANCE_REPORT.md`
- `DATA_SYNC_RUNBOOK.md`

Excel：

- 3000 商品运营池；
- 来源贡献；
- 数据质量；
- 任务记录；
- 字段说明；
- 分类与业务准入。

---

# 19. 最终决策

## 是否需要重新执行第一周

不需要从 Day1 重做。

建议名称：

```text
Week1.5 / Catalog Scale V2
```

只复用并扩展：

- catalog；
- product persistence；
- quality；
- export；
- dashboard。

## Codex是否可以并行

可以并行开发，但必须：

- 两个 worktree；
- 两个分支；
- 文件边界；
- migration编号预留；
- 测试数据库隔离；
- 生产写任务串行；
- 同一 Chrome 一次只有一个 RPA任务。

## 1000重新抓取与3000扩容

正确顺序：

```text
300 RPA smoke
↓
refresh 1000
↓
1500
↓
2000
↓
2500
↓
3000
```

每一步必须经过 QA，不能直接把 target 改成 3000 后长时间无人看守。
# Temu 商品池 3000 扩容、影刀 RPA 与 Codex 并行开发执行方案

版本：V1.0  
类型：Codex 可执行工程计划  
适用仓库：`LiYiXilyx/in-home-xuanpin`  
建议工作分支：`feat/catalog-3000-rpa`  
建议阶段名称：`Week1.5 / Catalog Scale V2`

---

# 0. 文档定位

本文件不是重新推翻第一周，而是在第一周已经完成的商品池底座上增加一条“可扩容、可重跑、可审计”的 3000 商品采集链路。

第一周已有能力继续保留：

- `platform + goods_id` 稳定商品身份；
- `products / catalog_memberships / product_snapshots` 分层；
- SQLite 为正式数据源；
- checkpoint / pause / resume / retry；
- 图片缓存、质量门、Excel 与运营台；
- 100 / 300 / 1000 阶段门；
- 旧商品池安全保护。

本次新增能力：

- 影刀控制真实 Chrome 的重复页面操作；
- Browser Extension 读取商品卡 DOM；
- Node localhost API 接收批次并写 SQLite；
- 多来源采集；
- 跨来源 `goods_id` 去重；
- 1000 基线重新抓取；
- 1000 → 1500 → 2000 → 2500 → 3000 扩容；
- 每个来源的贡献、重叠和耗时审计；
- 新旧商品池版本化与安全切换；
- Codex 双轨并行开发规则。

核心原则：

> 不重新造一套商品数据库，不把影刀变成第二个数据库，不让 Excel 成为任务真相源。

---

# 1. 当前问题与改造结论

## 1.1 第一周链路为什么“能完成但不够流畅”

当前商品采集已经支持滚动、识别 `Try again / Try more / Load more / See more / Show more`，但在页面未产生新商品时会进入人工关卡。

这套设计适合 1000 商品验收，但扩展到 3000 时会出现：

- 页面深度更大；
- `Try more` 出现次数增加；
- 单一页面可能不能提供 3000 个唯一商品；
- 人工点击频率升高；
- 一次任务持续时间太长；
- 页面状态、验证码、网络异常概率上升；
- 失败后重新从当前页面恢复的运营成本上升。

## 1.2 不建议整体推翻第一周

不做：

- 删除现有 Playwright 采集器；
- 重写 SQLite 数据模型；
- 改用 Excel 当正式数据源；
- 重新创建第二套 `products`；
- 为影刀单独维护一套商品表；
- 一口气从 1000 直接跑 3000；
- 两个进程同时写同一个生产 SQLite。

建议：

> 保留第一周核心，新增 Catalog Scale V2 作为第二条采集入口。

## 1.3 3000 的口径

必须同时报告两种数量：

```text
observed_unique_count
= 抓到的唯一 goods_id 数量

business_eligible_count
= 经过电子 / USB / 电池 / 认证 / 价格等业务规则后可研究的数量
```

默认 Gate 目标：

```text
observed_unique_count = 3000
```

不得把 3000 行 DOM 观察、重复卡片或跨来源重复当成 3000 商品。

如果老板明确要求“3000 个业务可做商品”，则将 Gate 改为：

```text
business_eligible_count = 3000
```

系统需要继续抓取超过 3000 个 observed 商品，直到 eligible 达标或来源耗尽。

---

# 2. 总体架构

```text
                         Temu

                           │

                    真实 Chrome

                           │
              ┌────────────┴────────────┐
              │                         │
          影刀 RPA              Browser Extension
       页面导航、滚动、点击          商品卡结构化读取
              │                         │
              └────────────┬────────────┘
                           │
                     localhost API
                           │
                         Node.js
         任务 / 去重 / 规则 / 质量 / 事务 / QA
                           │
                         SQLite
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
     Product Pool       Snapshots        Excel / 分析
```

## 2.1 影刀职责

影刀负责：

- 打开真实 Chrome；
- 从 Temu 首页或站内路径进入目标类目；
- 选择 Germany / English / EUR；
- 选择 Top Sales；
- 滚动；
- 点击 `Try more / Try again / See more / Load more`；
- 等待商品卡加载；
- 触发 Browser Extension 的“采集当前列表批次”；
- 轮询 localhost 任务状态；
- 遇到验证码时暂停并提示人工；
- 来源完成后领取下一个来源任务。

影刀不负责：

- 直接写 SQLite；
- 计算 goods_id；
- 去重；
- 商品身份判断；
- 质量门；
- 切换 active 商品池；
- 分类或评分；
- 保存 Cookie / Token。

## 2.2 Browser Extension 职责

新增 Catalog Capture 模式。

负责：

- 读取当前页面 URL、页面标题和脱敏页面状态；
- 提取商品卡；
- 提取当前可见的：
  - `goods_id`
  - `href`
  - `title`
  - `image_url`
  - `price`
  - `sales`
  - `rating`
  - `review_count`
  - 当前 DOM 顺序
- 将批次发送给 localhost API；
- 不持久化业务数据；
- 不负责跨批次去重；
- 不自动遍历全站。

## 2.3 Node / SQLite 职责

Node 负责：

- campaign / source / queue 管理；
- 批次 schema validation；
- `goods_id` 提取和身份校验；
- 跨批次、跨来源去重；
- 首次发现顺序；
- 来源贡献统计；
- snapshot；
- 图片任务；
- 质量门；
- Product Pool 事务切换；
- Excel / QA；
- 审计与错误记录。

---

# 3. 是否可以让“第一周扩容”和“当前 Week2”并行

## 3.1 结论

可以并行，但必须区分：

### 可以并行

- 两个 Codex 会话；
- 两个 Git worktree；
- 两条功能分支；
- 单元测试；
- fixture 集成测试；
- 一个轨道跑生产采集，另一个轨道做只读分析或测试数据库开发。

### 不建议并行

- 同一个工作目录同时让两个 Codex 修改代码；
- 两个进程同时执行 migration；
- 两个生产任务同时写同一个 SQLite；
- 影刀商品池任务和影刀评论任务同时控制同一个 Chrome；
- 公司、家里两台电脑各自写不同正式数据库，之后手工合并。

## 3.2 推荐双轨

### Track A：Catalog 3000

分支：

```text
feat/catalog-3000-rpa
```

工作目录：

```text
../in-home-xuanpin-catalog-3000
```

负责：

- 影刀商品池队列；
- Catalog Extension；
- 多来源；
- 1000 refresh；
- 3000 expansion；
- 商品池 QA。

### Track B：Week2 Review / Insight

分支：

```text
feat/week2-review-insight
```

工作目录：

```text
../in-home-xuanpin-week2
```

负责：

- 评论覆盖；
- 生命周期；
- 评论洞察；
- 产品机会。

## 3.3 Git worktree 命令示例

在主仓库工作区干净后：

```bash
git fetch origin

git worktree add ../in-home-xuanpin-catalog-3000 \
  -b feat/catalog-3000-rpa \
  refactor/week1-catalog-core

git worktree add ../in-home-xuanpin-week2 \
  -b feat/week2-review-insight \
  refactor/week1-catalog-core
```

Windows CMD 可分行执行。

## 3.4 文件所有权

| 区域 | Track A | Track B |
|---|---|---|
| `src/modules/catalog/**` | 独占 | 不修改 |
| `browser-extension/catalog-*` | 独占 | 不修改 |
| `src/modules/reviews/**` | 不修改 | 独占 |
| `src/modules/analysis/**` | 只读/最小修改 | 独占 |
| `src/db/repositories/catalog-*` | 独占 | 不修改 |
| `src/db/repositories/review-*` | 不修改 | 独占 |
| `src/cli.mjs` | 共享，合并时处理 | 共享，合并时处理 |
| `src/server/router.mjs` | 共享，合并时处理 | 共享，合并时处理 |
| `package.json` | 共享，合并时处理 | 共享，合并时处理 |
| migration test | 共享，合并时处理 | 共享，合并时处理 |

## 3.5 Migration 编号预留

执行前先检查当前最大 migration。

建议：

```text
Week2 Review / Insight：016—019
Catalog 3000：020—024
```

如果编号已经占用，Codex必须选择下一个连续区间，并更新本文件的实际执行记录。

禁止两个分支创建同名编号的不同 migration。

## 3.6 生产数据库规则

正式数据库只允许一个权威副本。

推荐：

```text
公司电脑 = 正式生产数据库与真实 Chrome / 影刀运行机
家里电脑 = 代码开发、测试数据库、fixture
```

真实运行时：

- Catalog 采集窗口：暂停 Review RPA；
- Review 采集窗口：暂停 Catalog RPA；
- 只读分析可以从 SQLite consistent backup 运行；
- 不在 OneDrive、网盘或网络共享目录直接运行 SQLite。

---

# 4. 数据模型扩展

建议 migration 区间：020—024。

## 4.1 `catalog_campaigns`

用途：一轮 1000 refresh 或 3000 扩容的总任务。

| 字段 | 说明 |
|---|---|
| `id` | campaign ID |
| `name` | 例如 `catalog-refresh-1000-20260825` |
| `campaign_type` | `refresh / expansion` |
| `target_observed_count` | 1000 / 1500 / 2000 / 2500 / 3000 |
| `target_eligible_count` | 可为空 |
| `baseline_pool_count` | 启动前 active 数量 |
| `status` | pending/running/paused/qa_failed/completed/failed/cancelled |
| `observed_unique_count` | 当前唯一商品 |
| `business_eligible_count` | 当前可做商品 |
| `source_count` | 来源数 |
| `completed_source_count` | 完成来源数 |
| `config_json` | Campaign 配置快照 |
| `started_at/finished_at` | 时间 |

## 4.2 `catalog_sources`

用途：定义每个站内来源。

| 字段 | 说明 |
|---|---|
| `id` | source ID |
| `campaign_id` | 所属 campaign |
| `source_key` | 稳定键 |
| `source_type` | category/search/product_family |
| `level2/level3` | 业务类目 |
| `search_keyword` | 站内关键词 |
| `navigation_hint_json` | 影刀导航提示 |
| `sort_order` | Top Sales |
| `priority` | 执行优先级 |
| `target_quota` | 来源目标 |
| `status` | pending/opening/capturing/exhausted/completed/failed/manual_required |
| `last_error_code` | 最后错误 |
| `created_at/updated_at` | 时间 |

## 4.3 `catalog_source_runs`

记录每个来源的贡献。

| 字段 | 说明 |
|---|---|
| `source_id` | 来源 |
| `raw_observation_count` | DOM总观察 |
| `source_unique_count` | 来源内唯一数 |
| `campaign_new_unique_count` | 对 campaign 的净新增 |
| `campaign_overlap_count` | 与其他来源重叠 |
| `eligible_new_count` | 新增可做商品 |
| `load_more_count` | 加载更多次数 |
| `scroll_rounds` | 滚动轮数 |
| `stop_reason` | TARGET_REACHED/SOURCE_EXHAUSTED/MANUAL_STOP等 |
| `started_at/finished_at` | 时间 |

## 4.4 `catalog_staging_products`

Campaign 暂存区。

关键字段：

- `campaign_id`
- `goods_id`
- `first_source_id`
- `first_seen_sequence`
- `latest_title`
- `latest_source_url`
- `canonical_url`
- `image_url`
- `price`
- `sales`
- `rating`
- `review_count`
- `business_eligible`
- `business_exclusion_code`
- `quality_status`
- `raw_json`
- `first_seen_at`
- `last_seen_at`

唯一：

```text
UNIQUE(campaign_id, goods_id)
```

## 4.5 `catalog_rpa_queue`

影刀任务队列。

状态：

```text
pending
opening
waiting_page_ready
capturing
waiting_load_more
manual_required
completed
failed
cancelled
```

字段：

- `campaign_id`
- `source_id`
- `status`
- `claim_token`
- `claimed_at`
- `heartbeat_at`
- `checkpoint_json`
- `attempt_count`
- `last_error_code`
- `last_error_message`

## 4.6 `catalog_pool_versions`

建议记录每次安全商品池版本：

- `pool_version_id`
- `campaign_id`
- `product_count`
- `eligible_count`
- `status`
- `activated_at`
- `superseded_at`
- `qa_summary_json`

第一版可以继续使用 `catalog_memberships.active`，但必须有 pool version 审计。

---

# 5. 3000 商品来源策略

## 5.1 不再依赖“一个页面必须吐出 3000”

当前单一类目页即使可以持续 Try more，也不应把 3000 全压在一个页面。

采用：

```text
主类目 Top Sales
+
细分类目
+
产品族关键词
+
跨来源 goods_id 去重
```

## 5.2 建议来源层级

第一层：

- Motorcycle Accessories 主类目 / Top Sales。

第二层，优先使用 Day8.2 已识别产品族：

- 整车防护罩；
- 排气系统部件；
- 车把与横把附件；
- 坐垫与靠背；
- 边包与鞍包；
- 收纳/尾包；
- 尾包与后座包；
- 化油器；
- 锁具与防盗装置；
- 防护罩；
- 维护工具；
- 后视镜；
- 非电子装饰件。

第三层：

- 站内关键词补量。

## 5.3 来源目标配额示例

| 来源 | 初始配额 |
|---|---:|
| 主类目 Top Sales | 1000 |
| 整车防护罩 | 250 |
| 排气系统部件 | 300 |
| 车把/横把附件 | 300 |
| 收纳/尾包 | 300 |
| 坐垫/靠背 | 200 |
| 化油器/燃油系统 | 250 |
| 维修工具 | 200 |
| 防盗锁具 | 150 |
| 后视镜/视野安全 | 150 |
| 其他非电子细类 | 动态补齐 |

这些是原始来源配额，不等于最终净新增数。

## 5.4 电子与 USB

采集时不删除观察记录。

处理方式：

```text
观察到
→ 暂存
→ 业务筛选
→ excluded
→ 不计入 eligible
```

如果目标只是 observed 3000，excluded 仍计 observed。

如果目标是 eligible 3000，excluded 不计目标。

---

# 6. 影刀商品采集流程

## 6.1 API

建议增加：

```text
POST /api/catalog-rpa/campaigns
GET  /api/catalog-rpa/next-source
POST /api/catalog-rpa/source-opened
POST /api/catalog-rpa/batch
POST /api/catalog-rpa/checkpoint
POST /api/catalog-rpa/manual-required
POST /api/catalog-rpa/source-complete
GET  /api/catalog-rpa/status
```

## 6.2 影刀单来源流程

```text
领取 source
↓
打开 Temu 首页
↓
确认 Germany / English / EUR
↓
从站内进入类目或搜索
↓
切 Top Sales
↓
等待商品卡
↓
触发 Extension 读取当前批次
↓
POST batch
↓
滚动
↓
发现 Try more / See more
↓
点击
↓
等待新 goods_id
↓
再次提交批次
↓
达到 source quota / 无更多 / campaign目标
↓
source complete
↓
领取下一来源
```

## 6.3 人工关卡

遇到：

- CAPTCHA；
- 登录失效；
- 网络提示；
- No results；
- Oops! items are gone；
- 页面类目或排序不正确；
- `Try more` 点击后持续无新增。

处理：

```text
manual_required
↓
影刀停止
↓
人工修复
↓
点击继续
↓
Node验证当前页面
↓
继续checkpoint
```

不得自动破解验证码。

## 6.4 批次幂等

每个批次包含：

```json
{
  "campaign_id": "",
  "source_id": "",
  "batch_id": "",
  "page_url": "",
  "captured_at": "",
  "cards": []
}
```

唯一：

```text
campaign_id + source_id + batch_id
```

重复 POST 不应重复写入。

---

# 7. 重新抓取现有 1000 的正确方式

## 7.1 不是删除再抓

禁止：

- 清空 products；
- 删除旧 snapshots；
- 删除旧 active pool；
- 把本次 URL 当新商品身份。

正确：

```text
旧1000商品池
↓
创建 refresh campaign
↓
重新观察
↓
按 goods_id upsert
↓
新增 snapshot
↓
完成 QA
↓
激活 refresh pool version
```

## 7.2 未再次出现的旧商品

一次 refresh 没出现，不代表真实下架。

标记：

```text
not_seen_in_campaign
```

只有满足以下之一才考虑 inactive：

- 连续 N 次正式 campaign 未出现；
- 人工确认；
- 业务规则明确淘汰；
- 独立详情验证可靠。

不要因旧 URL 显示 sold out 就直接 gone。

## 7.3 Refresh 1000 验收

必须：

- 1000 unique goods_id；
- 新 snapshot = 1000；
- products 不因重复运行大幅增长；
- 旧商品身份保留；
- 来源贡献可审计；
- 重跑幂等；
- 图片覆盖 ≥95%；
- Excel 与数据库一致；
- active pool 不缩小到低于安全阈值。

---

# 8. 扩容阶段门

## Gate S0：离线与接口

必须：

- migration 幂等；
- queue 状态机；
- Extension fixture；
- batch 幂等；
- campaign staging；
- source contribution；
- Product Pool 安全切换测试。

## Gate S1：300 RPA Smoke

目标：

```text
新影刀 + Extension Catalog 模式
真实抓 300
```

验证：

- Try more 自动化；
- 断点；
- CAPTCHA 人工恢复；
- 批次重复；
- queue 恢复；
- 不污染旧1000。

## Gate S2：Refresh 1000

重新抓现有 1000。

通过后：

- 生成新 baseline；
- 不删除旧历史；
- 确认新模式可以替代人工点击。

## Gate S3：1500

目标 active observed unique：

```text
1500
```

必须报告：

- 来源贡献；
- 500 个净新增来自哪里；
- overlap；
- excluded；
- eligible。

## Gate S4：2000

新增来源，不靠重复滚动堆数。

## Gate S5：2500

重点验证：

- 长任务恢复；
- 多次人工关卡；
- 图片任务分批；
- Excel性能。

## Gate S6：3000

最终：

- unique goods_id = 3000；
- 重复率 = 0；
- 来源贡献报告；
- Product Pool 版本切换；
- 分类与业务筛选重跑；
- Excel/数据库/QA一致。

---

# 9. 推荐执行时间表

| Day | 任务 |
|---|---|
| Scale Day 1 | 分支/worktree、备份、migration、campaign/source schema |
| Scale Day 2 | Catalog Extension、localhost batch API、fixture |
| Scale Day 3 | 影刀 Catalog Queue、300真实 smoke |
| Scale Day 4 | Refresh 1000、QA、baseline pool version |
| Scale Day 5 | 扩容到1500 |
| Scale Day 6 | 扩容到2000 |
| Scale Day 7 | 扩容到2500 |
| Scale Day 8 | 扩容到3000、分类、Excel、最终验收 |

任何 Gate 失败，不进入下一 Gate。

---

# 10. Scale Day 1：安全基线与数据库

## 前置条件

- 当前分支与工作区确认；
- 正式 DB consistent backup；
- 当前 migration 列表；
- 当前 products / active / snapshots 计数；
- 当前 review 任务状态；
- 不启动浏览器。

## 文件矩阵

新增：

```text
db/migrations/020_catalog_campaigns.sql
src/db/repositories/catalog-campaign-repository.mjs
src/modules/catalog-scale/catalog-campaign-service.mjs
test/integration/catalog-campaign.test.mjs
docs/CATALOG_3000_RUNBOOK.md
```

修改：

- migration test；
- 配置 schema；
- package scripts。

## DoD

- campaign/source/staging/queue schema；
- migration两次幂等；
- 低数量不切池；
- 核心数据不变；
- 测试通过。

## Codex Prompt

```md
只执行 Catalog Scale Day 1，不要开始 Day 2。

目标：
建立 3000 商品扩容的 campaign/source/staging/queue 数据底座。

必须先读取当前 migration 最大编号。
如020已占用，使用下一个安全区间。

禁止：
- 打开Temu
- 抓商品
- 修改Product Pool
- 修改reviews
- 开始Week2下一阶段
- push/merge，除非另外授权

必须实现：
catalog_campaigns
catalog_sources
catalog_source_runs
catalog_staging_products
catalog_rpa_queue
catalog_pool_versions

测试：
- migration两次
- schema checksum
- campaign状态
- source状态
- batch幂等
- 低数量安全拒绝
- Product Pool核心计数不变

完成后输出：

# Catalog Scale Day 1 Result
## 1. Git状态
## 2. Migration
## 3. 表结构
## 4. Repository
## 5. 状态机
## 6. 测试
## 7. 核心数据前后
## 8. PASS/FAIL

完成后停止。
```

---

# 11. Scale Day 2：Catalog Browser Extension 与 API

## 文件矩阵

新增：

```text
browser-extension/catalog-capture.js
browser-extension/catalog-parser.js
src/server/controllers/catalog-rpa-controller.mjs
src/modules/catalog-scale/catalog-batch-service.mjs
test/unit/catalog-extension.test.mjs
test/integration/catalog-rpa-api.test.mjs
```

## API要求

- 只绑定 127.0.0.1；
- runtime token；
- CORS仅扩展来源；
- schema validation；
- goods_id 校验；
- batch 幂等；
- 不信任 Extension 原始输入。

## DoD

- fixture能解析商品卡；
- 1000批次模拟去重；
- 重复batch不增数据；
- 电子标记不删除；
- staging不修改active pool。

## Codex Prompt

```md
只执行 Catalog Scale Day 2，不要开始 Day 3。

目标：
增加 Browser Extension Catalog Capture 模式和 localhost API。

Extension只读取当前页面商品卡，不负责跨批次去重。

Node必须：
- 验证campaign/source/batch
- 解析goods_id
- 标准化字段
- 写staging
- 更新source contribution
- checkpoint

禁止：
- 自动打开Temu
- 影刀真实运行
- Product Pool切换
- 修改评论采集逻辑

完成后输出文件、API、schema、测试、QA和PASS/FAIL。
```

---

# 12. Scale Day 3：影刀队列与300真实验证

## 影刀流程文件

输出：

```text
docs/YINGDAO_CATALOG_3000_BUILD_GUIDE.md
docs/YINGDAO_CATALOG_3000_RUNBOOK.md
```

Node API必须允许影刀：

- 领取来源；
- 标记页面打开；
- 保存checkpoint；
- 标记人工关卡；
- 标记来源完成。

## 300验收

- 使用真实 Chrome；
- Germany / English / EUR；
- Motorcycle Accessories / Top Sales；
- 自动点击 Try more；
- Extension批次；
- 300 unique；
- Product Pool仍保持旧1000；
- staging和source report完整。

## Codex Prompt

```md
只执行 Catalog Scale Day 3。

目标：
完成影刀Catalog Queue接口和300商品真实smoke。

不进入1000 refresh。

成功标准：
- 300 unique goods_id
- 自动Try more
- 至少一次checkpoint
- 可暂停/恢复
- batch重复=0
- Product Pool不变
- source贡献报告完成

失败时保留campaign，不伪造完成。
```

---

# 13. Scale Day 4：重新抓取1000

## 目标

创建：

```text
campaign_type=refresh
target_observed_count=1000
```

## QA

- unique = 1000；
- 与旧 active 1000 重叠数；
- 新商品数；
- 未再次出现数；
- products增长原因；
- snapshot新增1000；
- 图片覆盖；
- 字段完整率；
- source_url新鲜度；
- active切换前后；
- Excel。

## Codex Prompt

```md
只执行 Catalog Scale Day 4。

使用新影刀 + Extension链路，重新抓1000商品。

禁止清空旧数据。

要求输出：
- 旧1000与新1000交集
- 新增
- 未再次发现
- snapshot新增
- 图片
- QA
- Pool Version

只有全部安全门通过才允许激活新baseline。
```

---

# 14. Scale Day 5—8：1500到3000

每个阶段只增加目标，不重复改架构。

统一 Prompt 模板：

```md
只执行 Catalog Scale Gate <TARGET>。

当前安全基线：
<PREVIOUS_TARGET>

目标：
observed unique = <TARGET>

要求：
1. 先使用未完成来源。
2. 来源耗尽后增加新的非电子细分类/搜索来源。
3. 报告每个来源：
   raw
   unique
   campaign_new
   overlap
   eligible_new
   stop_reason
4. 不用重复商品补数。
5. 不使用假数据。
6. 不降低质量阈值。
7. Gate通过后生成pool version。
8. Product Pool切换必须事务化。

输出：
# Catalog Scale <TARGET> Result
## campaign
## 来源
## unique
## eligible
## overlap
## snapshots
## images
## QA
## Pool前后
## PASS/FAIL
```

执行顺序：

```text
1500
→ 验收
→ 2000
→ 验收
→ 2500
→ 验收
→ 3000
```

---

# 15. 3000最终质量阈值

| 指标 | 要求 |
|---|---|
| observed unique goods_id | 3000 |
| 重复率 | 0 |
| goods_id / canonical_url | 100% |
| site/language/currency/category/sort | 100% |
| title/price/image | ≥95% |
| sales/rating/review_count | ≥90% 或诚实为null |
| 图片可用率 | ≥95% |
| 来源贡献 | 每个source可审计 |
| Pool切换 | 事务通过 |
| checkpoint | 中断恢复不重写 |
| batch幂等 | 重放无新增重复 |
| Excel | 3000行，与数据库一致 |
| 分类 | 3000全部有当前分类状态 |
| 业务筛选 | eligible/excluded/pending合计3000 |
| 原历史 | 不删除 |

---

# 16. 并行运行矩阵

| 工作 | 可与Catalog真实采集并行吗 |
|---|---|
| Codex写评论分析代码（测试DB） | 可以 |
| Day10/Day11读取consistent backup | 可以 |
| 评论影刀控制同一Chrome | 不可以 |
| 评论任务写同一生产SQLite | 不建议 |
| Excel从只读备份导出 | 可以 |
| migration | 不可以并行 |
| 商品图片缓存 | 可低并发，但建议采集后执行 |
| AI离线分析已抓评论 | 可以 |

推荐排班：

```text
上午：Catalog 影刀真实采集
下午：Review 影刀
晚上：离线分析 / Excel / 测试
```

或者按天分窗口。

---

# 17. 数据回滚

每个 Gate 前：

- consistent backup；
- 记录 integrity check；
- 记录核心计数；
- 记录 active pool version。

Gate失败：

- campaign保留 failed/qa_failed；
- staging保留审计；
- active pool不切换；
- 不删除已成功 snapshots；
- 可从checkpoint继续或创建新campaign；
- 回滚只切 pool version，不回滚历史数据。

---

# 18. 最终交付物

代码：

- campaign/source/staging/queue；
- Catalog Extension；
- localhost API；
- 影刀接口；
- pool version；
- QA。

数据：

- refresh 1000 campaign；
- 1500/2000/2500/3000 campaign；
- 3000 active pool；
- source contribution；
- snapshots；
- business screening；
- classification。

文档：

- `CATALOG_3000_RUNBOOK.md`
- `YINGDAO_CATALOG_3000_BUILD_GUIDE.md`
- `YINGDAO_CATALOG_3000_RUNBOOK.md`
- `CATALOG_3000_ACCEPTANCE_REPORT.md`
- `DATA_SYNC_RUNBOOK.md`

Excel：

- 3000 商品运营池；
- 来源贡献；
- 数据质量；
- 任务记录；
- 字段说明；
- 分类与业务准入。

---

# 19. 最终决策

## 是否需要重新执行第一周

不需要从 Day1 重做。

建议名称：

```text
Week1.5 / Catalog Scale V2
```

只复用并扩展：

- catalog；
- product persistence；
- quality；
- export；
- dashboard。

## Codex是否可以并行

可以并行开发，但必须：

- 两个 worktree；
- 两个分支；
- 文件边界；
- migration编号预留；
- 测试数据库隔离；
- 生产写任务串行；
- 同一 Chrome 一次只有一个 RPA任务。

## 1000重新抓取与3000扩容

正确顺序：

```text
300 RPA smoke
↓
refresh 1000
↓
1500
↓
2000
↓
2500
↓
3000
```

每一步必须经过 QA，不能直接把 target 改成 3000 后长时间无人看守。
---

# 22. 业务硬排除更新：电子产品不进入采集目标

本版本新增硬性业务规则：

> 当前阶段不做电子产品，因为后续可能涉及 3C / 认证 / 电池 / 充电 / 无线通信等合规要求。

因此 Catalog Scale V2 不再采用“先把电子产品也抓进 observed，再业务排除”的默认策略。

## 22.1 新规则

商品卡在采集阶段如果已经能够高置信度识别为电子类，则：

```text
不进入正式 Catalog Staging
不进入 observed_unique_count 目标
不进入 business eligible
不进入 Review Pool
不进入 3000 目标计数
```

但为了审计，可以写入轻量排除日志：

```text
catalog_exclusion_observations
```

只保存：

- goods_id（可识别时）
- title
- source_id
- exclusion_code
- exclusion_reason
- detected_at
- classifier_version

不得把完整电子商品数据写入正式 Product Pool。

## 22.2 硬排除代码

至少：

```text
ELECTRONIC_PRODUCT
USB_PRODUCT
BATTERY_PRODUCT
RECHARGEABLE_PRODUCT
BLUETOOTH_PRODUCT
WIRELESS_COMMUNICATION
AUDIO_ELECTRONIC
LIGHTING_ELECTRONIC
CERTIFICATION_RISK
```

注意：

`LIGHTING_ELECTRONIC` 当前默认排除。

如果以后老板明确开放某类低风险照明，再单独修改业务规则版本。

## 22.3 识别优先级

使用：

```text
标题关键词规则
+
现有 fine classification
+
必要时 AI 结构化分类
```

但采集主流程不能因为 AI 暂时不可用而阻塞。

无 AI Key 时：

```text
rule-only
```

低置信度：

```text
manual_review_required
```

不允许为了凑够3000把低置信度电子商品放入正式池。

## 22.4 3000目标口径修改

从本版本开始，默认：

```text
target_catalog_count = 3000 个“非电子、业务允许”的唯一商品
```

因此：

```text
excluded electronic
```

不计入3000。

Campaign必须同时报告：

```text
raw_observed_count
electronic_excluded_count
non_electronic_unique_count
business_eligible_count
reviewable_unique_count
```

默认阶段门：

```text
non_electronic_unique_count = 3000
```

如果老板以后要求“3000个可抓评论商品”，则进一步使用：

```text
reviewable_unique_count = 3000
```

## 22.5 影刀 / Extension 采集时的排除策略

### 当前批次商品卡解析

Extension提取商品卡后，Node先执行：

```text
normalize
↓
electronic screening
↓
dedupe
↓
staging
```

命中电子硬排除：

```text
写 exclusion audit
↓
不进入 staging
↓
继续下一商品
```

影刀不需要点进电子商品详情。

这样可以减少：

- 页面访问次数
- 评论任务浪费
- 后续业务筛选成本
- 不必要的合规分析

---

# 23. 多类目无缝切换设计

目标：

完成摩托配件后，可以无缝切换到下一个业务类目，例如：

```text
Motorcycle Accessories
↓
完成
↓
下一个类目
↓
继续采集 / 分类 / 分析
```

不重新开发一套系统。

## 23.1 结论

可以实现。

核心是把：

```text
“摩托配件”
```

从代码中的固定逻辑，改成：

```text
category campaign configuration
```

系统核心不绑定具体类目。

## 23.2 新增 Category Profile

建议增加配置：

```text
config/categories/
```

例如：

```text
motorcycle-accessories.json
automotive-exterior.json
tools-equipment.json
interior-accessories.json
```

每个 Category Profile 至少包含：

```json
{
  "category_key": "motorcycle-accessories",
  "display_name": "Motorcycle Accessories",
  "site_country": "DE",
  "language": "en",
  "currency": "EUR",
  "sort_order": "Top Sales",
  "target_count": 3000,
  "exclude_electronics": true,
  "exclude_usb": true,
  "exclude_battery": true,
  "price_min_eur": 5,
  "navigation": {
    "entry_method": "site_menu",
    "breadcrumbs": []
  },
  "taxonomy": "week2-motorcycle-fine-v1"
}
```

## 23.3 数据库必须支持多类目

现有：

```text
catalog_memberships
```

已经天然适合一个商品属于多个类目。

扩展时要求：

```text
category_key
category_profile_version
campaign_id
source_id
```

不得把：

```text
Motorcycle Accessories
```

写死在 `products`。

`products` 仍然只是平台商品身份。

类目关系放在：

```text
catalog_memberships
```

## 23.4 多类目 Campaign

每个类目一轮独立 campaign：

```text
Campaign A
category = motorcycle-accessories
target = 3000

Campaign B
category = next-category
target = 3000
```

Campaign之间：

- 共用 products；
- 共用 goods_id 唯一身份；
- 共用 snapshots；
- 分开 memberships；
- 分开分类 taxonomy；
- 分开 Business Rules；
- 分开 Review Pool；
- 分开 Excel / QA。

## 23.5 同一商品跨类目

如果同一个 `goods_id` 同时出现在：

```text
摩托配件
+
汽车外饰
```

必须：

```text
products 只有一条
```

但：

```text
catalog_memberships 可以有两条
```

分别记录：

- category_key
- source
- rank
- first_seen
- last_seen
- active

这样跨类目不会产生重复商品身份。

## 23.6 影刀无缝切类目流程

影刀不应该写死“摩托配件”。

改为：

```text
GET /api/catalog-rpa/next-campaign
↓
读取 category profile
↓
打开Temu首页
↓
按 profile 导航到目标类目
↓
确认 Germany / English / EUR
↓
Top Sales
↓
开始来源队列
↓
当前类目完成
↓
POST campaign-complete
↓
领取 next campaign
```

如果没有下一个 campaign：

```text
idle
```

## 23.7 类目切换人工关卡

“无缝切换”不是完全无人确认。

每次新类目首次启动时建议保留：

```text
CATEGORY_CONFIRMATION_GATE
```

运营确认：

- 类目名称正确；
- Top Sales正确；
- Germany / English / EUR正确；
- 非电子业务规则正确；
- 商品卡正常显示。

确认一次后，影刀继续自动执行该类目的 source queue。

## 23.8 类目级状态机

```text
pending
opening
waiting_category_confirmation
running
manual_required
qa_pending
completed
failed
cancelled
```

## 23.9 类目级输出目录

建议：

```text
outputs/catalog/
  motorcycle-accessories/
    campaign-xxxx/
  next-category/
    campaign-yyyy/
```

避免不同类目 Excel / QA 混在一起。

## 23.10 类目级分类规则

每个类目必须有自己的 taxonomy。

例如：

```text
week2-motorcycle-fine-v1
week2-auto-exterior-fine-v1
week2-tools-fine-v1
```

不要把摩托配件的分类规则强行复用到新类目。

系统复用的是：

```text
分类框架
```

不是：

```text
分类标签内容
```

## 23.11 类目级业务规则

公共规则可以复用：

```text
exclude electronics
exclude USB
exclude battery
price >= 5 EUR
```

类目特殊规则放在 Category Profile：

```text
business_rules
```

例如某个类目未来允许低于5欧，则单独覆盖。

## 23.12 类目切换后的评论流程

Catalog完成后：

```text
category campaign
↓
business screening
↓
fine classification
↓
reviewability
↓
生成该类目的 review queue
```

评论任务必须带：

```text
category_key
catalog_campaign_id
```

这样以后可以分别回答：

- 摩托配件评论情况；
- 新类目评论情况；
- 两个类目的机会比较。

---

# 24. 多类目扩容后的总体架构

```text
                    Category Campaign Queue

        ┌──────────────────┼──────────────────┐
        │                  │                  │
 Motorcycle          Next Category      Future Category
 Accessories
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                       影刀 RPA
                           │
                      真实 Chrome
                           │
                    Browser Extension
                           │
                      localhost API
                           │
                         Node.js
                           │
             ┌─────────────┼─────────────┐
             │             │             │
          products     memberships    snapshots
             │             │             │
             └─────────────┼─────────────┘
                           │
                       SQLite
                           │
             分类 / 评论 / AI / Excel
```

---

# 25. Catalog Scale V2 新执行顺序

修改后的实际执行路线：

```text
Scale Day 1
Campaign / Source / Category Profile 数据模型
↓
Scale Day 2
Catalog Extension + localhost API
↓
Scale Day 3
影刀 Catalog Queue + 300非电子商品 Smoke
↓
Scale Day 4
摩托配件 Refresh 1000
↓
Scale Day 5
摩托配件 1500
↓
Scale Day 6
摩托配件 2000
↓
Scale Day 7
摩托配件 2500
↓
Scale Day 8
摩托配件 3000非电子唯一商品
↓
Scale Day 9
分类 / Business / Reviewability / Excel / QA
↓
Scale Day 10
创建下一个 Category Profile
↓
新类目 300 Smoke
↓
1000
↓
逐步扩容
```

---

# 26. Codex新增硬性约束：电子排除 + 多类目

后续所有 Catalog Scale Codex Prompt 统一增加：

```md
业务与多类目硬性约束：

1. 当前3000目标只统计非电子商品。
2. 电子 / USB / 电池 / 充电 / 蓝牙 / 无线通信 / 音频电子 / 电子照明 / 明显认证风险商品不得进入正式Catalog Staging。
3. 电子排除商品只进入轻量 exclusion audit，不进入3000目标。
4. 不允许为了凑数量降低电子排除规则。
5. products不得绑定某个固定类目。
6. 一个goods_id全平台只保留一个products身份。
7. 商品可以通过catalog_memberships属于多个类目。
8. 所有新类目必须由Category Profile驱动，不得复制一套代码。
9. 每个类目必须有独立campaign、source、taxonomy、business rule、review queue、QA和输出目录。
10. 完成摩托配件后，系统必须能够通过创建新的Category Profile直接启动下一类目。
11. 新类目第一次真实运行必须经过CATEGORY_CONFIRMATION_GATE。
12. 影刀必须从campaign/category profile读取导航任务，不得把Motorcycle Accessories硬编码。
13. 每轮输出：
    category_key
    campaign_id
    raw_observed_count
    electronic_excluded_count
    non_electronic_unique_count
    business_eligible_count
    reviewable_unique_count
14. 默认3000 Gate：
    non_electronic_unique_count = 3000
15. 如果业务另行要求3000个可抓评论商品，则改为：
    reviewable_unique_count = 3000
```

---

# 27. 最终验收新增项

摩托配件3000验收必须：

```text
non_electronic_unique_count = 3000
electronic products in active target pool = 0
goods_id duplicate = 0
```

并验证：

- 电子排除审计存在；
- 业务筛选正常；
- 分类3000全部有状态；
- Review Pool可生成；
- Product Pool版本化；
- 历史1000未删除。

多类目能力验收必须：

1. 新建一个测试 Category Profile；
2. 不修改 catalog 核心代码；
3. 影刀可以领取新类目 campaign；
4. 新类目导航正确；
5. 新类目300商品 Smoke通过；
6. 与摩托配件相同 goods_id 不产生 duplicate products；
7. memberships 分类目保存；
8. Excel / QA 分目录输出；
9. 新类目可独立暂停/恢复/取消；
10. 摩托配件历史不受影响。
