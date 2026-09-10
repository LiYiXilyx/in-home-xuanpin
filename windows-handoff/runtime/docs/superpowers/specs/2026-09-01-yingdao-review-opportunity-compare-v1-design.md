# YingDao 1688 Review Opportunity Compare V1 Design

## 1. 目标与范围

在现有 `/sourcing-review.html` 人工复核页面内增加「当前 run 同类 Temu 商品对比」、Temu/1688 包装数量归一化、组价格统计和价格倍率辅助标签。V1 严格固定为当前 Review run 的 50 个 Temu goods / 250 个 Random5 candidates。不扫描 2135 Active Pool，不自动选供应商，不改 Review 结论。

价格倍率仅是筛选指标。页面固定显示：「价格倍率仅比较 Temu 商品价与 1688 采购价，尚未计入国际运费、头程、VAT、平台佣金、包装、退货损耗、广告费用和汇率波动。」

## 2. 现有架构审计

- Review 可写数据源：`1688_sourcing.db`，固定 run `yingdao_random5_v1_20260831_001`，50 goods / 250 candidates。
- Temu 展示数据源：`temu_research_v2.db`，通过 `DatabaseSync(...,{readOnly:true})` 打开。
- 当前 `getTemuContext(goods_id)` 只返回 title、已验证本地主图、classification 和 cluster，没有价格。
- sourcing run 没有 snapshot_id，但 `selected_workbook_path` 绑定现有分析工作簿。该工作簿 Sheet05 包含 2135 行冻结的 goods_id、当前价格 EUR、Pool Version、用户场景、产品类型、Level3、相似产品簇及分类证据。
- Temu DB 中有两个均覆盖这 50 goods 的历史 opportunity snapshot，run 没有消除二义性的外键。因此不能选 global/latest snapshot。
- candidate 权威价格字段为 `price_raw`、`price_rmb`、`price_min_rmb`、`price_max_rmb`；`moq` 独立。
- 现有版本化 `config/1688-sourcing-v1.json` 定义 `pair=CNY/EUR, rate=0.12, source=MANUAL_CONFIG, observedAt=2026-08-28`，现有导入语义是 `EUR=CNY*rate`。
- Review 的 select/clear/exclude/restore/note、revision conflict、HTTPS 1688 link 和受控图片 API 已经验证，本轮不改 mutation 语义。

## 3. 数据权威与 run 绑定

### 3.1 Temu 价格与分组证据

服务启动时只读加载当前 sourcing run 的 `selected_workbook_path`。必须存在 `05_细分商品明细`，必须以真实表头映射，并只提取 sourcing run 中 50 个 goods_id。工作簿是 run-bound evidence，不是可写业务库。

每条价格上下文返回：

- `temu_listed_price_eur`：Sheet05 `当前价格 EUR`的有限正数；
- `temu_currency=EUR`；
- `temu_price_source=RUN_SELECTED_WORKBOOK_SHEET05`；
- `temu_price_source_id`：`sha256(workbook bytes) + #05_细分商品明细 + pool_version`。

不从标题猜货币价，不读 global/latest product/snapshot。价格缺失时返回 null，不补 0。工作簿必须属于当前 run；路径从 sourcing DB run metadata 取得，不硬编码。

### 3.2 现有 Temu context

title 和已验证主图仍从只读 Temu DB 取得。Sheet05 不替代主图证据链。当 Temu DB 缺失 title/image 时保持 `temu_context_status=MISSING`，不借其它商品。

## 4. 包装数量与单价归一化

新增纯函数 `normalizeUnitPrice(input)`，不读 DB、时间或环境。输出保留 listed price/currency，派生 `pack_quantity`、`unit_price`、`quantity_source`、`quantity_confidence`、`price_basis`、`normalization_status`、`evidence`。

只匹配明确包装表达：`10pcs/pcs/pc/pieces`、`10-piece/count`、`pack/set of 10`、`10 pack`、`2 pairs/pair of 2`、`10个/只/件/套/粒/片装`、`一包10个`、`每包10个`、`10个/包`。明确表达为 HIGH；无表达时 quantity=1、`ASSUMED_SINGLE/LOW/ASSUMED`。

数字后缀 `L/cc/V/mm/cm`、尺寸、年份、型号、MOQ/起批量不是包装数。`10件起批` 必须被否定优先规则排除。`6mm x 20mm 10pcs` 只得到10。MOQ 始终是独立展示字段。

Supplier 单值优先 `price_rmb`。可解析区间保留 low/high，计算用 high，`price_basis=RANGE_HIGH_CONSERVATIVE`。只有最低价且规格档位不明时使用 provisional value，但 band 强制 `PRICE_TIER_REVIEW_REQUIRED`。

## 5. 确定性分组

服务端对 50 goods 一次计算，前端不推断。字符串 NFC、trim、折叠内部空白、小写用于 key；展示 label 保留原值。无论输入顺序，group key 和 items 按 UTF-8 goods_id 顺序稳定。

1. 可靠 `similar_cluster` => `CLUSTER:<normalized>` / `SIMILAR_CLUSTER` / HIGH。
2. 可靠 taxonomy path => `TAXONOMY:<l1>|<l2>|<l3>` / `TAXONOMY_PATH` / MEDIUM。
3. V1 不新写模糊标题 resolver。
4. `GOODS:<goods_id>` / `未可靠分组` / SELF / LOW。

无效标签包含空、`-`、`—`、未知、其它/其他、待细分、未可靠分组、明显 fallback。最深层 taxonomy 无效时不能因共享「其它」而合并；只使用到最深可靠层级，若路径仍过宽或空则 SELF。

## 6. 组价格统计

每组计算 item count、有效 EUR listed count/min、可靠 unit count/min/median、coverage 与对应 goods_id。可靠 unit 只包括 HIGH/MEDIUM quantity confidence；LOW assumed single 只显示，不决定可靠 minimum/median。偶数中位数是中间两项平均。所有 tie 以 UTF-8 goods_id 破解。

## 7. 汇率策略

复用已有、版本化、带来源和观察日期的 sourcing config，不使用 Catalog `exchangeRateRmb`，不联网。已有 `CNY/EUR rate=0.12` 是 `EUR per CNY`，服务对外标准化为：

```
cny_per_eur = 1 / rate
supplier_unit_price_eur = supplier_unit_price_cny * rate
```

只有 pair、正数 rate、source、observedAt 都合法时 `fx_context.status=AVAILABLE`。否则 `FX_RATE_REQUIRED`，所有 EUR 采购单价和 ratio 为 null。V1 无需 migration 或新的 FX 写 API。

## 8. 机会倍率

```
ratio = group_min_reliable_unit_price_eur / supplier_unit_price_eur
```

普通区间：10–30 => HIGH，5–<10 => MEDIUM，<5 => LOW，>30 => REVIEW_REQUIRED。以下覆盖普通 band，优先级从高到低：FX_RATE_REQUIRED、TEMU_UNIT_PRICE_REQUIRED、PRICE_TIER_REVIEW_REQUIRED、UNIT_REVIEW_REQUIRED、GROUP_REVIEW_REQUIRED。被覆盖时 ratio 可作 provisional 数字显示，但不得呈现绿色 HIGH。原因以稳定 code 数组返回。

## 9. API 契约

仅扩展现有：

- `GET /api/sourcing/review/bootstrap`：goods 增加 group summary 与 Temu listed/unit summary。
- `GET /api/sourcing/review/goods/:goods_id`：增加 `group_context`、`fx_context`、Temu normalization 字段及 candidate normalization/opportunity 字段。

图片继续使用已有两个受控 endpoint。Review mutation route、revision 和错误 code 不变。读路径每次都通过 fixed run 的 50/250 conservation gate。

## 10. UI 与交互

继续使用现有 HTML/JS/CSS/state。中列顺序为：当前 Temu 详情、Accordion 同类对比、价格基准条、Random5。

Accordion 使用 button + `aria-expanded` + `aria-controls` + region。收起态显示 metrics 与前 6 张缩略图；展开态在有限 max-height 的独立滚动区显示全组卡片。默认当前商品置顶，再按可靠 unit price 和 goods_id。还支持 unit price、listed price、goods_id 排序。

点图片只打开模块内预览，不调 `selectGoods`。「切换到此商品复核」才切换 goods。现有备注是点击保存的显式 mutation；前端跟踪 textarea dirty，有未保存备注时使用明确 confirm 阻止无提示切换。

候选卡显示 RMB 原价/区间、包装数、MOQ、CNY/EUR unit price、组最低可靠 Temu unit price、ratio、band 和 warning。各种 review-required band 使用警示色，不伪装 HIGH。

## 11. 隔离与兼容

- 不修改 `ui/modules/catalog/*`、`/api/catalog/*`、Catalog DOM/state/polling。
- Temu DB 连接保持 read-only；新功能不对 Catalog core table 写入。
- 不修改 schema/migration、Random5、图片缓存或 Sheet11。
- supplier 图片路径 containment、SHA-256、JPEG signature 和 decode 验证不降级。
- 不更改既有 Review 字段或 mutation。新数据是读时派生，老客户端忽略新字段仍可用。

## 12. 错误处理

- run 工作簿缺失/损坏/Sheet05 缺失/重复 goods_id：Review opportunity context 明确失败，不 fallback 到 latest DB。
- 单个 goods 价格缺失：该 goods 显示 MISSING，其它 goods 仍可浏览。
- 汇率无效：页面显示 FX_RATE_REQUIRED，不猜测。
- 不可靠分组/数量/价格档位：保留 provisional 信息并返回 review-required band。

## 13. TDD 与验收

按 9 个独立 Task 串行 RED→GREEN→related regression→`git diff --check`→commit。新测试覆盖：工作簿 run binding、quantity false positives、deterministic grouping/metrics、FX 及 band override、API 50/250 conservation、state 显式切换、Accordion/accessibility、Review mutation 不变、图片 50/250、Catalog isolation。

全套测试与批准的精确 7 个 baseline failures 按 test file + test name + reason 比较，不只比数量。

真实验收仅 GET 和展开/排序/预览：受控重启 stable runtime，从 API 获取真实 run_id，打开 Review 页，选最大的多商品组，展开 Accordion，截图但不提交二进制文件。验收前后对比 Review selections/notes、Temu DB logical baseline 和 Catalog core table hashes/counts。

## 14. Design Gate 自审

- 无 TBD/TODO/未决策项。
- 价格权威明确绑定 sourcing run 选中的 workbook，消除两个 snapshot 的歧义。
- FX 复用现有 sourcing-owned 版本配置，不需 migration，不误用 Catalog 值。
- 分组、归一化、metrics 和 ratio 都是服务端确定性派生。
- 所有 Review 写操作和图片安全边界保持。
- Catalog 代码零修改、Catalog core DB 零写入是强制验收门。

`DESIGN_GATE = PASS`
