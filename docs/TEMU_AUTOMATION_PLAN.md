<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Temu 自动化选品系统</strong></p>
<p><strong>总体落地方案与第 1 周 Codex 开发执行计划</strong></p>
<p>基于《本月工作》与现有 GitHub 仓库静态审查</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **适用仓库** | LiYiXilyx/temu-product-research                          |
|--------------|----------------------------------------------------------|
| **审查基线** | main 分支，提交 a87b5044ba21a7a9fcff83caa7dfffff46d121b6 |
| **方案版本** | V1.0                                                     |
| **编制日期** | 2026-08-20                                               |
| **执行方式** | 按 Day 1—Day 7 分阶段交给 Codex，一天一批，验收后再继续  |

**核心原则：数据先可信，再扩量；先跑通闭环，再提高自动化率。**

# **文档说明**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>本文件的作用</strong></p>
<p>这不是概念性建议，而是一份可以直接作为 Codex 项目执行规范的开发计划。每一天都明确目标、文件、数据库表、字段、测试、验收、回滚和可复制的 Codex 指令。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

本方案以用户提供的《本月工作》为业务基线：第 1 周要求确定类目与字段、抓取约 1000 条商品、写入数据库、导出 Excel、清洗去重并建立初步分类；后续周进入市场分析、评论与痛点、1688 寻源、真实上架和运营交付。

同时对 GitHub 仓库 main 分支进行了静态代码审查。当前仓库已经具备 Node.js 22、Playwright、SQLite、商品池采集、评论断点、失败分类、Excel 图片嵌入和本地运营台等能力，因此方案不采用“全部改写为 Python”的做法，而是保留可用逻辑、拆分单体文件并重建数据模型。

重要边界：本次交付的是 Word 方案文档，没有直接修改、提交或推送 GitHub 代码；现有代码也未在用户的 Windows、VPN、Temu 登录状态和真实页面环境中运行验证。因此 Codex 执行时必须按阶段门逐步实测，不得跳过 100 条与 300 条验证直接跑 1000 条。

## **推荐使用方法**

**1.** 先阅读“执行摘要”和“仓库审查结论”，确认为什么保留 Node.js 技术栈。

**2.** 把“Codex 总控提示词”先交给 Codex，让它理解边界、分支和数据安全规则。

**3.** 每天只复制对应 Day 的指令；当天验收不通过，不进入下一天。

**4.** Codex 每天完成后必须给出：修改文件、命令结果、测试结果、未解决风险和下一步建议。

**5.** 不要让 Codex 自动 push、合并 main、删除本地数据库或浏览器资料目录。

# **目录**

> • 第 1 章　执行摘要与关键决策
>
> • 第 2 章　一个月自动化工作总体计划
>
> • 第 3 章　完整系统蓝图与自动化边界
>
> • 第 4 章　现有 GitHub 仓库审查结论
>
> • 第 5 章　重构后的目标技术架构
>
> • 第 6 章　第 1 周范围、阶段门与验收标准
>
> • 第 7 章　第 1 周数据库设计
>
> • 第 8 章　Temu 商品字段字典与抓取口径
>
> • 第 9—15 章　Day 1—Day 7 逐日开发任务
>
> • 第 16 章　Codex 总控提示词与执行规则
>
> • 第 17 章　风险、回滚与故障处理
>
> • 第 18 章　第 1 周最终交付与第 2 周衔接
>
> • 附录 A　命令、提交信息与验收清单
>
> • 附录 B　旧文件保留、迁移与删除矩阵

# **第 1 章　执行摘要与关键决策**

## **1.1 最终要做的不是爬虫，而是一条可运营的选品流水线**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>Temu 商品池采集</p>
<p>↓</p>
<p>数据清洗、去重、历史快照</p>
<p>↓</p>
<p>第一次规则筛选与初步分类</p>
<p>↓</p>
<p>细分类目机会分析</p>
<p>↓</p>
<p>候选商品评论与差评痛点</p>
<p>↓</p>
<p>1688 半自动寻源与供应商比较</p>
<p>↓</p>
<p>成本、利润、风险与最终评分</p>
<p>↓</p>
<p>人工确认</p>
<p>↓</p>
<p>上架资料生成与真实上架</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

系统的核心不是“能抓多少”，而是数据能否持续积累、重复运行是否不产生脏数据、异常后能否恢复、运营是否能看懂结果，以及最终能否从 Temu 商品连接到 1688 成本与真实上架。

## **1.2 本方案的六个关键决策**

| **决策项**      | **方案**                                                                                                                                          |
|-----------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| **技术栈**      | 第 1 周保留 Node.js 22 + Playwright + SQLite + @oai/artifact-tool。现有仓库已有大量可用代码，切换 Python 会增加重写风险，不能直接提升采集稳定性。 |
| **规模策略**    | 严格采用 100 → 300 → 1000 的阶段门。字段、去重、断点、图片和 Excel 未通过前，不扩大数量。                                                         |
| **数据源**      | SQLite 是唯一正式数据源；Excel 是给运营检查和筛选的视图，不把 Excel 当数据库。                                                                    |
| **抓取方式**    | 优先采用运营人员打开独立 Chrome、人工完成登录/验证码、程序连接当前页面的 Human-in-the-Loop 模式，不绕过平台验证。                                 |
| **第 1 周范围** | 只把商品池基础采集做到可靠，并完成初步规则分类。评论模块保留小规模接口和兼容能力，不对 1000 个商品深抓评论。                                      |
| **重构方式**    | 先建新架构和 v2 数据库，再迁移可用逻辑；旧数据库永不自动删除，旧单体文件只有在新链路验收通过后才移除。                                            |

## **1.3 第 1 周完成后的可见结果**

> ☐ 运营双击启动本地运营台，打开独立采集 Chrome。
>
> ☐ 运营人工进入目标类目并确认 Top Sales，点击一次即可创建商品池采集任务。
>
> ☐ 任务可以暂停、继续、失败重试；程序或电脑异常退出后可从数据库恢复。
>
> ☐ 商品按 Temu goods_id 去重，并保存每次抓取的价格、销量、评分、评论数和排名快照。
>
> ☐ Excel 自动导出，直接显示商品主图、可点击链接、字段完整率、任务记录和初步分类。
>
> ☐ 完成 100 条、300 条和约 1000 条真实商品的阶段验收。
>
> ☐ 运营无需打开 VS Code，也不需要运行 Python 或手工修改数据库。

# **第 2 章　一个月自动化工作总体计划**

原计划按四周推进是合理的，但需要将“自动化比例”与“业务阶段”分开管理。每周只解决一个最关键的不确定性，避免把评论、1688、供应商聊天、利润和上架一次性混在同一个爬虫里。

| **阶段**    | **核心目标**         | **主要工作**                                                        | **阶段输出**                                      |
|-------------|----------------------|---------------------------------------------------------------------|---------------------------------------------------|
| **第 1 周** | 拿到可信商品数据     | Temu 商品池、数据库、Excel、去重、任务恢复、初步分类                | 约 1000 个唯一商品；字段质量报告；运营可独立启动  |
| **第 2 周** | 从大范围找到具体机会 | 细分类、市场统计、第一次评分、候选商品评论、差评痛点、1688 初步寻源 | 2—5 个机会细分类；20—50 个深度商品；3—10 个候选品 |
| **第 3 周** | 确认产品并真实上架   | 供应商联系、MOQ/交期确认、利润复算、图片和文案、真实上架            | 确认 1—3 个产品；至少 1 个商品跑通完整上架        |
| **第 4 周** | 把流程交给运营       | 整合脚本、参数化、可视化、运行说明、运营测试、反馈修正              | 运营不依赖开发独立运行；形成可复用模板和最终版本  |

## **2.1 第 1 周：稳定的数据底座**

> • 先确定字段、数据口径和唯一标识，再写采集。
>
> • 先采 100 条验证字段和页面结构，再采 300 条验证断点、重试和虚拟列表，最后才跑约 1000 条。
>
> • 数据库同时保存商品身份与历史快照，防止每次抓取覆盖旧价格和旧销量。
>
> • 输出 Excel 检查表，但任何人工备注都不能因为重新导出而丢失。

## **2.2 第 2 周：规则筛选、类目机会和评论痛点**

1000 个商品不能全部深抓评论。正确顺序是先用便宜、稳定、可解释的规则筛到 100—300 个，再按类目确定 2—5 个机会方向，每个方向挑 10—30 个商品抓评论。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>约 1000 个商品</p>
<p>↓ 规则筛选、去重、分类</p>
<p>100—300 个有效商品</p>
<p>↓ 类目机会评分</p>
<p>2—5 个细分类目</p>
<p>↓ 评论采集与差评分析</p>
<p>20—50 个深度商品</p>
<p>↓ 综合评分</p>
<p>3—10 个候选产品</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **2.3 第 3 周：1688、利润与上架**

第一版 1688 采用半自动寻源，不直接做自动谈判 Agent。系统负责生成中文关键词、整理搜索结果、计算图片/标题/规格相似度、供应商评分和利润；采购人员负责最终联系供应商并确认真实价格、MOQ、库存、交期、包装与 OEM。

## **2.4 第 4 周：运营交付**

第四周不是继续堆功能，而是把前三周已经验证的能力整合为可操作产品：参数可配置、日志可理解、错误可重试、人工验证有提醒、说明文档完整，并让真实运营人员测试。

# **第 3 章　完整系统蓝图与自动化边界**

## **3.1 七个业务模块**

| **模块**             | **职责**                                                         |
|----------------------|------------------------------------------------------------------|
| **1. Temu 商品采集** | 列表页、商品详情、图片、价格、销量、评分、评论数、排名、抓取时间 |
| **2. 数据治理**      | 标准化、去重、异常值、历史快照、字段质量、分类口径               |
| **3. 第一次筛选**    | 销量、增长、价格、评分、评论、竞争、风险规则                     |
| **4. 评论与痛点**    | 1—3 星评论、主题分类、出现频次、证据回溯、改进机会               |
| **5. 产品评分**      | 市场分、增长分、痛点机会分、供应链和利润潜力                     |
| **6. 1688 寻源**     | 关键词/图片搜索、相似度、供应商、价格、MOQ、交期                 |
| **7. 决策与上架**    | 利润、风险、人工确认、标题卖点、规格、图片要求、上架资料         |

## **3.2 为什么必须 100 → 300 → 1000**

直接抓 1000 条最大的风险不是速度，而是把错误放大：选择器错误会导致 1000 条缺字段；唯一标识错误会制造大量重复；数据库结构错误会让后续评论和历史趋势无法关联；Excel 结构错误会迫使全部重导。

| **阶段**       | **验证重点**                                           | **通过标志**    |
|----------------|--------------------------------------------------------|-----------------|
| **100 条**     | 验证页面、字段、goods_id、去重、数据库、主图和 Excel   | 字段口径冻结    |
| **300 条**     | 验证滚动、See more、任务断点、失败重试、浏览器退出恢复 | 采集稳定性通过  |
| **约 1000 条** | 正式构建商品池、初步分类、输出质量报告                 | Product Pool V1 |

## **3.3 数据库与 Excel 的职责**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>Temu 页面</p>
<p>↓</p>
<p>采集程序</p>
<p>↓</p>
<p>SQLite 数据库（正式数据源）</p>
<p>├─ 商品身份</p>
<p>├─ 类目成员关系</p>
<p>├─ 每次抓取快照</p>
<p>├─ 任务、断点、日志、错误</p>
<p>└─ 数据质量与分类结果</p>
<p>↓</p>
<p>Excel / 运营台（查看、抽查、筛选、人工备注）</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

Excel 不应直接承担历史、去重、状态机和断点。数据库可以持续保存数万商品，Excel 每次只导出本次任务、当前商品池、候选 Top N 或人工需要检查的结果。

## **3.4 第一次筛选与类目机会评分**

第一轮优先使用规则，不先调用大模型。规则便宜、快速、稳定，并且可以解释为什么某商品被淘汰。第一版商品评分可按以下结构设计，权重后续根据实际数据调整：

| **维度**         | **分值** | **说明**                           |
|------------------|----------|------------------------------------|
| **销量潜力**     | 25       | 销量分位数、销量与类目中位数的关系 |
| **增长速度**     | 20       | 多次快照的销量/评价增长            |
| **评分质量**     | 10       | 评分与评论量的组合，不单看高分     |
| **评论结构**     | 10       | 评论量、近期活跃、差评分布         |
| **价格空间**     | 10       | 价格带与采购/物流可行性            |
| **竞争程度**     | 10       | 同类商品数量、头部集中度           |
| **痛点机会**     | 10       | 需求已验证但现有产品问题集中       |
| **供应链可行性** | 5        | 1688 匹配、MOQ、供应商质量         |

类目层面建立 Category Opportunity Score：需求 30%、增长 20%、竞争 20%、价格空间 10%、评论痛点 10%、供应链 10%。系统先找出机会类目，再在类目内选具体商品。

## **3.5 评论自动化的正确位置**

评论采集应放在第一次筛选后。1000 个商品如果每个抓 500 条评论，会产生约 50 万条数据，成本高且没有必要。更合理的是先筛到 100—300 个，再针对 Top 50 或每个机会类目的 10—30 个重点商品抓 100—300 条评论。

AI 真正适合用在评论主题、痛点聚类、证据摘要和改进建议，而不是第一轮商品列表过滤。评论分析必须保存原始评论 ID 和证据链接，不能只存一段不可回溯的 AI 总结。

## **3.6 1688 半自动寻源、匹配与利润**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>Temu 候选商品</p>
<p>↓ AI/规则生成中文关键词</p>
<p>关键词搜索 / 图片搜索</p>
<p>↓</p>
<p>1688 相似商品与供应商</p>
<p>↓</p>
<p>图片、标题、规格、功能相似度</p>
<p>↓</p>
<p>价格、MOQ、经营年限、交易、交期</p>
<p>↓</p>
<p>利润计算与供应商评分</p>
<p>↓</p>
<p>人工联系与最终确认</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

第一版产品匹配可采用：图片 40%、标题 20%、规格 20%、功能 20%。供应商评分可采用：价格 25、MOQ 15、经营年限 10、交易量 10、回头率 10、产品匹配 20、发货能力 10。

利润必须自动计算，但采购价、国内运费、国际物流、平台费、退货损耗和汇率要允许人工修改。系统输出毛利润、毛利率、盈亏平衡售价和敏感性分析。

## **3.7 必须保留的人工关卡**

**1.** 类目确认：系统推荐 5 个细分类，运营选择 2—5 个继续。

**2.** 候选商品确认：系统推荐 20 个，运营选 5—10 个寻源。

**3.** 供应商确认：系统推荐 3—5 家，采购联系 2—3 家。

**4.** 最终上架：AI 生成标题、卖点和资料，运营检查后发布。

## **3.8 这个月暂时不做的内容**

> ☐ AI 自动长期和 1688 供应商聊天、自动议价或自动下单。
>
> ☐ 完全自动采购、付款、Temu 发布和库存同步。
>
> ☐ 复杂 RAG、多智能体、微服务、Kubernetes。
>
> ☐ 绕过验证码、隐藏自动化、代理轮换或提高并发。
>
> ☐ 一开始就做复杂 React 前端；第 1 周保留轻量本地运营台。

# **第 4 章　现有 GitHub 仓库审查结论**

## **4.1 审查基线**

| **项目**     | **结果**                                                |
|--------------|---------------------------------------------------------|
| **仓库**     | https://github.com/LiYiXilyx/temu-product-research.git  |
| **默认分支** | main                                                    |
| **审查提交** | a87b5044ba21a7a9fcff83caa7dfffff46d121b6                |
| **提交时间** | 2026-08-19 01:37:29 UTC                                 |
| **运行时**   | Node.js 22+，ES Modules                                 |
| **主要依赖** | Playwright、@oai/artifact-tool、Node 内置 SQLite        |
| **审查方式** | GitHub 源码静态审查；未在用户 Windows/Temu 实际环境运行 |

## **4.2 已有代码值得保留的能力**

> ☐ 连接独立 Google Chrome 的 CDP 模式，避免复制日常浏览器资料目录。
>
> ☐ 检测登录、验证码和网络异常，暂停让运营人工处理，不绕过验证。
>
> ☐ 当前页面采集模式：运营确认页面后，程序只读取当前页，降低旧链接失效风险。
>
> ☐ 商品 URL 去重、评论 ID 去重、内容指纹和疑似重复标记。
>
> ☐ 评论任务状态、断点、失败分类、批量失败不阻塞整个任务。
>
> ☐ Excel 中嵌入商品图片、保护旧 Excel 的人工字段、处理文件被占用时的另存。
>
> ☐ Node 内置测试覆盖解析、数据库去重、商品池刷新和评论队列。
>
> ☐ 本地运营台、实时日志、打开 Excel 和人工继续按钮。

## **4.3 当前结构的主要问题**

| **问题**                   | **影响**                                                                                                                         |
|----------------------------|----------------------------------------------------------------------------------------------------------------------------------|
| **单体文件过大**           | \`src/crawler.mjs\` 约 64 KB、\`src/database.mjs\` 约 24 KB、\`tools/build-report.mjs\` 约 34 KB，修改一个功能容易影响其他流程。 |
| **职责混杂**               | 浏览器启动、页面验证、列表解析、评论、任务状态、分析与持久化混在同一模块。                                                       |
| **数据模型不利于历史分析** | 商品当前值直接写在 products 表，缺少标准化 product_snapshots 和独立类目成员关系。                                                |
| **任务状态不统一**         | 商品池任务、评论任务和运营台内存任务使用不同状态模型，服务重启后运营台内存状态会丢失。                                           |
| **路径与配置硬编码**       | 运营台对数据库、输出目录和 Chrome 路径存在硬编码，换电脑或配置时容易出错。                                                       |
| **第一周范围过宽**         | 当前 README 把商品、评论质量、差评主题和大量 Excel 字段同时放在第一周，容易拖慢 1000 商品基础池。                                |
| **一次性脚本混入生产目录** | import-live、migrate-top-sales、多个 CMD 与生产入口并列，运营和开发边界不清晰。                                                  |
| **缺少真正的迁移体系**     | 目前通过 ensureColumns 动态补列，长期演进难以审计、回滚和复现。                                                                  |

## **4.4 当前文件的保留与重构结论**

| **当前文件**                          | **结论**       | **处理方式**                                                                                  |
|---------------------------------------|----------------|-----------------------------------------------------------------------------------------------|
| **src/parsers.mjs**                   | 保留逻辑，拆分 | 数值、价格、日期、URL 解析有测试价值；拆为 catalog/parser、reviews/parser、shared/normalize。 |
| **src/analysis.mjs**                  | 部分保留       | 电子/USB 与规则分类移入 products/classification；差评主题放到第 2 周 reviews/analysis。       |
| **src/crawler.mjs**                   | 重构后删除     | 拆为 browser、jobs、catalog、reviews、snapshot；新链路通过后删除单体。                        |
| **src/database.mjs**                  | 重构后删除     | 改为 SQL migration + repository；旧 DB 只读迁移。                                             |
| **tools/build-report.mjs**            | 重构后删除     | 保留图片、人工字段保护和 QA 思路，拆为 export service 与多个 sheet builder。                  |
| **src/dashboard-server.mjs**          | 重构后删除     | 拆为 server/router/controller/task service，路径由配置读取，任务状态持久化。                  |
| **src/demo.mjs**                      | 移动           | 移到 scripts/dev 或 test/fixtures，不能写入真实数据库。                                       |
| **tools/import-live-\*.mjs**          | 移出生产路径   | 必要时移到 scripts/dev；没有明确用途则删除。                                                  |
| **tools/migrate-top-sales.mjs**       | 迁移完成后删除 | 属于一次性迁移，不长期保留。                                                                  |
| **根目录 4 个 CMD**                   | 移动/缩减      | 移动到 scripts/windows，仅保留一个运营启动入口和一个开发修复入口。                            |
| **test/\*.test.mjs；README/运营说明** | 保留并重构     | 测试重组为 unit、integration、fixtures；文档更新为 v2 架构、阶段门、命令和故障处理。          |

# **第 5 章　重构后的目标技术架构**

## **5.1 技术栈决定**

| **层**       | **选择**                                    | **理由**                                           |
|--------------|---------------------------------------------|----------------------------------------------------|
| **核心语言** | Node.js 22 + ES Modules                     | 沿用现有代码；第 1 周不引入 TypeScript 构建链      |
| **浏览器**   | Playwright + 运营独立 Chrome/CDP            | 保留人工登录和验证码处理                           |
| **数据库**   | SQLite v2                                   | 新建版本化 schema；第一周足够，后续可迁 PostgreSQL |
| **Excel**    | @oai/artifact-tool                          | 沿用现有图片与格式能力                             |
| **前端**     | 静态 HTML/CSS/JS + 本地 Node HTTP server    | 第 1 周不引入 React                                |
| **测试**     | node:test + HTML fixture + SQLite 集成测试  | 真实 Temu 只做人工 smoke test                      |
| **日志**     | JSONL 文件 + crawl_events 表 + 运营可读文本 | 同时满足开发排查与运营理解                         |
| **未来 AI**  | 独立分析模块或服务                          | 第 2 周开始，不耦合浏览器采集核心                  |

## **5.2 目标目录结构**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>temu-product-research/</p>
<p>├─ package.json</p>
<p>├─ package-lock.json</p>
<p>├─ config.example.json</p>
<p>├─ config.schema.json</p>
<p>├─ README.md</p>
<p>├─ db/</p>
<p>│ └─ migrations/</p>
<p>│ ├─ 001_core.sql</p>
<p>│ ├─ 002_catalog.sql</p>
<p>│ └─ 003_quality_and_classification.sql</p>
<p>├─ src/</p>
<p>│ ├─ cli.mjs</p>
<p>│ ├─ app/</p>
<p>│ │ ├─ create-app.mjs</p>
<p>│ │ └─ commands/</p>
<p>│ ├─ config/</p>
<p>│ │ ├─ defaults.mjs</p>
<p>│ │ ├─ load.mjs</p>
<p>│ │ └─ validate.mjs</p>
<p>│ ├─ browser/</p>
<p>│ │ ├─ chrome-locator.mjs</p>
<p>│ │ ├─ cdp-session.mjs</p>
<p>│ │ ├─ operator-page.mjs</p>
<p>│ │ ├─ challenge-handler.mjs</p>
<p>│ │ └─ manual-gate.mjs</p>
<p>│ ├─ jobs/</p>
<p>│ │ ├─ job-service.mjs</p>
<p>│ │ ├─ job-runner.mjs</p>
<p>│ │ └─ job-control.mjs</p>
<p>│ ├─ modules/</p>
<p>│ │ ├─ catalog/</p>
<p>│ │ │ ├─ capture-current-page.mjs</p>
<p>│ │ │ ├─ listing-validator.mjs</p>
<p>│ │ │ ├─ listing-scroll.mjs</p>
<p>│ │ │ ├─ card-extractor.mjs</p>
<p>│ │ │ └─ product-normalizer.mjs</p>
<p>│ │ ├─ products/</p>
<p>│ │ │ ├─ product-service.mjs</p>
<p>│ │ │ ├─ image-cache.mjs</p>
<p>│ │ │ ├─ quality-checker.mjs</p>
<p>│ │ │ └─ rule-classifier.mjs</p>
<p>│ │ ├─ export/</p>
<p>│ │ │ ├─ export-service.mjs</p>
<p>│ │ │ ├─ workbook.mjs</p>
<p>│ │ │ └─ sheets/</p>
<p>│ │ └─ reviews/ # 第2周主用，第1周仅兼容</p>
<p>│ ├─ db/</p>
<p>│ │ ├─ client.mjs</p>
<p>│ │ ├─ migrate.mjs</p>
<p>│ │ └─ repositories/</p>
<p>│ ├─ server/</p>
<p>│ │ ├─ index.mjs</p>
<p>│ │ ├─ router.mjs</p>
<p>│ │ └─ controllers/</p>
<p>│ └─ shared/</p>
<p>│ ├─ logger.mjs</p>
<p>│ ├─ errors.mjs</p>
<p>│ ├─ ids.mjs</p>
<p>│ ├─ time.mjs</p>
<p>│ └─ safe-fs.mjs</p>
<p>├─ scripts/</p>
<p>│ ├─ backup-local-data.mjs</p>
<p>│ ├─ import-v1-data.mjs</p>
<p>│ ├─ smoke-catalog.mjs</p>
<p>│ ├─ dev/</p>
<p>│ └─ windows/</p>
<p>├─ test/</p>
<p>│ ├─ unit/</p>
<p>│ ├─ integration/</p>
<p>│ └─ fixtures/</p>
<p>├─ ui/</p>
<p>├─ data/ # 不提交</p>
<p>├─ outputs/ # 不提交</p>
<p>└─ browser-profile/ # 不提交</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **5.3 架构原则**

> ☐ 浏览器层只负责会话、当前页和人工关卡，不直接写数据库。
>
> ☐ catalog 模块只返回标准化商品列表，不知道 Excel 和 UI。
>
> ☐ repository 只负责 SQL；业务判断放 service。
>
> ☐ 所有任务状态落库，运营台服务重启后仍能看到和恢复。
>
> ☐ 商品稳定身份与每次抓取快照分离，任何重复采集都保留历史。
>
> ☐ 一次采集先在内存/临时集合完成并通过安全阈值，再事务性更新商品池。
>
> ☐ 原始页面证据、错误截图和 raw_json 只用于追溯，不混入业务字段。
>
> ☐ 评论、1688、AI 和上架是后续模块，不能反向污染第一周核心。

## **5.4 建议的统一命令**

| **命令**                            | **用途**                                 |
|-------------------------------------|------------------------------------------|
| **npm run init**                    | 创建 config.json，不覆盖已存在文件       |
| **npm run backup**                  | 备份旧数据库和关键配置，不复制浏览器会话 |
| **npm run migrate**                 | 创建/升级 v2 数据库，重复执行安全        |
| **npm run dashboard**               | 启动本地运营台                           |
| **npm run capture -- --target 100** | 采集运营当前 Temu Top Sales 页面         |
| **npm run resume -- --job \<id\>**  | 恢复暂停/中断任务                        |
| **npm run retry -- --job \<id\>**   | 重试失败任务项                           |
| **npm run export -- --job \<id\>**  | 导出本次或当前商品池 Excel               |
| **npm run status**                  | 查看任务、商品和数据质量概览             |
| **npm run test:unit**               | 单元测试                                 |
| **npm run test:integration**        | SQLite、迁移、去重与导出集成测试         |
| **npm run check**                   | 语法、配置、迁移和测试总检查             |

# **第 6 章　第 1 周范围、阶段门与验收标准**

## **6.1 第 1 周必须完成**

> ☐ 新 v2 架构和版本化数据库迁移。
>
> ☐ 运营独立 Chrome、当前页校验和人工登录/验证码关卡。
>
> ☐ Top Sales 商品列表滚动/加载、标准化字段和 goods_id 去重。
>
> ☐ 任务、任务项、日志、错误、暂停、继续、失败重试和断点。
>
> ☐ 商品身份、类目成员关系、历史快照、图片缓存和数据质量。
>
> ☐ Excel 自动导出并直接显示图片、链接、质量与初步分类。
>
> ☐ 100、300、约 1000 三个真实阶段验收。
>
> ☐ 更新 README、运行手册、字段字典和验收记录。

## **6.2 第 1 周明确不做**

> ☐ 不对约 1000 个商品逐个打开详情并深抓评论。
>
> ☐ 不接入 OpenAI API，不做大模型分类和差评聚类。
>
> ☐ 不做 1688 自动寻源、供应商聊天、利润最终决策。
>
> ☐ 不做自动 Temu 上架、采购、支付、库存同步。
>
> ☐ 不绕过验证码，不提高并发，不采用隐藏自动化方案。
>
> ☐ 不在第一周迁移到 PostgreSQL、TypeScript、React 或微服务。

## **6.3 阶段门**

| **阶段门**             | **必须通过**                                    | **下一步**        |
|------------------------|-------------------------------------------------|-------------------|
| **Gate A：本地离线**   | 迁移、解析、去重、导出测试全部通过              | 可进入真实 100 条 |
| **Gate B：100 条**     | 字段、图片、链接、排名、数据库与 Excel 抽查通过 | 可进入 300 条     |
| **Gate C：300 条**     | 暂停/继续、进程关闭、重复运行、失败重试通过     | 可进入约 1000 条  |
| **Gate D：约 1000 条** | 唯一商品池、质量报告、初步分类和运营流程通过    | 第 1 周完成       |

## **6.4 最终数据质量阈值**

| **指标**                             | **阈值/要求**                                                                 |
|--------------------------------------|-------------------------------------------------------------------------------|
| **唯一商品数**                       | 目标约 1000；若平台当前可加载不足，必须记录真实可用数量和原因，禁止填充假数据 |
| **goods_id / canonical_url**         | 100%                                                                          |
| **类目、站点、币种、排序、抓取时间** | 100%                                                                          |
| **标题、价格、主图**                 | 目标 ≥95%                                                                     |
| **列表排名**                         | 来自明确 Top Sales 的商品为 100%                                              |
| **销量、评分、评论数**               | 目标 ≥90%；页面未展示时必须为 null，不得填 0                                  |
| **重复率**                           | 按 platform + external_product_id 去重后为 0                                  |
| **图片嵌入 Excel**                   | 抽查不少于 30 个，成功率 ≥95%                                                 |
| **恢复测试**                         | 进程关闭后恢复不重复写入；失败项可单独重试                                    |
| **错误留痕**                         | 验证码、网络、排序错误、类目错误、选择器错误全部有代码、日志和证据            |

## **6.5 每日摘要**

| **日期**  | **核心结果**                                               |
|-----------|------------------------------------------------------------|
| **Day 1** | 建立安全基线、v2 目录、配置、迁移和新数据库                |
| **Day 2** | 拆分浏览器会话与持久化任务状态                             |
| **Day 3** | 完成当前页商品采集与 100 条验收                            |
| **Day 4** | 完成快照、类目成员关系、去重与 300 条稳定性验收            |
| **Day 5** | 完成 Excel 图片、链接、质量和字段说明                      |
| **Day 6** | 完成暂停/继续/失败重试、运营台和异常恢复                   |
| **Day 7** | 跑约 1000 条、初步分类、清理旧代码并形成 release candidate |

# **第 7 章　第 1 周数据库设计**

## **7.1 数据迁移原则**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止破坏旧数据</strong></p>
<p>Codex 不得在原 `data/temu_week1.db` 上直接做不可逆结构修改，也不得删除任何本地 `.db`、`outputs` 或 `browser-profile`。第一周新建 `data/temu_research_v2.db`，旧库只读导入；v2 验收通过后再切换配置。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**1.** 先运行 backup 脚本，复制旧数据库为带时间戳的备份。

**2.** 通过 db/migrations/\*.sql 创建 v2；schema_migrations 记录版本、校验和与时间。

**3.** scripts/import-v1-data.mjs 从旧表读取并映射到新表，重复运行必须幂等。

**4.** 导入后生成计数、缺失字段和无法映射记录；不静默丢弃。

**5.** 新链路完全通过后，config.json 才切换 v2 路径；旧库继续保留至少一个月。

## **7.2 核心关系**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>crawl_jobs 1 ─── N crawl_job_items</p>
<p>│ │</p>
<p>├─── N crawl_events └── 0..1 products</p>
<p>├─── N scrape_errors │</p>
<p>└─── N data_quality_checks ├── N catalog_memberships</p>
<p>├── N product_snapshots</p>
<p>├── N product_images</p>
<p>└── N product_classifications</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

### **7.3.1 表：schema_migrations**

| **字段**       | **类型/约束** | **说明**                           |
|----------------|---------------|------------------------------------|
| **version**    | TEXT PK       | 迁移版本，例如 001_core            |
| **name**       | TEXT NOT NULL | 迁移说明                           |
| **checksum**   | TEXT NOT NULL | SQL 文件哈希，防止已应用迁移被修改 |
| **applied_at** | TEXT NOT NULL | ISO 时间                           |

### **7.3.2 表：crawl_jobs**

| **字段**                                           | **类型/约束** | **说明**                                                                |
|----------------------------------------------------|---------------|-------------------------------------------------------------------------|
| **id**                                             | TEXT PK       | crypto.randomUUID() 生成的任务 ID                                       |
| **job_type**                                       | TEXT          | catalog / product_detail / reviews / export                             |
| **mode**                                           | TEXT          | operator_current_page / automated_url                                   |
| **site_country**                                   | TEXT          | 德国等站点国家                                                          |
| **language**                                       | TEXT          | 页面语言                                                                |
| **currency**                                       | TEXT          | EUR 等币种                                                              |
| **primary_category**                               | TEXT          | 一级类目                                                                |
| **subcategory**                                    | TEXT          | 子类目                                                                  |
| **source_url**                                     | TEXT          | 任务起始页面                                                            |
| **sort_order**                                     | TEXT          | Top Sales 等                                                            |
| **target_count**                                   | INTEGER       | 目标商品数量                                                            |
| **status**                                         | TEXT          | pending/running/paused/completed/completed_with_errors/failed/cancelled |
| **pause_requested**                                | INTEGER       | 运营请求暂停                                                            |
| **cancel_requested**                               | INTEGER       | 运营请求取消                                                            |
| **checkpoint_json**                                | TEXT          | 滚动轮次、已发现 goods_id、当前页等恢复信息                             |
| **config_json**                                    | TEXT          | 任务启动时的配置快照                                                    |
| **total_items**                                    | INTEGER       | 发现任务项数                                                            |
| **processed_items**                                | INTEGER       | 已处理数                                                                |
| **success_items**                                  | INTEGER       | 成功数                                                                  |
| **failed_items**                                   | INTEGER       | 失败数                                                                  |
| **requested_at/started_at/updated_at/finished_at** | TEXT          | 任务时间线                                                              |
| **last_error_code/message**                        | TEXT          | 最后错误摘要                                                            |

### **7.3.3 表：crawl_job_items**

| **字段**                     | **类型/约束**     | **说明**                                 |
|------------------------------|-------------------|------------------------------------------|
| **id**                       | INTEGER PK        | 自增                                     |
| **job_id**                   | TEXT FK           | 所属任务                                 |
| **sequence_no**              | INTEGER           | 列表顺序                                 |
| **item_key**                 | TEXT              | goods_id 或其他稳定键                    |
| **product_id**               | INTEGER FK NULL   | 成功关联的商品                           |
| **product_url**              | TEXT              | 标准化链接                               |
| **status**                   | TEXT              | pending/running/completed/failed/skipped |
| **attempt_count**            | INTEGER           | 重试次数                                 |
| **checkpoint_json**          | TEXT              | 单项断点                                 |
| **started_at/finished_at**   | TEXT              | 处理时间                                 |
| **error_code/error_message** | TEXT              | 失败原因                                 |
| **UNIQUE**                   | (job_id,item_key) | 同一任务中不重复                         |

### **7.3.4 表：crawl_events**

| **字段**         | **类型/约束** | **说明**                                     |
|------------------|---------------|----------------------------------------------|
| **id**           | INTEGER PK    | 自增                                         |
| **job_id**       | TEXT FK       | 所属任务                                     |
| **level**        | TEXT          | debug/info/warn/error/success                |
| **event_type**   | TEXT          | job_started、captcha_waiting、batch_saved 等 |
| **message**      | TEXT          | 运营可读信息                                 |
| **payload_json** | TEXT          | 开发排查所需结构化上下文                     |
| **created_at**   | TEXT          | ISO 时间                                     |

### **7.3.5 表：products**

| **字段**                | **类型/约束**                  | **说明**                          |
|-------------------------|--------------------------------|-----------------------------------|
| **id**                  | INTEGER PK                     | 内部商品 ID                       |
| **platform**            | TEXT                           | 固定 temu                         |
| **external_product_id** | TEXT                           | Temu goods_id，稳定唯一键         |
| **canonical_url**       | TEXT                           | 去除追踪参数后的链接              |
| **title**               | TEXT                           | 最新可用标题，历史标题在 snapshot |
| **status**              | TEXT                           | active/inactive/gone/unknown      |
| **first_seen_at**       | TEXT                           | 第一次发现                        |
| **last_seen_at**        | TEXT                           | 最近发现                          |
| **raw_identity_json**   | TEXT                           | 用于追溯身份解析                  |
| **UNIQUE**              | (platform,external_product_id) | 跨任务去重                        |

### **7.3.6 表：catalog_memberships**

| **字段**                           | **类型/约束**               | **说明**             |
|------------------------------------|-----------------------------|----------------------|
| **id**                             | INTEGER PK                  | 自增                 |
| **product_id**                     | INTEGER FK                  | 商品                 |
| **site_country/language/currency** | TEXT                        | 站点上下文           |
| **primary_category/subcategory**   | TEXT                        | 类目                 |
| **source_page_url**                | TEXT                        | 来源列表页           |
| **sort_order**                     | TEXT                        | Top Sales 等         |
| **current_rank**                   | INTEGER                     | 当前排名             |
| **active**                         | INTEGER                     | 当前是否在商品池     |
| **first_seen_at/last_seen_at**     | TEXT                        | 成员关系时间         |
| **last_job_id**                    | TEXT FK                     | 最近刷新任务         |
| **UNIQUE**                         | (product_id,站点,类目,排序) | 同商品可属于多个类目 |

### **7.3.7 表：product_snapshots**

| **字段**                               | **类型/约束**       | **说明**                   |
|----------------------------------------|---------------------|----------------------------|
| **id**                                 | INTEGER PK          | 自增                       |
| **product_id**                         | INTEGER FK          | 商品                       |
| **job_id**                             | TEXT FK             | 产生快照的任务             |
| **captured_at**                        | TEXT                | 抓取时间                   |
| **listing_rank**                       | INTEGER             | 当次列表排名               |
| **price_amount/original_price_amount** | REAL                | 售价与原价                 |
| **discount_percent**                   | REAL                | 派生折扣率                 |
| **sales_count**                        | INTEGER NULL        | 页面展示销量；缺失为 null  |
| **rating**                             | REAL NULL           | 1—5                        |
| **review_count**                       | INTEGER NULL        | 平台展示评论数             |
| **shop_name**                          | TEXT NULL           | 可获得时保存               |
| **image_url**                          | TEXT                | 主图 URL                   |
| **availability**                       | TEXT                | available/sold_out/unknown |
| **extraction_quality**                 | TEXT                | complete/partial/suspect   |
| **missing_fields_json**                | TEXT                | 缺失字段数组               |
| **raw_json**                           | TEXT                | 卡片和结构化数据证据       |
| **UNIQUE**                             | (product_id,job_id) | 同任务只写一条快照         |

### **7.3.8 表：product_images**

| **字段**                   | **类型/约束**           | **说明**                         |
|----------------------------|-------------------------|----------------------------------|
| **id**                     | INTEGER PK              | 自增                             |
| **product_id**             | INTEGER FK              | 商品                             |
| **source_url**             | TEXT                    | 图片源地址                       |
| **local_path**             | TEXT                    | outputs/image-cache 下的相对路径 |
| **content_sha256**         | TEXT                    | 图片去重和完整性                 |
| **mime_type/width/height** | TEXT/INTEGER            | 图片信息                         |
| **download_status**        | TEXT                    | pending/completed/failed         |
| **downloaded_at**          | TEXT                    | 下载时间                         |
| **last_error**             | TEXT                    | 失败原因                         |
| **UNIQUE**                 | (product_id,source_url) | 避免重复缓存                     |

### **7.3.9 表：scrape_errors**

| **字段**                          | **类型/约束** | **说明**                                   |
|-----------------------------------|---------------|--------------------------------------------|
| **id**                            | INTEGER PK    | 自增                                       |
| **job_id/job_item_id/product_id** | FK NULL       | 错误关联                                   |
| **stage**                         | TEXT          | browser/listing/parse/persist/image/export |
| **code**                          | TEXT          | 稳定错误代码                               |
| **retriable**                     | INTEGER       | 是否允许自动/人工重试                      |
| **message/stack**                 | TEXT          | 运营摘要和开发堆栈                         |
| **page_url**                      | TEXT          | 错误页面                                   |
| **screenshot_path/html_path**     | TEXT          | 证据文件                                   |
| **occurred_at/resolved_at**       | TEXT          | 错误时间                                   |

### **7.3.10 表：data_quality_checks**

| **字段**            | **类型/约束** | **说明**              |
|---------------------|---------------|-----------------------|
| **id**              | INTEGER PK    | 自增                  |
| **job_id**          | TEXT FK       | 所属任务              |
| **metric_name**     | TEXT          | title_completeness 等 |
| **actual_value**    | REAL          | 实际值                |
| **threshold_value** | REAL          | 阈值                  |
| **unit**            | TEXT          | count/ratio/percent   |
| **passed**          | INTEGER       | 是否通过              |
| **sample_json**     | TEXT          | 抽样 goods_id 与问题  |
| **checked_at**      | TEXT          | 检查时间              |

### **7.3.11 表：product_classifications**

| **字段**                 | **类型/约束**              | **说明**           |
|--------------------------|----------------------------|--------------------|
| **id**                   | INTEGER PK                 | 自增               |
| **product_id**           | INTEGER FK                 | 商品               |
| **job_id**               | TEXT FK                    | 分类任务/采集任务  |
| **level1/level2/level3** | TEXT                       | 大类、子类、细分类 |
| **method**               | TEXT                       | rule/manual/ai     |
| **rule_version**         | TEXT                       | 规则版本           |
| **confidence**           | REAL                       | 0—1                |
| **needs_review**         | INTEGER                    | 低置信度需人工复核 |
| **reasons_json**         | TEXT                       | 命中关键词和解释   |
| **classified_at**        | TEXT                       | 分类时间           |
| **UNIQUE**               | (product_id,job_id,method) | 同方法同任务唯一   |

## **7.4 必要索引与视图**

> ☐ products(platform, external_product_id) 唯一索引。
>
> ☐ catalog_memberships(site_country, primary_category, subcategory, active, current_rank)。
>
> ☐ product_snapshots(product_id, captured_at DESC) 与 product_snapshots(job_id)。
>
> ☐ crawl_jobs(status, requested_at DESC) 与 crawl_job_items(job_id, status, sequence_no)。
>
> ☐ scrape_errors(job_id, code, occurred_at DESC)。
>
> ☐ 创建 v_current_products 视图，连接商品、当前有效类目成员和最近快照，供 UI 与 Excel 使用。

# **第 8 章　Temu 商品字段字典与抓取口径**

## **8.1 字段分级**

字段必须分成 MUST、SHOULD、OPTIONAL，避免页面没有展示某字段时把整个任务判为失败。所有数值缺失使用 null，禁止用 0 假装真实值。

| **级别**     | **字段**                       | **口径**                                | **来源**        |
|--------------|--------------------------------|-----------------------------------------|-----------------|
| **MUST**     | platform                       | 固定 temu                               | 系统            |
| **MUST**     | external_product_id            | 从 goods_id 或 -g-\<id\>.html 提取      | URL             |
| **MUST**     | canonical_url                  | 去掉 refer、search_key 等跟踪参数       | URL             |
| **MUST**     | site_country/language/currency | 任务配置与页面确认                      | 配置/页面       |
| **MUST**     | primary_category/subcategory   | 运营配置和页面验证                      | 配置/页面       |
| **MUST**     | sort_order                     | 必须明确为 Top Sales 或配置值           | 页面            |
| **MUST**     | listing_rank                   | 本次发现顺序，从 1 开始                 | 列表            |
| **MUST**     | title                          | 链接文本、图片 alt、aria-label 多级兜底 | 列表/详情       |
| **MUST**     | image_url                      | 商品卡主图，排除图标和小图              | 列表            |
| **MUST**     | price_amount                   | 仅解析明确 EUR/€ 价格                   | 列表/结构化数据 |
| **MUST**     | captured_at/job_id             | 系统写入                                | 系统            |
| **SHOULD**   | original_price_amount          | 划线原价存在时保存                      | 列表            |
| **SHOULD**   | discount_percent               | (原价-售价)/原价                        | 派生            |
| **SHOULD**   | sales_count                    | K/M 转整数；未展示为 null               | 列表            |
| **SHOULD**   | rating                         | 1—5，优先结构化数据                     | 列表/详情       |
| **SHOULD**   | review_count                   | 评论/评分数量，K/M 转整数               | 列表/详情       |
| **SHOULD**   | availability                   | available/sold_out/unknown              | 页面            |
| **OPTIONAL** | shop_name/shop_url             | 页面稳定可获得时保存                    | 详情            |
| **OPTIONAL** | badge_text                     | best seller、local warehouse 等原始标签 | 列表            |
| **OPTIONAL** | raw_card_text/raw_json         | 仅用于追溯与解析修复                    | 页面            |
| **QUALITY**  | extraction_quality             | complete/partial/suspect                | 质量规则        |
| **QUALITY**  | missing_fields_json            | 缺失字段列表                            | 质量规则        |
| **CLASSIFY** | level1/level2/level3           | 规则初步分类                            | 标题关键词      |
| **CLASSIFY** | confidence/needs_review        | 低置信度进入人工复核                    | 规则            |

## **8.2 提取优先级**

**1.** 优先读取页面公开可见的结构化数据（例如 JSON-LD），但必须保存页面证据。

**2.** 结构化数据缺失时使用商品卡 DOM、可见文本、图片 alt 和 aria-label 兜底。

**3.** 同一字段出现多个候选值时，按来源可信度和页面区域选择，并记录 source。

**4.** 解析失败时保留 raw_card_text、截图和缺失字段，不猜测值。

**5.** 不得依赖未授权的私有接口、绕过验证码或通过高并发探测隐藏接口。

## **8.3 标准化规则**

| **对象**        | **规则**                                                        |
|-----------------|-----------------------------------------------------------------|
| **URL**         | 优先 goods_id；保留标准域名和商品路径，移除跟踪参数与 hash。    |
| **销量/评论数** | 1.2K→1200；1,234 与 1.234 根据上下文判断千位；无法确定则 null。 |
| **价格**        | 只接受明确 € / EUR；保留两位小数；原价和售价分开。              |
| **评分**        | 范围 1—5；超范围或只有星图没有数值则 null。                     |
| **标题**        | 合并空白、去掉“Open in new tab”等 UI 文本，不擅自翻译。         |
| **图片**        | 优先最大商品主图；缓存后校验 MIME、文件头和最小尺寸。           |
| **排名**        | 按当次列表去重后的首次出现顺序，不能按销量重新排序。            |
| **缺失值**      | 数据库 null；Excel 显示空白或“未展示”，不写 0。                 |

# **第 9 章　Day 1：建立安全基线、目录骨架与 v2 数据库**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天目标</strong></p>
<p>不改变当前抓取行为，先把项目变成可安全重构、可迁移、可回滚的状态。当天结束时，新数据库可以重复迁移，旧数据有备份，测试仍然通过。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **9.1 前置条件与边界**

> ☐ 只在新分支 \`refactor/week1-catalog-core\` 工作；不要直接改 main。
>
> ☐ 先检查 git status；不要混入用户本地未提交的其他改动。
>
> ☐ 不 push、不创建 PR、不合并，除非用户另行明确授权。
>
> ☐ 不删除 data、outputs、browser-profile、config.json 和任何真实登录资料。
>
> ☐ 当天验收不通过立即停止，不自动继续下一天。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天特别注意</strong></p>
<p>仓库当前只有一个初始提交。Codex 很容易为了“干净”直接删除旧代码；必须先保留行为基线、建立新 DB，再逐步替换。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **9.2 文件清单**

| **动作** | **文件/目录**                                    | **目的**                                                              |
|----------|--------------------------------------------------|-----------------------------------------------------------------------|
| **新建** | docs/ARCHITECTURE.md                             | 记录目标架构、模块边界和第一周非目标                                  |
| **新建** | docs/WEEK1_EXECUTION.md                          | 记录 Day 1—Day 7 阶段门与验收                                         |
| **新建** | config.schema.json                               | 配置字段、类型、枚举与编辑器提示                                      |
| **新建** | src/config/defaults.mjs                          | 集中默认值                                                            |
| **新建** | src/config/load.mjs                              | 路径解析与读取                                                        |
| **新建** | src/config/validate.mjs                          | 明确错误信息和边界检查                                                |
| **新建** | src/shared/logger.mjs                            | JSONL + 控制台双输出                                                  |
| **新建** | src/shared/errors.mjs                            | 稳定错误码与 retriable 属性                                           |
| **新建** | src/shared/ids.mjs                               | UUID 与任务 ID                                                        |
| **新建** | src/db/client.mjs                                | SQLite 打开、事务和安全 PRAGMA                                        |
| **新建** | src/db/migrate.mjs                               | 按版本执行 SQL 迁移                                                   |
| **新建** | db/migrations/001_core.sql                       | schema_migrations、crawl_jobs、crawl_events                           |
| **新建** | db/migrations/002_catalog.sql                    | products、catalog_memberships、product_snapshots、product_images      |
| **新建** | db/migrations/003_quality_and_classification.sql | scrape_errors、quality、classification                                |
| **新建** | scripts/backup-local-data.mjs                    | 只读复制旧 DB 与配置                                                  |
| **新建** | scripts/import-v1-data.mjs                       | 旧库到 v2 的幂等导入                                                  |
| **新建** | test/integration/migrations.test.mjs             | 空库、重复迁移、校验和测试                                            |
| **新建** | test/unit/config.test.mjs                        | 配置缺失、非法值和路径测试                                            |
| **修改** | package.json                                     | 增加 backup、migrate、status、test:unit、test:integration、check 脚本 |
| **修改** | .gitignore                                       | 确认忽略 config.json、data、outputs、browser-profile、日志和截图      |
| **修改** | config.example.json                              | 区分 app、browser、catalog、export、reviews 配置                      |
| **修改** | README.md                                        | 增加 v2 安全迁移说明和阶段门                                          |

## **9.3 开发任务**

**1.** 检查仓库状态、默认分支和当前提交；创建 \`refactor/week1-catalog-core\`，不要提交用户无关文件。

**2.** 生成 package-lock.json 并固定当前可用依赖，不盲目升级 Playwright 或 artifact-tool。

**3.** 实现 backup 脚本：目标文件存在时自动加时间戳；默认备份 DB 和 config，但绝不复制 browser-profile。

**4.** 实现 migration runner：按文件名排序、事务执行、记录 checksum；已应用迁移被修改时必须报错。

**5.** 新建 \`data/temu_research_v2.db\`，旧 \`temu_week1.db\` 只读。

**6.** 实现 import-v1：products 映射为 products + catalog_memberships + product_snapshots；评论数据先保留在旧库，不在 Day 1 强制迁移。

**7.** 把配置默认值从单个 config.mjs 拆出，错误信息必须包含完整字段路径。

**8.** 实现 logger：控制台输出运营友好中文，文件输出结构化 JSONL；日志中不打印 Cookie、登录令牌或完整配置秘密。

**9.** 保留当前 src/cli.mjs、crawler.mjs 等行为，不在 Day 1 删除任何旧生产文件。

**10.** 运行所有原有测试和新增迁移测试，记录基线结果。

## **9.4 数据库变化**

> ☐ 创建 schema_migrations、crawl_jobs、crawl_events。
>
> ☐ 创建 products、catalog_memberships、product_snapshots、product_images。
>
> ☐ 创建 scrape_errors、data_quality_checks、product_classifications。
>
> ☐ 创建必要索引和 v_current_products 视图。
>
> ☐ 旧数据库仅备份和只读导入，不执行 DROP/ALTER。

## **9.5 测试与验证命令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>npm install</p>
<p>npm run backup -- --config config.json</p>
<p>npm run migrate -- --config config.json</p>
<p>npm run migrate -- --config config.json # 第二次必须无副作用</p>
<p>npm run test:unit</p>
<p>npm run test:integration</p>
<p>npm test</p>
<p>npm run check</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **9.6 当天交付物**

> ☐ v2 目录骨架和三份 SQL migration。
>
> ☐ 新数据库 \`data/temu_research_v2.db\`。
>
> ☐ 旧数据库备份文件与导入报告。
>
> ☐ 配置 schema、日志和错误码基础设施。
>
> ☐ 迁移与配置测试。

## **9.7 完成定义（Definition of Done）**

> ☐ 重复 migrate 不创建重复表、不重复写 schema_migrations。
>
> ☐ 旧数据库文件哈希在任务前后不变。
>
> ☐ config.json 不在 git status 的待提交列表中。
>
> ☐ 所有原有 node:test 测试仍通过。
>
> ☐ Codex 输出旧数据导入计数、无法映射记录和具体原因。

## **9.8 可直接复制给 Codex 的指令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>你正在重构仓库 LiYiXilyx/temu-product-research。只执行 Day 1，不要继续 Day 2。</p>
<p>目标：建立安全重构基线、目标目录、配置拆分、结构化日志、版本化 SQLite migration 和旧库只读导入。今天不能改变现有 Temu 抓取行为，也不能删除旧生产文件。</p>
<p>硬性约束：</p>
<p>1. 先检查 git status、当前分支和当前提交；创建 refactor/week1-catalog-core。</p>
<p>2. 不 push、不创建 PR、不合并 main。</p>
<p>3. 不删除或改写 data/*.db、outputs、browser-profile、config.json；先做带时间戳备份。</p>
<p>4. 新建 data/temu_research_v2.db，旧 temu_week1.db 只读。</p>
<p>5. migration 必须有 schema_migrations、checksum、事务和幂等测试。</p>
<p>6. 日志不得输出 Cookie、Token、浏览器会话数据。</p>
<p>7. 保留原有 CLI 和采集入口，Day 1 只搭基础设施。</p>
<p>完成本文 Day 1 文件与数据库清单，运行 npm test、npm run check、新增 unit/integration tests。结束时只输出：变更文件、迁移结果、测试命令与结果、旧数据导入计数、未解决风险。不要开始 Day 2。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **第 10 章　Day 2：拆分浏览器会话、人工关卡与持久化任务状态**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天目标</strong></p>
<p>把 Chrome/CDP、当前页面选择、登录/验证码处理和任务状态从 crawler 单体中拆出来。运营台或进程退出后，任务状态仍保存在数据库。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **10.1 前置条件与边界**

> ☐ 只在新分支 \`refactor/week1-catalog-core\` 工作；不要直接改 main。
>
> ☐ 先检查 git status；不要混入用户本地未提交的其他改动。
>
> ☐ 不 push、不创建 PR、不合并，除非用户另行明确授权。
>
> ☐ 不删除 data、outputs、browser-profile、config.json 和任何真实登录资料。
>
> ☐ 当天验收不通过立即停止，不自动继续下一天。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天特别注意</strong></p>
<p>当前运营台用内存变量保存 task，并通过子进程 stdin 继续。重构后人工关卡和任务状态必须落库，否则服务重启仍然无法恢复。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **10.2 文件清单**

| **动作** | **文件/目录**                          | **目的**                                                         |
|----------|----------------------------------------|------------------------------------------------------------------|
| **新建** | src/browser/chrome-locator.mjs         | 查找配置和常见路径下的 Google Chrome                             |
| **新建** | src/browser/cdp-session.mjs            | 打开/连接独立 Chrome，管理关闭行为                               |
| **新建** | src/browser/operator-page.mjs          | 找到当前可见 Temu 页面并校验域名                                 |
| **新建** | src/browser/challenge-handler.mjs      | 检测登录、验证码、网络与访问限制                                 |
| **新建** | src/browser/manual-gate.mjs            | 创建人工确认事件并等待继续                                       |
| **新建** | src/jobs/job-service.mjs               | 创建、开始、暂停、恢复、完成、失败任务                           |
| **新建** | src/jobs/job-runner.mjs                | 统一运行模板和 finally 清理                                      |
| **新建** | src/jobs/job-control.mjs               | 轮询 pause/cancel 和心跳                                         |
| **新建** | src/db/repositories/job-repository.mjs | crawl_jobs、items、events SQL                                    |
| **新建** | src/app/commands/browser-open.mjs      | CLI 打开运营 Chrome                                              |
| **新建** | src/app/commands/status.mjs            | CLI 查看数据库任务状态                                           |
| **新建** | test/unit/challenge-handler.test.mjs   | 文本和 URL 错误分类                                              |
| **新建** | test/integration/job-state.test.mjs    | 任务状态机、恢复和并发锁                                         |
| **修改** | src/cli.mjs                            | 改为薄命令路由，旧命令继续兼容                                   |
| **修改** | src/dashboard-server.mjs               | 暂时调用新 job/browser service，不再自己维护核心状态             |
| **修改** | config.example.json                    | 补充 browser.debugPort、profileDir、manualGateTimeout、heartbeat |

## **10.3 开发任务**

**1.** 把 findInstalledBrowser、openContext、openExistingOperatorContext、findCurrentOperatorTemuPage、handleChallenge 从 crawler.mjs 提取到 browser 模块。

**2.** 统一错误码：CHROME_NOT_FOUND、CDP_UNREACHABLE、NO_TEMU_PAGE、WRONG_PAGE、CAPTCHA_OR_LOGIN、NETWORK_ERROR、ACCESS_RESTRICTED、BROWSER_CLOSED。

**3.** 实现 Job 状态机；非法跳转（例如 completed→running）必须拒绝并测试。

**4.** 每个长循环在批次边界检查 pause_requested/cancel_requested；暂停时写 checkpoint 和事件。

**5.** 服务/CLI 启动时扫描 status=running 且心跳过期的任务，标记为 paused_interrupted 或 paused，不能假装仍在运行。

**6.** 同一时间只允许一个浏览器采集任务；export/status 可并行。

**7.** 人工关卡产生 crawl_events，运营台点击“继续”只解决当前 gate，不能任意写子进程 stdin。

**8.** 关闭会话时只关闭本次 Playwright/CDP 连接，不主动杀掉用户已经打开的独立 Chrome，除非本次明确启动且配置允许。

**9.** 旧 crawler.mjs 通过兼容函数调用新 browser 模块，避免一次改动过大。

## **10.4 数据库变化**

> ☐ crawl_jobs 增加 heartbeat_at、pause_requested、cancel_requested（若 001 已包含则无需新增迁移）。
>
> ☐ crawl_events 持久化人工验证、状态变化和浏览器事件。
>
> ☐ crawl_job_items 在后续列表任务中使用，本日完成 repository 与状态约束。

## **10.5 测试与验证命令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>npm run migrate -- --config config.json</p>
<p>npm run test:unit -- challenge-handler</p>
<p>npm run test:integration -- job-state</p>
<p>npm run status</p>
<p>npm run dashboard</p>
<p>npm test</p>
<p>npm run check</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **10.6 当天交付物**

> ☐ 可复用 browser 模块。
>
> ☐ 数据库持久化任务状态机与事件流。
>
> ☐ CLI browser-open/status 命令。
>
> ☐ 运营台不再把任务状态只保存在内存。

## **10.7 完成定义（Definition of Done）**

> ☐ 关闭 dashboard 后重新启动，仍能看到历史任务和暂停状态。
>
> ☐ 人工验证码事件能显示等待状态并在继续后恢复。
>
> ☐ 同时启动两个 capture 时第二个被明确拒绝。
>
> ☐ 浏览器关闭错误被标记 retriable，并保留任务断点。
>
> ☐ 所有旧测试和新状态机测试通过。

## **10.8 可直接复制给 Codex 的指令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>只执行 Day 2，不要继续 Day 3。</p>
<p>目标：从现有 src/crawler.mjs 和 src/dashboard-server.mjs 中拆出 browser、manual gate 和持久化 job state。保留旧命令兼容，不删除单体文件。</p>
<p>必须实现：</p>
<p>- Chrome 路径查找、CDP 会话、当前可见 Temu 页面选择。</p>
<p>- 登录/验证码/网络/受限/浏览器关闭的稳定错误码。</p>
<p>- crawl_jobs/crawl_events/crawl_job_items repository 与合法状态机。</p>
<p>- pause、resume、cancel、heartbeat 和进程异常后的 interrupted 恢复。</p>
<p>- 同时只允许一个采集任务。</p>
<p>- dashboard 重启后任务状态仍存在。</p>
<p>约束：不绕过验证码；不复制主浏览器资料；不打印会话数据；不 push；不删除旧 crawler/database/dashboard。完成测试后输出文件、状态机图、命令结果和风险，然后停止。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **第 11 章　Day 3：完成 Temu 当前页商品采集与 100 条验收**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天目标</strong></p>
<p>实现独立的 catalog 模块：确认当前页面是目标类目和 Top Sales，低频滚动/加载商品卡，提取标准字段并完成 100 条真实数据阶段验收。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **11.1 前置条件与边界**

> ☐ 只在新分支 \`refactor/week1-catalog-core\` 工作；不要直接改 main。
>
> ☐ 先检查 git status；不要混入用户本地未提交的其他改动。
>
> ☐ 不 push、不创建 PR、不合并，除非用户另行明确授权。
>
> ☐ 不删除 data、outputs、browser-profile、config.json 和任何真实登录资料。
>
> ☐ 当天验收不通过立即停止，不自动继续下一天。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天特别注意</strong></p>
<p>Temu 使用虚拟列表时，直接从页面中部开始会漏掉前面的商品。必须回到顶部并持续累计；不得因为只看到约 40 条就覆盖旧商品池。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **11.2 文件清单**

| **动作** | **文件/目录**                                | **目的**                                                                |
|----------|----------------------------------------------|-------------------------------------------------------------------------|
| **新建** | src/modules/catalog/listing-validator.mjs    | 验证 Temu、类目、站点、币种、Top Sales                                  |
| **新建** | src/modules/catalog/listing-scroll.mjs       | 滚动、See more、虚拟列表累计与断点                                      |
| **新建** | src/modules/catalog/card-extractor.mjs       | 在页面内提取原始卡片数据                                                |
| **新建** | src/modules/catalog/product-normalizer.mjs   | goods_id、URL、价格、销量、评分标准化                                   |
| **新建** | src/modules/catalog/capture-current-page.mjs | 编排验证、滚动、提取和结果返回                                          |
| **新建** | src/modules/products/image-cache.mjs         | 主图缓存与文件校验                                                      |
| **新建** | src/app/commands/catalog-capture.mjs         | 新 capture 命令                                                         |
| **新建** | test/fixtures/catalog/\*.html                | 脱敏 HTML 商品卡 fixture                                                |
| **新建** | test/unit/catalog-parser.test.mjs            | 字段解析与异常样例                                                      |
| **新建** | test/integration/catalog-100.test.mjs        | 模拟 100 条入库前数据契约                                               |
| **修改** | src/parsers.mjs                              | 保留兼容导出，内部转发到新 normalizer                                   |
| **修改** | src/crawler.mjs                              | captureCurrentCatalog 改为调用新 catalog service                        |
| **修改** | config.example.json                          | catalog.targetCount、minSafeCount、maxStaleRounds、maxExpansions、delay |

## **11.3 开发任务**

**1.** 页面验证必须检查：temu.com、存在商品链接、类目证据包含 motorcycle/motocross/powersport、明确 Top Sales。任何一项失败都不更新商品池。

**2.** 滚动前回到顶部，累计虚拟列表中的首次出现商品；以 goods_id 去重，排名按首次出现顺序。

**3.** 支持受控点击 See more，但 maxExpansions 可配置；每轮有随机低频间隔，遇到人工验证立即暂停。

**4.** card extractor 返回 href、title 候选、image 候选、cardText、可见标签；不直接解析业务数值。

**5.** normalizer 负责 canonical URL、goods_id、价格、原价、销量 K/M、评分、评论数、缺失字段和 extraction_quality。

**6.** 主图下载必须校验 HTTP、MIME/文件头、最小字节数；失败不阻塞商品，记录 image error。

**7.** 在真正写库前输出内存结果计数、唯一 goods_id、缺失率和前 5 条样本。

**8.** 用真实运营 Chrome 跑 100 条；抽查排名 1—10、45—55、91—100，确认无虚拟列表漏前段。

**9.** 保存失败截图和 HTML 到 outputs/debug/\<job_id\>，文件名不含敏感信息。

## **11.4 数据库变化**

> ☐ 创建 crawl_job_items，每个 goods_id 一个 item，保存 sequence_no 和状态。
>
> ☐ 本日可以先写 staging/结果对象；正式 products/snapshots 事务提交在 Day 4 完成。
>
> ☐ 图片下载状态写 product_images 或暂存任务结果。

## **11.5 测试与验证命令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>npm run test:unit -- catalog-parser</p>
<p>npm run test:integration -- catalog-100</p>
<p>npm run dashboard</p>
<p>npm run capture -- --target 100 --dry-run</p>
<p>npm run capture -- --target 100</p>
<p>npm run status</p>
<p>npm test</p>
<p>npm run check</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **11.6 当天交付物**

> ☐ 100 条真实 Temu 商品原始采集结果。
>
> ☐ 字段完整率、重复率和抽查记录。
>
> ☐ 商品图片缓存与失败清单。
>
> ☐ HTML fixture 和 parser 单元测试。

## **11.7 完成定义（Definition of Done）**

> ☐ 100 条 goods_id 和 canonical_url 完整率 100%。
>
> ☐ 标题、价格、主图目标 ≥95%。
>
> ☐ 排名顺序与 Top Sales 页面人工抽查一致。
>
> ☐ 重复运行 dry-run 不产生不同的 canonical identity。
>
> ☐ 错误页面不会替换已有商品池。

## **11.8 可直接复制给 Codex 的指令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>只执行 Day 3，不要继续 Day 4。</p>
<p>目标：实现模块化的 Temu 当前页 Top Sales 商品采集，并完成 100 条真实阶段验收。</p>
<p>要求：</p>
<p>1. 运营先打开独立 Chrome，人工确认德国站/英语/EUR、摩托配件类目、Top Sales。</p>
<p>2. 程序只连接当前页面；页面不正确时停止，不能自动猜类目。</p>
<p>3. 从顶部开始低频滚动，累计虚拟列表；以 goods_id 去重，首次出现顺序作为 rank。</p>
<p>4. 抽出 listing-validator、listing-scroll、card-extractor、product-normalizer、image-cache。</p>
<p>5. 字段缺失为 null，禁止把缺失销量/评分写成 0。</p>
<p>6. 保存截图/HTML 证据和数据质量统计。</p>
<p>7. 真实跑 100 条，并记录 1—10、45—55、91—100 人工抽查。</p>
<p>先用 fixture 测试，再做真实 smoke test。不要删除旧 crawler，兼容入口调用新模块。完成后输出 100 条质量报告和所有测试结果，然后停止。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **第 12 章　Day 4：完成商品身份、历史快照、去重与 300 条稳定性验收**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天目标</strong></p>
<p>把 Day 3 的结果以事务方式写入 v2 数据库，保留每次抓取历史，正确处理当前商品池成员、退出商品和重复运行，并用 300 条验证恢复与数据一致性。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **12.1 前置条件与边界**

> ☐ 只在新分支 \`refactor/week1-catalog-core\` 工作；不要直接改 main。
>
> ☐ 先检查 git status；不要混入用户本地未提交的其他改动。
>
> ☐ 不 push、不创建 PR、不合并，除非用户另行明确授权。
>
> ☐ 不删除 data、outputs、browser-profile、config.json 和任何真实登录资料。
>
> ☐ 当天验收不通过立即停止，不自动继续下一天。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天特别注意</strong></p>
<p>当前仓库把“catalog_active”直接放在 products 表中，不适合一个商品属于多个类目。新模型必须把商品身份和类目成员关系分开。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **12.2 文件清单**

| **动作** | **文件/目录**                                 | **目的**                               |
|----------|-----------------------------------------------|----------------------------------------|
| **新建** | src/db/repositories/product-repository.mjs    | 商品稳定身份 upsert                    |
| **新建** | src/db/repositories/catalog-repository.mjs    | 类目成员关系、active、rank             |
| **新建** | src/db/repositories/snapshot-repository.mjs   | 每任务一条商品快照                     |
| **新建** | src/db/repositories/image-repository.mjs      | 图片状态                               |
| **新建** | src/modules/products/product-service.mjs      | 事务写入、当前池替换、安全阈值         |
| **新建** | src/modules/products/quality-checker.mjs      | 完整率、重复率、范围与异常值           |
| **新建** | src/app/commands/catalog-resume.mjs           | 按 job_id 恢复                         |
| **新建** | src/app/commands/catalog-retry.mjs            | 重试失败 item                          |
| **新建** | test/integration/catalog-persistence.test.mjs | 事务、快照、成员关系、幂等             |
| **新建** | test/integration/catalog-resume.test.mjs      | 中断恢复和重复写入                     |
| **修改** | src/modules/catalog/capture-current-page.mjs  | 增加 onBatch、checkpoint、persist 编排 |
| **修改** | src/jobs/job-runner.mjs                       | 批次事务、心跳、恢复 token             |
| **修改** | src/cli.mjs                                   | 增加 resume/retry 命令                 |
| **修改** | README.md                                     | 记录 v2 数据口径                       |

## **12.3 开发任务**

**1.** 稳定身份仅使用 platform + goods_id；URL 或标题改变不能生成新商品。

**2.** 每次任务为每个商品插入 product_snapshots；不得覆盖历史快照。

**3.** catalog_memberships 记录当前类目和 rank；只有整批通过 minSafeCount 与质量门后才将旧成员标 inactive。

**4.** 如果本次采集数少于旧 active 数或低于安全阈值，任务失败/暂停，原当前池不改变。

**5.** 同一 job 重跑只更新 job_item 状态，不重复插入 snapshot；不同 job 则新增历史快照。

**6.** 质量检查包括：唯一 goods_id、URL、标题、价格、图片、rank、数值范围、异常过低/过高、重复图片 URL。

**7.** 实现 checkpoint：当前滚动轮次、已发现 goods_id 哈希、最近数量、最后事件；恢复时允许重新扫描但依靠唯一键避免重复。

**8.** 真实跑 300 条；在中途主动关闭 dashboard/CLI，再启动并恢复；最终计数必须准确。

**9.** 再次执行同一 300 条页面，验证 products 不增加、snapshots 按新 job 增加、当前成员不重复。

## **12.4 数据库变化**

> ☐ 正式使用 products、catalog_memberships、product_snapshots、product_images。
>
> ☐ data_quality_checks 保存每个 job 的完整率和阈值结果。
>
> ☐ crawl_job_items 与 product_id 关联；失败项保留 error code。

## **12.5 测试与验证命令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>npm run test:integration -- catalog-persistence</p>
<p>npm run test:integration -- catalog-resume</p>
<p>npm run capture -- --target 300</p>
<p># 运行中主动关闭进程，然后：</p>
<p>npm run status</p>
<p>npm run resume -- --job &lt;JOB_ID&gt;</p>
<p>npm run retry -- --job &lt;JOB_ID&gt;</p>
<p>npm test &amp;&amp; npm run check</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **12.6 当天交付物**

> ☐ 300 条 v2 商品池。
>
> ☐ 产品身份、成员关系和快照三层数据。
>
> ☐ 中断恢复、重复运行和失败重试报告。
>
> ☐ 数据质量表记录。

## **12.7 完成定义（Definition of Done）**

> ☐ 300 个唯一 goods_id，重复率为 0。
>
> ☐ 中断恢复后 products/snapshots 无重复。
>
> ☐ 第二次新任务产生新的 snapshots，但 products 数量不变。
>
> ☐ 小于安全阈值的失败任务不改变当前 active 商品池。
>
> ☐ 退出当前池的商品只把 membership 设 inactive，不删除历史。

## **12.8 可直接复制给 Codex 的指令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>只执行 Day 4，不要继续 Day 5。</p>
<p>目标：将 Day 3 的 catalog 结果可靠写入 v2 数据库，建立稳定商品身份、类目成员关系和历史快照，并完成 300 条中断恢复测试。</p>
<p>必须做到：</p>
<p>- products 唯一键 platform + goods_id。</p>
<p>- catalog_memberships 独立保存 active/rank/类目。</p>
<p>- product_snapshots 每个 product+job 唯一，不覆盖历史。</p>
<p>- 整批通过安全阈值后才切换 active 商品池；失败不改旧池。</p>
<p>- checkpoint、resume、retry 幂等。</p>
<p>- 质量指标写入 data_quality_checks。</p>
<p>真实 300 条任务中途主动终止一次，再恢复；重复运行验证 products 不增、快照正确。不要删除旧数据库或旧单体文件。完成后输出 SQL 计数、恢复过程、质量指标和测试结果，然后停止。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **第 13 章　Day 5：重构 Excel 导出并完成图片、链接和质量检查表**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天目标</strong></p>
<p>将现有超大 build-report 拆分，生成运营真正需要的商品池检查表。Excel 从 v2 数据库读取，重新导出不丢人工字段，图片和超链接可以直接使用。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **13.1 前置条件与边界**

> ☐ 只在新分支 \`refactor/week1-catalog-core\` 工作；不要直接改 main。
>
> ☐ 先检查 git status；不要混入用户本地未提交的其他改动。
>
> ☐ 不 push、不创建 PR、不合并，除非用户另行明确授权。
>
> ☐ 不删除 data、outputs、browser-profile、config.json 和任何真实登录资料。
>
> ☐ 当天验收不通过立即停止，不自动继续下一天。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天特别注意</strong></p>
<p>Excel 只是视图。任何为了“方便”直接把 Excel 重新导入覆盖数据库的实现都不要做；人工字段按稳定 goods_id 保护。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **13.2 文件清单**

| **动作** | **文件/目录**                                | **目的**                                |
|----------|----------------------------------------------|-----------------------------------------|
| **新建** | src/modules/export/export-service.mjs        | 统一导出入口、文件占用和另存处理        |
| **新建** | src/modules/export/workbook.mjs              | 工作簿创建与公共样式                    |
| **新建** | src/modules/export/sheets/products-sheet.mjs | 商品池主表                              |
| **新建** | src/modules/export/sheets/quality-sheet.mjs  | 完整率、阈值和问题样本                  |
| **新建** | src/modules/export/sheets/jobs-sheet.mjs     | 任务、状态、耗时、失败                  |
| **新建** | src/modules/export/sheets/fields-sheet.mjs   | 字段来源和口径                          |
| **新建** | src/modules/export/manual-values.mjs         | 保护旧 Excel 人工备注                   |
| **新建** | src/app/commands/export.mjs                  | 按 job 或当前池导出                     |
| **新建** | test/integration/export.test.mjs             | 工作表、公式、图片和人工字段            |
| **修改** | tools/build-report.mjs                       | 改为兼容 wrapper，调用新 export service |
| **修改** | src/db/repositories/report-repository.mjs    | 为 Excel 提供只读查询                   |
| **修改** | src/dashboard-server.mjs                     | 导出按钮调用新命令                      |
| **修改** | package.json                                 | export、export:qa 脚本                  |

## **13.3 开发任务**

**1.** 商品池工作表列：序号、主图、Top Sales 排名、goods_id、标题、链接、类目、价格、原价、折扣、销量、评分、评论数、状态、抓取时间、字段完整度、初步分类、人工备注。

**2.** 图片直接嵌入单元格，保持行高；链接使用可点击超链接，不显示超长 URL。

**3.** 冻结标题行、启用筛选、设置合理列宽、数值格式和条件格式。

**4.** 质量工作表按 job 展示每个指标 actual、threshold、passed 和问题样本。

**5.** 任务工作表展示任务 ID、开始/结束、状态、数量、成功/失败、错误分类和恢复次数。

**6.** 字段说明工作表明确 MUST/SHOULD、来源、缺失口径和更新时间。

**7.** 重新导出时按 goods_id/canonical_url 读取旧 Excel 的人工备注和人工分类，不能因排序变化错位。

**8.** Excel/WPS 正在占用固定文件时自动另存带时间戳版本；打开按钮选择最新文件。

**9.** export:qa 进行公式错误、工作表存在、图片数量和关键单元格抽查。

## **13.4 数据库变化**

> ☐ 不新增核心表；只增加 report repository 查询。
>
> ☐ 人工字段第一周仍可由旧 Excel 保护；第二阶段可迁 product_annotations。

## **13.5 测试与验证命令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>npm run export -- --job &lt;300_JOB_ID&gt;</p>
<p>npm run export:qa -- --job &lt;300_JOB_ID&gt;</p>
<p>npm run test:integration -- export</p>
<p># 手工打开 Excel，填写 3 条人工备注后重新导出</p>
<p>npm run export -- --job &lt;300_JOB_ID&gt;</p>
<p>npm test</p>
<p>npm run check</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **13.6 当天交付物**

> ☐ 商品池、数据质量、任务记录、字段说明四张工作表。
>
> ☐ Excel 直接显示主图与可点击链接。
>
> ☐ 人工备注保护与文件占用处理。
>
> ☐ export:qa 自动检查报告。

## **13.7 完成定义（Definition of Done）**

> ☐ 30 个抽查商品中图片嵌入成功率 ≥95%。
>
> ☐ 所有商品链接可点击且指向 canonical_url。
>
> ☐ 重新导出后 3 条人工备注仍对应原 goods_id。
>
> ☐ 固定 Excel 被占用时不会失败或覆盖错误文件。
>
> ☐ 质量和任务工作表与数据库计数一致。

## **13.8 可直接复制给 Codex 的指令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>只执行 Day 5，不要继续 Day 6。</p>
<p>目标：把 tools/build-report.mjs 拆成模块化 Excel 导出，从 v2 数据库生成商品池、数据质量、任务记录、字段说明四张工作表。</p>
<p>要求：</p>
<p>- 主图嵌入单元格；标题和链接可直接点击。</p>
<p>- 冻结、筛选、列宽、数字格式和质量条件格式可用。</p>
<p>- 重新导出按 goods_id/canonical_url 保护人工备注，不能按行号匹配。</p>
<p>- Excel/WPS 占用固定文件时自动另存时间戳版本。</p>
<p>- export:qa 检查工作表、关键数据、公式错误、图片数量。</p>
<p>- 旧 tools/build-report.mjs 暂时做 wrapper，不立即删除。</p>
<p>用 Day 4 的 300 条数据库做集成测试，手工写入 3 条备注后重导验证。完成后输出文件、Excel 路径、QA 结果和截图说明，然后停止。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **第 14 章　Day 6：完成暂停、继续、失败重试和运营台重构**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天目标</strong></p>
<p>让运营人员在不打开命令行的情况下控制采集，并验证浏览器关闭、网络异常、验证码、Excel 占用和服务重启后的恢复。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **14.1 前置条件与边界**

> ☐ 只在新分支 \`refactor/week1-catalog-core\` 工作；不要直接改 main。
>
> ☐ 先检查 git status；不要混入用户本地未提交的其他改动。
>
> ☐ 不 push、不创建 PR、不合并，除非用户另行明确授权。
>
> ☐ 不删除 data、outputs、browser-profile、config.json 和任何真实登录资料。
>
> ☐ 当天验收不通过立即停止，不自动继续下一天。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天特别注意</strong></p>
<p>暂停不是 kill 子进程。强制结束事务可能导致状态和数据不一致；必须在批次边界保存 checkpoint 后转 paused。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **14.2 文件清单**

| **动作**      | **文件/目录**                                 | **目的**                                     |
|---------------|-----------------------------------------------|----------------------------------------------|
| **新建**      | src/server/index.mjs                          | 本地服务入口                                 |
| **新建**      | src/server/router.mjs                         | 路由和统一错误响应                           |
| **新建**      | src/server/controllers/browser-controller.mjs | 打开与检查独立 Chrome                        |
| **新建**      | src/server/controllers/job-controller.mjs     | 创建、暂停、继续、取消、重试                 |
| **新建**      | src/server/controllers/export-controller.mjs  | 导出与打开文件                               |
| **新建**      | src/server/status-service.mjs                 | 数据库状态与质量概览                         |
| **新建**      | src/server/static-server.mjs                  | 安全静态文件服务                             |
| **新建**      | test/integration/server-jobs.test.mjs         | API 状态、并发锁、恢复                       |
| **新建**      | docs/RUNBOOK.md                               | 运营使用和异常处理                           |
| **修改**      | ui/index.html                                 | 只保留必要的运营步骤和状态                   |
| **修改**      | ui/app.js                                     | 从数据库任务 API 读取，不依赖内存日志        |
| **修改**      | ui/styles.css                                 | 任务状态、警告和移动适配                     |
| **修改**      | 启动Temu运营台.vbs                            | 启动新 server/index.mjs                      |
| **修改**      | src/dashboard-server.mjs                      | 改为兼容启动器或删除前的薄 wrapper           |
| **修改**      | scripts/windows/\*.cmd                        | 移动开发兜底命令                             |
| **删除/移动** | 根目录 0/1/2/3-\*.cmd                         | 移动到 scripts/windows；根目录只保留运营入口 |

## **14.3 开发任务**

**1.** 运营台首页显示：浏览器状态、当前任务、目标/已发现/已保存/失败、字段质量、最新 Excel。

**2.** 按钮：打开采集 Chrome、开始 100/300/1000、暂停、继续、取消、重试失败、导出、打开 Excel、打开结果目录。

**3.** API 只返回必要信息，不暴露本地绝对敏感路径或配置内容。

**4.** 暂停请求在下一个安全批次边界生效；不能在数据库事务中间强制退出。

**5.** 继续任务按 job_id 读取 checkpoint；失败重试只处理 retriable 的 job_item。

**6.** 服务重启后通过 crawl_jobs/crawl_events 重建页面状态和日志。

**7.** 错误提示面向运营：告诉用户应该检查什么，而不是直接显示 Node stack；stack 只写日志。

**8.** 模拟并实测：Chrome 被关闭、网络断开、验证码、页面不是 Top Sales、只加载 20 条、Excel 被占用、服务重启。

**9.** 更新 RUNBOOK，明确人工动作、数据目录、禁止删除项和恢复步骤。

## **14.4 数据库变化**

> ☐ crawl_events 作为 UI 日志源。
>
> ☐ crawl_jobs pause/cancel/heartbeat 状态成为唯一真实状态。
>
> ☐ scrape_errors resolved_at 可由成功重试更新。

## **14.5 测试与验证命令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>npm run test:integration -- server-jobs</p>
<p>npm run dashboard</p>
<p># 在 UI 中启动 300 条测试并执行暂停/继续</p>
<p># 关闭 server 后重新启动并确认任务状态</p>
<p># 关闭 Chrome，执行 retry</p>
<p># 打开 Excel 占用后重新 export</p>
<p>npm test</p>
<p>npm run check</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **14.6 当天交付物**

> ☐ 新的本地运营台与 API。
>
> ☐ 暂停、继续、取消、失败重试和恢复。
>
> ☐ 运营可读日志和错误提示。
>
> ☐ 更新后的 RUNBOOK 与 Windows 启动入口。

## **14.7 完成定义（Definition of Done）**

> ☐ 运营不打开 VS Code 即可完成 300 条采集和导出。
>
> ☐ 服务重启后任务和日志仍可见。
>
> ☐ 浏览器关闭后任务为可重试失败/暂停，不丢数据。
>
> ☐ 错误页面和低于安全阈值的结果不覆盖当前池。
>
> ☐ 根目录不再堆放多个面向开发的 CMD。

## **14.8 可直接复制给 Codex 的指令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>只执行 Day 6，不要继续 Day 7。</p>
<p>目标：重构本地运营台，使所有状态来自 v2 数据库，并完成 pause/resume/retry、服务重启恢复和运营故障处理。</p>
<p>必须实现：</p>
<p>- server/index + router + browser/job/export controllers。</p>
<p>- UI 显示浏览器、任务、进度、质量、错误和最新 Excel。</p>
<p>- 开始、暂停、继续、取消、重试失败、导出、打开文件按钮。</p>
<p>- 暂停只在安全批次边界生效；失败重试只处理 retriable items。</p>
<p>- 服务重启后从 crawl_jobs/crawl_events 恢复。</p>
<p>- 运营界面不展示 stack、Cookie、Token 或不必要绝对路径。</p>
<p>- 根目录开发 CMD 移到 scripts/windows，保留一个运营启动入口。</p>
<p>按文档故障矩阵实际测试 Chrome 关闭、网络、验证码、错误页面、低数量、Excel 占用和 server 重启。完成后输出测试矩阵和结果，然后停止。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **第 15 章　Day 7：完成约 1000 条正式商品池、初步分类与旧代码收尾**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天目标</strong></p>
<p>以真实 Temu 数据完成第 1 周最终验收，生成 Product Pool V1、质量报告、初步规则分类和运营交付包；只有新链路全部通过后才删除旧单体文件。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **15.1 前置条件与边界**

> ☐ 只在新分支 \`refactor/week1-catalog-core\` 工作；不要直接改 main。
>
> ☐ 先检查 git status；不要混入用户本地未提交的其他改动。
>
> ☐ 不 push、不创建 PR、不合并，除非用户另行明确授权。
>
> ☐ 不删除 data、outputs、browser-profile、config.json 和任何真实登录资料。
>
> ☐ 当天验收不通过立即停止，不自动继续下一天。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当天特别注意</strong></p>
<p>“约 1000”不是必须伪装成恰好 1000。平台当前可加载不足时应如实记录；更重要的是唯一、完整、可恢复和可追溯。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **15.2 文件清单**

| **动作**      | **文件/目录**                            | **目的**                                             |
|---------------|------------------------------------------|------------------------------------------------------|
| **新建**      | src/modules/products/rule-classifier.mjs | 基于标题关键词的可解释初步分类                       |
| **新建**      | config/category-rules.example.json       | 摩托配件大类/子类/细分类规则                         |
| **新建**      | src/app/commands/classify.mjs            | 对当前商品池运行规则分类                             |
| **新建**      | docs/WEEK1_ACCEPTANCE_REPORT.md          | 最终计数、质量、抽查、故障和未解决项                 |
| **新建**      | docs/RELEASE_NOTES_V1.md                 | 运营版本说明                                         |
| **新建**      | test/unit/rule-classifier.test.mjs       | 多标签、优先级、低置信度                             |
| **修改**      | README.md                                | 只保留新架构、安装、运行、阶段门和故障处理           |
| **修改**      | docs/FIELD_DICTIONARY.md                 | 更新为 v2 字段字典                                   |
| **修改**      | 运营使用说明.md                          | 更新为新运营台流程或合并到 RUNBOOK                   |
| **修改**      | package.json                             | 清理旧脚本，保留兼容别名和新命令                     |
| **修改**      | config.example.json                      | 默认 100；正式运行通过 UI/参数设 1000                |
| **删除/移动** | src/crawler.mjs                          | 新 browser/catalog/jobs/reviews 兼容测试通过后删除   |
| **删除/移动** | src/database.mjs                         | 新 repository 和迁移通过后删除                       |
| **删除/移动** | src/dashboard-server.mjs                 | 新 server 入口通过后删除或保留一个很短的弃用 wrapper |
| **删除/移动** | tools/build-report.mjs                   | 新 export 通过后删除或保留弃用 wrapper               |
| **删除/移动** | tools/migrate-top-sales.mjs              | 一次性脚本，迁移完成后删除                           |
| **删除/移动** | tools/import-live-products.mjs           | 移动 scripts/dev 或删除                              |
| **删除/移动** | tools/import-live-reviews.mjs            | 移动 scripts/dev 或删除                              |
| **删除/移动** | src/demo.mjs                             | 移动 scripts/dev/seed-demo.mjs；禁止写真实库         |

## **15.3 开发任务**

**1.** 如果单一类目页面不足 1000，可配置 3—5 个相关类目/搜索任务，按 goods_id 跨任务去重；报告每个来源贡献，禁止伪造数量。

**2.** 正式任务开始前备份 v2 DB；运行目标约 1000，持续监控质量和错误分类。

**3.** 完成后运行 rule classifier：手机支架、照明、后视镜、收纳/尾包、防护罩、贴纸装饰、维护工具、刹车/控制、其他等；低置信度标记人工复核。

**4.** 生成当前商品池 Excel、质量工作表、任务记录和分类结果。

**5.** 人工抽查至少 30 个：排名前/中/后、不同类目、价格与销量边界、缺失字段、图片。

**6.** 验证重复运行、旧商品退出、快照历史和 inactive membership。

**7.** 运行所有测试和 check；确认新 CLI、运营台和 Excel 不再引用旧单体。

**8.** 只有以上全部通过才删除/移动旧文件；Git 历史已经保留，不需要 legacy 目录。

**9.** 生成 WEEK1_ACCEPTANCE_REPORT：实际商品数、每字段完整率、重复率、图片成功率、错误分布、恢复测试、未完成项。

**10.** 不要 push；等待用户审阅文档、运行结果和 diff 后再决定提交/推送。

## **15.4 数据库变化**

> ☐ 写入 product_classifications；规则版本固定并可追溯。
>
> ☐ 正式 job 的 data_quality_checks 和 scrape_errors 完整记录。
>
> ☐ 不删除任何旧 snapshots、inactive memberships 或 v1 DB。

## **15.5 测试与验证命令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>npm run backup -- --config config.json</p>
<p>npm run capture -- --target 1000</p>
<p>npm run classify -- --job &lt;FINAL_JOB_ID&gt;</p>
<p>npm run export -- --job &lt;FINAL_JOB_ID&gt;</p>
<p>npm run export:qa -- --job &lt;FINAL_JOB_ID&gt;</p>
<p>npm run status</p>
<p>npm run test:unit</p>
<p>npm run test:integration</p>
<p>npm test</p>
<p>npm run check</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **15.6 当天交付物**

> ☐ Product Pool V1：约 1000 个唯一 Temu 商品。
>
> ☐ v2 SQLite 数据库与旧库备份。
>
> ☐ 含图片、链接、质量和分类的 Excel。
>
> ☐ WEEK1_ACCEPTANCE_REPORT 与 RELEASE_NOTES。
>
> ☐ 清理后的可维护代码结构和运营说明。

## **15.7 完成定义（Definition of Done）**

> ☐ 实际唯一商品数和不足原因透明可查。
>
> ☐ MUST 字段质量达到第 6 章阈值。
>
> ☐ 初步分类有规则版本、置信度和人工复核标记。
>
> ☐ 100、300、1000 三个阶段的任务和质量记录均存在。
>
> ☐ 旧 DB 未删除；新链路无旧单体引用。
>
> ☐ 运营人员独立完成一次正式采集、导出和打开 Excel。

## **15.8 可直接复制给 Codex 的指令**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>只执行 Day 7，这是第一周最终验收。不要开展评论深抓、1688 或 AI。</p>
<p>目标：完成约 1000 个唯一 Temu 商品的 Product Pool V1、初步规则分类、Excel、质量报告和代码收尾。</p>
<p>要求：</p>
<p>1. 先备份 v2 DB。单一页面不足 1000 时，允许多个相关类目/搜索任务，跨任务按 goods_id 去重，并报告来源贡献；禁止伪造数量。</p>
<p>2. 运行正式 capture、classify、export、export:qa。</p>
<p>3. 抽查至少 30 个，覆盖排名前中后、不同分类、缺失字段和价格边界。</p>
<p>4. 输出每字段完整率、重复率、图片成功率、错误分布、暂停恢复结果。</p>
<p>5. 规则分类必须可解释，有 rule_version/confidence/needs_review。</p>
<p>6. 新 CLI/server/export/tests 不再引用旧 crawler/database/dashboard/build-report 后，才删除或移动旧文件。</p>
<p>7. 不删除旧 DB、历史快照和 inactive membership。</p>
<p>8. 不 push、不建 PR。结束时提供完整 diff 摘要、验收报告和未完成项。</p>
<p>完成后停止，等待用户决定是否提交和推送。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **第 16 章　Codex 总控提示词与执行规则**

## **16.1 先交给 Codex 的总控提示词**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>你要在 GitHub 仓库 LiYiXilyx/temu-product-research 中执行“Temu 第 1 周商品池核心重构”。</p>
<p>业务目标：运营人员在独立 Google Chrome 中人工登录 Temu、进入目标类目并确认 Top Sales；系统连接当前页，按 100→300→约1000 阶段采集商品，写入 SQLite v2，保存历史快照，支持暂停/继续/失败重试/断点，导出带图片和链接的 Excel，并做初步规则分类。</p>
<p>技术决定：继续使用 Node.js 22、ES Modules、Playwright、Node SQLite、@oai/artifact-tool。第 1 周不迁 Python/TypeScript/React/PostgreSQL，不接 AI、1688 和自动上架。</p>
<p>绝对约束：</p>
<p>1. 只在 refactor/week1-catalog-core 分支工作，不直接改 main。</p>
<p>2. 任何 stage、commit、push、PR、merge 都分别需要明确授权；默认不 push。</p>
<p>3. 先检查 git status，不混入无关文件；永远不要 git add . 或 git add -A。</p>
<p>4. 不删除/覆盖 data/*.db、outputs、browser-profile、config.json；旧 DB 只读备份，v2 使用新文件。</p>
<p>5. 不绕过验证码、登录、访问限制，不复制用户日常 Chrome profile，不提高并发或隐藏自动化。</p>
<p>6. 缺失数值必须为 null，不能写 0；所有判断要有证据和错误码。</p>
<p>7. 每天只完成对应 Day，测试不通过就停止，不自动继续下一天。</p>
<p>8. 每天结束输出：变更文件、设计决定、命令及结果、数据计数、验收清单、风险、下一步；不得只说“完成”。</p>
<p>9. 删除旧单体文件只允许在 Day 7 且新链路、测试、CLI、运营台、Excel 全部通过后执行。</p>
<p>10. 任何真实 Temu 操作都保持低频、人工在环，并遵守平台规则和适用法律。</p>
<p>现在先阅读项目 README、package.json、src/crawler.mjs、src/database.mjs、src/dashboard-server.mjs、tools/build-report.mjs、test 和本文 Day 计划。等待我提供具体 Day 指令，不要自行开始全部重构。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **16.2 Codex 每天必须采用的输出格式**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p># Day N 执行结果</p>
<p>## 1. 完成内容</p>
<p>- ...</p>
<p>## 2. 变更文件</p>
<p>- path: 作用</p>
<p>## 3. 数据库变化</p>
<p>- migration / 表 / 索引 / 数据计数</p>
<p>## 4. 执行命令与结果</p>
<p>- 命令</p>
<p>- exit code</p>
<p>- 测试数、通过数、失败数</p>
<p>## 5. 阶段验收</p>
<p>- [x] ...</p>
<p>- [ ] ...（原因）</p>
<p>## 6. 风险与未完成</p>
<p>- ...</p>
<p>## 7. 建议下一步</p>
<p>- 仅建议，不自动执行下一天</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **16.3 Git 操作规则**

> ☐ 创建分支需要明确执行 Day 1 的授权；后续沿用该分支。
>
> ☐ stage 前展示 git status 和 git diff --stat；只 add 当天确认的文件路径。
>
> ☐ commit 不等于 push；用户说“提交”时不能自动 push。
>
> ☐ push 不等于创建 PR；PR 也需要单独授权。
>
> ☐ 默认分支上不得直接提交；Day 7 删除旧文件前必须展示引用搜索与测试结果。
>
> ☐ 不得把 config.json、数据库、输出 Excel、截图、日志和 browser-profile 加入 Git。

# **第 17 章　风险、回滚与故障处理**

| **风险**                | **表现**                   | **处理**                                                 |
|-------------------------|----------------------------|----------------------------------------------------------|
| **Temu 页面结构变化**   | 字段突然缺失、选择器无结果 | 保存 fixture/HTML/截图；解析和浏览器分离；失败不覆盖旧池 |
| **虚拟列表漏数据**      | 只采到当前 DOM 的 40 条    | 回顶部累计首次出现；受控滚动/See more；前中后排名抽查    |
| **登录/验证码**         | 任务停住或跳登录页         | 人工关卡、持久化 paused、继续按钮；禁止绕过              |
| **网络/VPN**            | 空白页、network error      | retriable 错误、checkpoint、人工恢复后重试               |
| **商品数下降**          | 本次只抓到旧池一部分       | 安全阈值和“不得少于现有 active 数”保护，事务切换         |
| **数据库损坏/迁移错误** | 启动失败或计数异常         | 旧 DB 只读、备份、migration 事务、checksum、导入报告     |
| **重复数据**            | URL 参数变化或恢复重复写入 | goods_id 唯一键、product+job 快照唯一、job_item 幂等     |
| **Excel 被占用**        | 无法覆盖固定文件           | 时间戳另存、运营台打开最新文件                           |
| **图片下载失败**        | Excel 空图或格式错误       | 校验 MIME/文件头、记录失败、允许重试，不阻塞主数据       |
| **重构回归**            | 旧功能丢失                 | 旧文件保留到 Day 7；兼容 wrapper；原测试 + 新测试        |
| **范围失控**            | 第一周开始做评论/1688/AI   | 明确 non-goals；每一天停止点；阶段验收后才排下一周       |

## **17.1 回滚策略**

**1.** 代码回滚：所有重构在 feature branch，main 不变；通过 Git 恢复到当天前提交。

**2.** 数据回滚：v2 使用新数据库文件；旧 v1 和每日备份不删除。

**3.** 运行回滚：旧 CLI/运营入口在 Day 7 前保留兼容 wrapper。

**4.** Excel 回滚：每次另存带时间戳版本，固定文件只在可写时更新。

**5.** 阶段回滚：100 或 300 未通过时，不运行更大规模；先修复字段和恢复问题。

# **第 18 章　第 1 周最终交付与第 2 周衔接**

## **18.1 第 1 周交付包**

> ☐ 可维护的 Node.js 模块化代码和 v2 SQLite schema。
>
> ☐ 旧数据库备份、v1→v2 导入脚本和导入报告。
>
> ☐ 100、300、约 1000 三个真实任务记录。
>
> ☐ Product Pool V1 与每次快照历史。
>
> ☐ Excel：商品池、数据质量、任务记录、字段说明。
>
> ☐ 初步规则分类、置信度和人工复核队列。
>
> ☐ 运营台、Windows 启动入口、暂停/继续/重试。
>
> ☐ README、RUNBOOK、字段字典、验收报告、release notes。

## **18.2 第 2 周的直接输入**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>v_current_products + product_snapshots</p>
<p>↓</p>
<p>清洗与类目统计</p>
<p>↓</p>
<p>Category Opportunity Score</p>
<p>↓</p>
<p>筛选 2—5 个细分类</p>
<p>↓</p>
<p>每类 10—30 个重点商品</p>
<p>↓</p>
<p>评论采集、差评证据与痛点机会</p>
<p>↓</p>
<p>3—10 个候选产品</p>
<p>↓</p>
<p>1688 半自动寻源</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

第 2 周开始时不再修改第一周采集核心，而是在稳定数据契约上新增 analysis、reviews 和 sourcing 模块。这样 Temu 页面变化只影响 catalog 层，AI 或 1688 变化也不会破坏商品池。

## **18.3 月底最终验收场景**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>输入：Temu 摩托车配件</p>
<p>↓</p>
<p>自动/半自动抓取约 1000 个商品</p>
<p>↓</p>
<p>初步分类与市场筛选</p>
<p>↓</p>
<p>给出 2—5 个机会细分类</p>
<p>↓</p>
<p>给出 20—50 个深度商品</p>
<p>↓</p>
<p>自动分析差评和用户痛点</p>
<p>↓</p>
<p>1688 找到相似产品与供应商</p>
<p>↓</p>
<p>计算采购、物流、平台费与利润</p>
<p>↓</p>
<p>人工确认 1—3 个产品</p>
<p>↓</p>
<p>生成上架资料并完成至少 1 个真实上架</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **附录 A　命令、提交信息与最终验收清单**

## **A.1 建议命令汇总**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>npm install</p>
<p>npm run init</p>
<p>npm run backup -- --config config.json</p>
<p>npm run migrate -- --config config.json</p>
<p>npm run dashboard</p>
<p>npm run status</p>
<p>npm run capture -- --target 100</p>
<p>npm run capture -- --target 300</p>
<p>npm run resume -- --job &lt;JOB_ID&gt;</p>
<p>npm run retry -- --job &lt;JOB_ID&gt;</p>
<p>npm run capture -- --target 1000</p>
<p>npm run classify -- --job &lt;JOB_ID&gt;</p>
<p>npm run export -- --job &lt;JOB_ID&gt;</p>
<p>npm run export:qa -- --job &lt;JOB_ID&gt;</p>
<p>npm run test:unit</p>
<p>npm run test:integration</p>
<p>npm test</p>
<p>npm run check</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **A.2 建议每日提交信息**

| **日期**  | **Commit message**                                                       |
|-----------|--------------------------------------------------------------------------|
| **Day 1** | refactor: establish week1 core architecture and database migrations      |
| **Day 2** | feat: add persistent crawl jobs and operator browser session             |
| **Day 3** | feat: capture and normalize Temu catalog products                        |
| **Day 4** | feat: persist catalog history with resumable jobs and quality gates      |
| **Day 5** | feat: export catalog QA workbook with images and preserved manual fields |
| **Day 6** | feat: add resumable operations dashboard and retry controls              |
| **Day 7** | chore: complete week1 catalog acceptance and retire legacy monoliths     |

## **A.3 第 1 周最终验收清单**

> ☐ 旧 v1 数据库存在且有时间戳备份。
>
> ☐ v2 migration 可重复运行，checksum 正常。
>
> ☐ 100、300、约 1000 阶段门记录完整。
>
> ☐ 运营当前页不是目标类目/Top Sales 时拒绝采集。
>
> ☐ 商品按 goods_id 去重，canonical URL 100%。
>
> ☐ 商品、成员关系、快照分离。
>
> ☐ 任务、任务项、事件、错误、质量全部落库。
>
> ☐ 暂停、继续、失败重试、服务重启恢复通过。
>
> ☐ Excel 图片、链接、质量、任务、字段说明通过。
>
> ☐ 人工备注重导不丢失。
>
> ☐ 初步分类可解释且低置信度可复核。
>
> ☐ 所有测试与 npm run check 通过。
>
> ☐ 旧单体删除前确认无引用。
>
> ☐ 没有提交 config、DB、Excel、截图、日志、浏览器资料。
>
> ☐ 没有绕过验证码、自动议价、自动采购或自动上架。

# **附录 B　旧文件保留、迁移与删除矩阵**

| **旧文件**                      | **短期**     | **迁移方式**                    | **最终**                        |
|---------------------------------|--------------|---------------------------------|---------------------------------|
| **src/crawler.mjs**             | Day 1—6 保留 | Day 2—4 逐步转发新模块          | Day 7 无引用且测试通过后删除    |
| **src/database.mjs**            | Day 1—6 保留 | 新 repository 接管 v2；旧库只读 | Day 7 删除代码，不删除旧 DB     |
| **tools/build-report.mjs**      | Day 1—5 保留 | Day 5 变 wrapper                | Day 7 删除或保留弃用 wrapper    |
| **src/dashboard-server.mjs**    | Day 1—5 保留 | Day 6 变 wrapper                | Day 7 删除或保留弃用 wrapper    |
| **src/parsers.mjs**             | 保留         | 拆分并兼容导出                  | 可长期保留薄导出，或 Day 7 删除 |
| **src/analysis.mjs**            | 部分保留     | 规则分类迁移；差评逻辑移 Week2  | 无引用后删除                    |
| **src/demo.mjs**                | 不用于生产   | 移动 scripts/dev                | 原文件删除                      |
| **tools/import-live-\*.mjs**    | 开发工具     | 有需要则移动 scripts/dev        | 无需要删除                      |
| **tools/migrate-top-sales.mjs** | 一次性迁移   | 确认 v2 导入覆盖功能            | Day 7 删除                      |
| **根目录 CMD**                  | 临时保留     | Day 6 移 scripts/windows        | 根目录仅留运营入口              |
| **test/\*.test.mjs**            | 保留         | 迁移 unit/integration           | 不删除有效覆盖                  |
| **docs/\*.md**                  | 保留内容     | 合并/更新术语                   | 只删除重复旧文档                |

# **资料来源与审查说明**

1\. 用户提供文件：《本月工作.docx》，3 页。

2\. GitHub：LiYiXilyx/temu-product-research，main 分支，静态审查基线提交 a87b5044ba21a7a9fcff83caa7dfffff46d121b6。

3\. 重点审查文件：README.md、package.json、config.example.json、src/cli.mjs、src/config.mjs、src/crawler.mjs、src/database.mjs、src/analysis.mjs、src/parsers.mjs、src/dashboard-server.mjs、tools/build-report.mjs、test/\*.test.mjs、运营使用说明.md。

4\. 限制：未在用户本机 Windows、VPN、真实 Temu 登录状态和页面环境中运行；页面与数据阈值必须由 Day 3—Day 7 实测确认。
