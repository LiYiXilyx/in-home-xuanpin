# Temu 自动化选品项目：踩坑记录与排障手册

> 适用项目：`LiYiXilyx/in-home-xuanpin`
> 当前主线分支：`refactor/week1-catalog-core`
> 目的：记录 Week 1 从 Day 1 到 Day 7 实际开发、跨电脑运行、Temu 页面、浏览器、图片、Excel、数据库与 Codex 协作中遇到的坑，避免后续重复踩坑。

---

# 1. 最重要的经验

这次项目真正踩坑最多的地方，不是“代码不会写”，而是：

1. 跨电脑开发导致代码版本和运行环境不一致。
2. Temu 对独立 Chrome profile / session / CDP 环境表现不稳定。
3. Temu 类目 URL 带会话参数，容易过期。
4. 普通 Chrome 正常，不代表独立 Chrome 也正常。
5. Node `fetch` 能力和 Chrome 页面内网络能力并不一致。
6. `100 → 300 → 1000` 的阶段门非常必要。
7. Excel 不能当数据库，人工字段要按 `goods_id` 保护。
8. 商品身份不能依赖 URL，必须以 `goods_id` 为核心。
9. 真实运行必须保留 Human-in-the-Loop，不要试图绕过验证码。
10. Codex 每天只能执行一个 Day，必须阶段验收后再继续。

核心原则：

> 数据先可信，再扩量；先跑通闭环，再提高自动化率。

---

# 2. 坑一：跨电脑开发，Git 不同步导致上下文断裂

## 现象

Day 3 在家里电脑完成，Day 4 换到公司电脑继续。

家里 Day 3：图片缓存 `100/100` 成功。
公司 Day 4：900 次图片任务全部 `IMAGE_FETCH_FAILED`。

第一反应容易怀疑 Day 4 代码改坏了，但进一步检查后发现变量不止一个：代码版本可能不同，运行环境也从家里切到了公司。

## 正确做法

跨电脑开发后，Git 必须成为唯一代码同步渠道：

```text
每个 Day 验收通过
↓
commit
↓
push feature branch
↓
另一台电脑 pull
↓
再开始下一 Day
```

应该同步：

```text
src/
test/
db/migrations/
docs/
package.json
package-lock.json
config.example.json
```

不要同步：

```text
data/
config.json
browser-profile/
outputs/
Excel
截图
日志
```

**经验：跨电脑开发必须让 Git 成为唯一代码同步渠道。**

---

# 3. 坑二：把完整 URL 当商品唯一标识

Temu 同一个商品可能有不同语言、地区、标题 slug、query 参数的 URL。如果用完整 URL 当唯一键，会导致重复商品、历史快照错位和评论关联问题。

最终商品身份：

```text
platform + external_product_id(goods_id)
```

例如：

```text
temu + 601099602102774
```

数据库同时保存：

```text
products
- platform
- external_product_id
- canonical_url
- source_url
```

**经验：`goods_id` 是身份，URL 只是属性。**

---

# 4. 坑三：只保存 canonical_url，没有保留真实 source_url

程序曾统一生成：

```text
https://www.temu.com/goods.html?goods_id=<id>
```

但这不应成为唯一可打开地址。

最终设计：

```text
source_url = Temu 当前商品卡真实 href
canonical_url = 稳定兼容地址
```

Excel / 运营打开优先：

```text
source_url
↓ 缺失
canonical_url
```

**经验：稳定身份和可打开地址不是同一件事。**

---

# 5. 坑四：Excel 里有链接，但运营看起来像“没有链接”

原来 Excel 使用：

```text
=HYPERLINK(url,"打开商品")
```

运营只能看到“打开商品”，看不到实际 URL，容易误判成没有链接。

最终修复：

- 直接显示完整 URL；
- 单元格仍可点击；
- 优先 `source_url`，fallback `canonical_url`；
- goods_id 与链接必须一一对应。

**经验：运营表不仅要技术上有链接，还必须肉眼看得懂。**

---

# 6. 坑五：Excel 绝不能当数据库

最终原则：

```text
SQLite = 唯一正式数据源
Excel = 运营视图
```

人工备注保护使用：

```text
goods_id 优先
canonical_url fallback
```

禁止按 Excel 行号匹配，因为排名变化后行号会改变。

实际验收中，在 rank 1、150、300 填写备注，倒序导出再恢复正序，3/3 都保留，0 错配。

**经验：Excel 可以变，商品身份不能变。**

---

# 7. 坑六：直接追求 1000 条，风险太大

如果选择器、身份、数据库结构或 Excel 有问题，直接抓 1000 条只会把错误放大。

正确阶段门：

```text
100 条：字段、goods_id、图片、URL、rank、虚拟列表
↓
300 条：数据库、snapshots、memberships、pause/resume/retry
↓
约 1000 条：正式 Product Pool V1
```

**经验：`100 → 300 → 1000` 不是保守，是防止把错误放大。**

---

# 8. 坑七：虚拟列表导致只抓到当前 DOM 的几十条商品

Temu 使用虚拟列表时，当前 DOM 不等于完整列表。

最终做法：

- 每次从顶部开始；
- 低频滚动；
- 累计首次出现的 `goods_id`；
- 受控点击 `See more`；
- 以 `goods_id` 去重；
- rank 按首次出现顺序，不能按销量重排。

Day 3 实测：DOM 观察 200 次，最终唯一商品 100，数据库重复率 0。

**经验：虚拟列表要累计历史观察结果，不能相信当前 DOM 就是完整列表。**

---

# 9. 坑八：图片在家里成功，公司 Node fetch 全失败

家里 Day 3：图片 `100/100`。
公司 Day 4：900 次全部 `IMAGE_FETCH_FAILED`，但 Chrome 页面图片正常显示。

失败主要是：

- `TimeoutError`
- `EACCES`
- 请求建立阶段就失败

最终下载策略：

```text
1. 已有本地缓存
2. Chrome / CDP 浏览器上下文
3. Node fetch fallback
4. failed
```

Day 4.5 最终：10/10、300/300 成功，第二次运行 300/300 直接复用缓存。

**经验：浏览器能看到 ≠ Node fetch 一定能下。**

---

# 10. 坑九：不要为了架构“纯洁”牺牲图片稳定性

真实 Temu 环境中，Node 下载不稳定，而浏览器上下文稳定。工程目标不是“所有请求都从 Node 发”，而是稳定、合法、可运营。

最终：

```text
缓存
↓
浏览器上下文
↓
Node fallback
```

**经验：工程最终目标是稳定可运营，不是架构洁癖。**

---

# 11. 坑十：独立 Chrome profile 与普通 Chrome 完全不是一个环境

普通 Chrome：Germany / English / EUR，搜索正常，Categories 正常。
独立采集 Chrome：主页可打开、推荐可见，但搜索可能 `No results`，类目可能 `Oops! The items are gone`。

独立 profile 不共享：

- Cookie
- 登录状态
- Local Storage
- Service Worker
- 站点偏好
- 地区上下文
- 实验分组
- 风控状态
- 浏览器扩展
- 某些网络路径

**经验：普通 Chrome 正常，并不能证明独立 profile 正常。**

---

# 12. 坑十一：fresh profile 也不是万能修复

旧 profile 异常时曾怀疑缓存/session 损坏，于是新建 fresh profile。

但 fresh profile 仍可能出现：

```text
SEARCH_NO_RESULTS
NETWORK_ERROR
STALE_CATEGORY_PAGE
```

因此不能简单归因于“旧 profile 坏了”。更可能是 Temu 对独立浏览器环境的会话、地区、搜索接口、风控、Service Worker、网络/CDN 或 remote-debugging 环境差异。

**经验：fresh profile 是诊断手段，不是万能修复。**

---

# 13. 坑十二：带 `_x_sessn_id` 的 Temu 类目 URL 很容易失效

典型 URL 参数：

```text
_x_sessn_id
refer_page_name
refer_page_id
refer_page_sn
```

过一段时间后可能出现：

```text
Oops! The items are gone.
Try again to find items
```

正确处理：

- 不把该页面当成真实零库存；
- 返回 `STALE_CATEGORY_PAGE`；
- `NOT_READY`；
- 不更新 active 商品池；
- 不长期复用会话型完整 URL。

**经验：Temu 类目 URL 不是永久 API。**

---

# 14. 坑十三：首页正常，不代表搜索 / 商品接口正常

独立 Chrome 可能：

- 导航栏正常；
- 搜索框正常；
- 首页推荐商品正常；

但搜索三个普通词依然全部 `No results`。

Temu 页面是多层请求：

```text
HTML / 静态资源
≠
搜索 / 库存 / 推荐 / 地区接口
```

**经验：页面“能打开”不等于页面“可采集”。**

---

# 15. 坑十四：只看德国国旗、English、EUR 还不够

曾出现：页面右上角显示德国国旗、English、EUR，但健康检查：

```text
COUNTRY = UNKNOWN
```

浏览器层还可能是：

```text
navigator.language = zh-CN
timezone = Asia/Shanghai
```

实验又证明语言和时区不是唯一根因。

**经验：不要只通过右上角 UI 判断 Temu 后端地区上下文是否正常。**

---

# 16. 坑十五：不要执着独立 profile，真实可用性更重要

实测长期表现：

```text
普通 Chrome：稳定
独立 Chrome：搜索/类目不稳定
```

最终推荐浏览器模式：

```text
managed_profile
external_cdp
```

### `managed_profile`
系统管理独立 profile，适合 Temu 在该环境正常时。

### `external_cdp`
运营人工准备正常 Chrome：

```text
登录 Temu
↓
Germany / English / EUR
↓
进入目标类目
↓
Top Sales
↓
系统只连接并验证
```

系统不得复制 profile、导出 Cookie、自动登录或强制关闭用户 Chrome。

**经验：隔离是手段，不是目标。真实稳定运行才是目标。**

---

# 17. 坑十六：验证码处理必须 Human-in-the-Loop

正确状态流：

```text
running
↓
paused
↓
人工处理验证码
↓
resume
```

不能自动破解、自动点击验证码、高频刷新或绕过限制。

Day 6 实测完整恢复 300/300。

**经验：验证码不是 bug，是业务流程的一部分。**

---

# 18. 坑十七：任务状态不能只存在 Dashboard 内存里

最终 SQLite 是唯一任务状态源：

```text
crawl_jobs
crawl_job_items
crawl_events
```

支持：

```text
pending
running
paused
interrupted
failed
completed
completed_with_errors
cancelled
```

Day 6 实测：40 条处 paused，关闭 server，重启后仍看到同一 job 和 checkpoint，然后继续完成。

**经验：UI 可以死，任务状态不能死。**

---

# 19. 坑十八：暂停不是 kill 进程

正确方式：

```text
pause_requested = true
↓
下一个安全批次边界
↓
保存 checkpoint
↓
status = paused
```

而不是直接 kill Node 进程。

**经验：暂停是状态转换，不是强杀。**

---

# 20. 坑十九：中断恢复必须幂等

核心唯一键：

```text
products: platform + goods_id
snapshots: job_id + product_id
job_items: job_id + item_key
```

Day 4 实测多次中断和 resume 后：products、memberships、snapshots、job_items 重复数都为 0。

**经验：恢复可以重新扫描，但不能重复写身份和同 job 快照。**

---

# 21. 坑二十：低数量异常不能覆盖当前商品池

已有 active 300，如果网络异常只抓到 5，不能把商品池从 300 替换成 5。

最终保护：

```text
CATALOG_POOL_SAFETY_REJECTED
```

原 active pool 保持不变。

**经验：采集失败不可破坏上一次正确结果。**

---

# 22. 坑二十一：历史商品退出不能直接删除

正确模型：

```text
products = 商品身份
catalog_memberships = 当前类目成员关系
product_snapshots = 历史值
```

商品退出当前池时：

```text
membership.active = 0
```

而不是删除 product 或历史 snapshots。

**经验：“不再在当前池”不等于“商品从未存在”。**

---

# 23. 坑二十二：分类规则边界会误命中

真实 bug：

```text
lamp
```

错误命中：

```text
clamp
```

修复后关键词规则必须有：

- 单词边界；
- token 化；
- 优先级；
- 冲突处理。

**经验：规则分类最危险的是字符串子串误命中。**

---

# 24. 坑二十三：规则分类应该保守，而不是强行全覆盖

Day 7：300 active 中，`其他` 151，`needs_review` 165。

这不等于分类失败，而是说明规则没有强行猜测。

正确逻辑：

```text
可靠关键词 → 高置信度
冲突/无关键词 → needs_review
```

**经验：宁愿“其他 + 待复核”，也不要错误高置信度。**

---

# 25. 坑二十四：1000 条任务不能为了 PASS 伪造

Day 7 页面持续 `NOT_READY / SEARCH_NO_RESULTS`，因此没有启动 1000 条，而是 `PARTIAL PASS`。

没有：

- 复制现有 300 条；
- 伪造来源；
- 填假数据；
- 绕过健康检查。

**经验：阶段验收的价值，就是允许真实 FAIL / PARTIAL PASS。**

---

# 26. 坑二十五：旧代码不能因为“重构完成”就马上删

Day 7 引用扫描仍发现 CLI、旧工具和旧测试引用 `crawler.mjs`、`database.mjs`、`demo.mjs`。

只有同时满足：

```text
新链路全部 PASS
+
旧单体无真实引用
```

才允许删除。

**经验：删除 legacy 的条件是“无引用”，不是“我觉得新代码够好了”。**

---

# 27. 坑二十六：Excel 冻结窗格工具兼容问题

当前 Excel 工具在 Windows 环境中冻结窗格序列化不稳定，因此增加 PowerShell 收尾步骤修改 XLSX XML，写入 freeze pane 和 full calculation。

代价：当前导出流程部分依赖 Windows。

**经验：工具库缺陷可以加兼容层，但必须写入 Release Notes。**

---

# 28. 坑二十七：浏览器问题必须做对照实验

以后独立 Chrome 无商品，不要马上改代码。

对照矩阵：

| 普通 Chrome | fresh 无 CDP | fresh CDP | 判断 |
|---|---|---|---|
| 正常 | 正常 | 异常 | CDP/启动环境 |
| 正常 | 异常 | 异常 | profile/session/Temu环境 |
| 异常 | 异常 | 异常 | 网络/Temu服务/区域 |
| 正常 | 部分正常 | 部分异常 | Temu风控/会话不稳定 |

**经验：一次只改变一个变量。**

---

# 29. 坑二十八：健康检查不能只检测“Temu 页面存在”

真正 READY 至少包括：

```text
CDP_CONNECTED
TEMU_PAGE
LOGIN_STATUS
COUNTRY
LANGUAGE
CURRENCY
PRODUCT_LIST_VISIBLE
CATEGORY_CONFIRMED
TOP_SALES_CONFIRMED
PAGE_HEALTH
```

以下状态全部禁止 capture：

```text
SEARCH_NO_RESULTS
STALE_CATEGORY_PAGE
NETWORK_ERROR
CAPTCHA_OR_LOGIN
WRONG_PAGE
CATEGORY_NOT_CONFIRMED
SORT_NOT_CONFIRMED
```

**经验：“打开了 Temu”不是 Ready。**

---

# 30. 坑二十九：不要让 Codex 一次执行整个项目

最有效方式：

```text
Day N 指令
↓
Codex实现
↓
自动测试
↓
Codex输出报告
↓
人工验收
↓
PASS
↓
Day N+1
```

**经验：Codex 最适合明确边界的小阶段连续执行。**

---

# 31. 坑三十：Word 和 Markdown 同时存在会造成执行规范冲突

最终规定：

```text
docs/TEMU_AUTOMATION_PLAN.md
```

作为唯一 canonical source。

Word 只作为历史参考。

**经验：一个项目只能有一个 canonical execution spec。**

---

# 32. 坑三十一：新电脑没有历史数据库，不需要硬迁移

家里电脑没有旧 DB 时，`legacy_database_missing` 是正常状态。

migration / import 流程可以通过 fixture / integration test 验证，不要制造假历史。

**经验：没有数据就是没有，不要为了流程完整制造假历史。**

---

# 33. 坑三十二：图片历史 failed 记录不用为了“干净”删除

Day 4 遗留 failed 图片记录，Day 4.5 后当前 300 active 商品已经 300/300 有 completed 本地图。

真正指标应是：

```text
active products with usable image
```

而不是要求 `product_images` 全表无 failed。

**经验：历史失败是审计证据，不是垃圾。**

---

# 34. 坑三十三：运营提示必须是人话

开发错误：

```text
ECONNRESET
EACCES
TypeError
Target closed
```

运营提示应转成：

```text
网络连接异常，请检查公司网络或 VPN 后重试。
采集 Chrome 连接已断开，请重新打开后继续。
当前页面未确认 Top Sales，请重新进入正确页面。
```

stack 只写日志。

**经验：运营台不是开发控制台。**

---

# 35. 坑三十四：页面异常时必须保留旧商品池

以下页面都不能更新商品池为空：

```text
No results
Oops! The items are gone
Network error
验证码
错误类目
非 Top Sales
```

正确处理：

```text
NOT_READY
↓
拒绝 capture
↓
保留旧 active pool
```

**经验：错误页面 ≠ 真实零商品。**

---

# 36. 坑三十五：不要高频刷新去“撞”Temu恢复

遇到 `SEARCH_NO_RESULTS / NETWORK_ERROR / CAPTCHA` 时，不要高频刷新、搜索、滚动、换关键词。

正确做法：停止任务、人工判断、必要时换会话、稍后再试。

**经验：风控环境下，“少操作”往往比“多重试”更安全。**

---

# 37. 当前推荐浏览器策略

## 模式 A：External Chrome（建议主模式）

运营人工准备正常 Chrome：

```text
登录 Temu
↓
Germany / English / EUR
↓
目标类目
↓
Top Sales
↓
商品可见
↓
系统只连接和验证
```

系统禁止复制 profile、读取/导出 Cookie、自动登录、强制杀浏览器。

## 模式 B：Managed Profile（备用）

系统创建独立 profile。隔离性好，但实测 Temu 搜索/类目/会话可能不稳定。

推荐：

```text
External Chrome = 主模式
Managed Profile = fallback
```

---

# 38. 当前项目状态

Week 1 已完成：

```text
✅ Day 1 架构 / migration
✅ Day 2 browser / job 状态
✅ Day 3 100 条真实商品
✅ Day 4 300 条 / snapshot / resume
✅ Day 4.5 图片稳定性
✅ Day 5 Excel
✅ Day 6 运营台
✅ Day 6.5 source_url / 页面健康
✅ Day 7 分类 / 文档 / QA
```

仍未完全完成：

```text
❌ 真实约 1000 条 Gate D
```

当前 Week 1 状态：

```text
PARTIAL PASS
```

---

# 39. 以后开发前必看检查清单

## 开发前

- [ ] 当前 Git 分支正确
- [ ] 当前电脑已 pull 最新 feature branch
- [ ] `config.json` 没有进 Git
- [ ] DB / outputs / profile 没进 Git
- [ ] 只执行当前 Day
- [ ] canonical Markdown 是唯一规范

## Temu 采集前

- [ ] Chrome 环境正常
- [ ] Temu 已登录
- [ ] 国家正确
- [ ] 语言正确
- [ ] 币种正确
- [ ] 商品列表真实可见
- [ ] 类目正确
- [ ] Top Sales 明确
- [ ] `PAGE_HEALTH = READY`

## 数据写入前

- [ ] goods_id 非空
- [ ] URL 非空
- [ ] 唯一率正确
- [ ] 质量门通过
- [ ] 数量未异常下降
- [ ] 不是错误页面

## 扩大规模前

```text
100 PASS
↓
300 PASS
↓
1000
```

## 每个 Day 完成后

- [ ] unit tests PASS
- [ ] integration tests PASS
- [ ] npm test PASS
- [ ] npm run check PASS
- [ ] git diff --check PASS
- [ ] 人工真实验收 PASS
- [ ] commit
- [ ] push feature branch
- [ ] 下一台电脑 pull 后再继续

---

# 40. 一句话版本

> 不要把“浏览器打开了”当成 Temu 可采集，不要把“URL 一样”当成商品身份，不要把“测试通过”当成真实环境通过，不要为了 PASS 伪造数据，也不要为了架构漂亮牺牲实际稳定性。

最终系统应做到：

```text
页面真实可用
↓
严格健康检查
↓
低频采集
↓
goods_id 稳定身份
↓
SQLite 持久化
↓
历史快照
↓
错误不破坏旧数据
↓
Excel 只是视图
↓
人工在环
↓
阶段门逐步扩大
```
