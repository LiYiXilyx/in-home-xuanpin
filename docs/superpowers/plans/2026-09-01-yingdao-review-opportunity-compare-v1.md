# YingDao 1688 Review Opportunity Compare V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 1688 Review Console 中为当前 50/250 run 增加 run-bound Temu 同类价格对比、单价归一化和机会倍率辅助标签。

**Architecture:** 启动时从 sourcing run 绑定的 Sheet05 只读加载 50 个 Temu 价格/分组证据，与只读 Temu DB 展示上下文合并。纯函数模块负责 quantity、group metrics、FX 和 opportunity band；Review service 仅扩展现有 bootstrap/detail read contract，UI 仅扩展现有 Review 页。

**Tech Stack:** Node.js ESM、`node:test`、`node:sqlite`、`@oai/artifact-tool`、原生 HTML/CSS/JavaScript。

**Spec:** `docs/superpowers/specs/2026-09-01-yingdao-review-opportunity-compare-v1-design.md`

## Global Constraints

- 只处理 fixed Review run 的 50 goods / 250 candidates，不扩大到 2135。
- 不修改 `ui/modules/catalog/*`、`/api/catalog/*`、Catalog state/DOM/polling/schema。
- Temu DB 使用 read-only connection；Catalog core DB writes 必须为 0。
- 不改 Review mutation 语义、Random5、image cache、Sheet05/11、migration。
- 不降级 supplier image containment/SHA/JPEG/decode 安全校验。
- 汇率只读版本化 sourcing config，不联网、不使用 Catalog 汇率。
- 每个 Task 必须 RED→GREEN→related regression→`git diff --check`→独立 commit。

---

### Task 1: Run-bound 数据源与 Contract Audit

**Files:**
- Create: `src/modules/sourcing/review-opportunity-workbook.mjs`
- Create: `test/unit/review-opportunity-workbook.test.mjs`
- Create: `test/integration/sourcing-review-opportunity-contract.test.mjs`
- Modify: `src/db/repositories/temu-sourcing-context-repository.mjs`

**Interfaces:**
- Produces: `loadRunOpportunityWorkbook({workbookPath,runGoodsIds,artifact}) -> Promise<{sourceId,itemsByGoodsId}>`
- Produces: `temuRepository.getTemuContexts(goodsIds) -> base contexts without unscoped cluster lookup`
- Contract: workbook headers map `goods_id`, `当前价格 EUR`, `当前 Pool Version`, grouping evidence; duplicate/missing run goods hard fail.

- [ ] **Step 1: Write failing workbook contract tests**

Build an in-memory artifact workbook with shuffled columns and two run goods. Assert name-based mapping, EUR values, NFC goods IDs, pool/source identity, run-only extraction, duplicate goods rejection, and missing run goods rejection. The production break caught is positional parsing or global workbook leakage.

- [ ] **Step 2: Run RED**

Run: `node --test test/unit/review-opportunity-workbook.test.mjs`

Expected: FAIL because `review-opportunity-workbook.mjs` does not exist.

- [ ] **Step 3: Implement the minimal workbook loader**

Use `SpreadsheetFile.importXlsx`, hash workbook bytes, resolve Sheet05 by exact name, map exact headers, and return only the supplied run goods. Never choose a snapshot or latest product.

- [ ] **Step 4: Write and run repository contract RED/GREEN**

Assert batch contexts are read through the read-only Temu connection and that cluster is not selected by unscoped `ORDER BY run_id DESC`. Add a batch method that uses products/images/classification only; run-specific grouping comes from workbook evidence.

- [ ] **Step 5: Real read-only characterization**

Load the actual run metadata and selected workbook; assert 50 run goods, 250 candidates, 50 workbook price records, EUR currency, one bound pool version, and unchanged sourcing/Temu DB hashes.

- [ ] **Step 6: Regression and commit**

Run: `node --test test/unit/review-opportunity-workbook.test.mjs test/integration/sourcing-review-opportunity-contract.test.mjs test/unit/sourcing-review-service.test.mjs test/integration/server-sourcing-review.test.mjs && git diff --check`

Commit: `feat: bind review opportunity context to run workbook`

### Task 2: Conservative Temu/Supplier Quantity Normalizer

**Files:**
- Create: `src/modules/sourcing/unit-price-normalizer.mjs`
- Create: `test/unit/unit-price-normalizer.test.mjs`

**Interfaces:**
- Produces: `parsePackQuantity(text) -> {pack_quantity,quantity_source,quantity_confidence,normalization_status,evidence}`
- Produces: `normalizeUnitPrice({listedPrice,currency,title,priceBasis}) -> normalized object`

- [ ] **Step 1: Write table-driven RED tests with literal expectations**

Cover `10pcs`, `pack of 12`, `10个装`, `一包10个`, `2 pairs`, `10件起批`, `37L`, `50cc`, `12V`, `6mm x 20mm 10pcs`, model/year numbers, and assumed single. Assert MOQ is never an input to pack parsing.

- [ ] **Step 2: Run RED**

Run: `node --test test/unit/unit-price-normalizer.test.mjs`

Expected: FAIL due to missing module.

- [ ] **Step 3: Implement minimal ordered patterns**

Apply explicit MOQ exclusion first, then explicit English/Chinese package patterns. Validate positive safe integer quantity and finite positive listed price. Round derived unit values deterministically without replacing listed price.

- [ ] **Step 4: GREEN, mutation check and commit**

Run: `node --test test/unit/unit-price-normalizer.test.mjs test/unit/yingdao-export-parser.test.mjs && git diff --check`

Commit: `feat: normalize sourcing pack quantities conservatively`

### Task 3: Deterministic Grouping and Group Price Metrics

**Files:**
- Create: `src/modules/sourcing/review-opportunity-groups.mjs`
- Create: `test/unit/review-opportunity-groups.test.mjs`

**Interfaces:**
- Consumes: normalized Temu items from Task 2.
- Produces: `resolveOpportunityGroup(item) -> {group_key,group_label,group_source,group_confidence}`
- Produces: `buildOpportunityGroups(items) -> {groupsByKey,itemByGoodsId}` with metrics.

- [ ] **Step 1: Write RED grouping tests**

Assert reliable cluster wins, taxonomy fallback, invalid/fallback values never mass-merge, SELF fallback, NFC/whitespace normalization, and reversed input produces byte-identical keys/item order.

- [ ] **Step 2: Write RED metrics tests**

With hand-derived prices assert min listed, reliable min unit, even/odd median, LOW assumed units excluded, coverage counts/ratios, tie goods ID, and default current-first sort helper.

- [ ] **Step 3: Run RED and implement pure functions**

Run: `node --test test/unit/review-opportunity-groups.test.mjs`

Implement only the validated label predicate, deterministic key builder, stable UTF-8 comparator, and metrics reducer.

- [ ] **Step 4: GREEN and commit**

Run: `node --test test/unit/review-opportunity-groups.test.mjs test/unit/unit-price-normalizer.test.mjs && git diff --check`

Commit: `feat: derive deterministic review opportunity groups`

### Task 4: Versioned FX and Opportunity Calculator

**Files:**
- Create: `src/modules/sourcing/review-opportunity-calculator.mjs`
- Create: `test/unit/review-opportunity-calculator.test.mjs`
- Modify: `src/modules/sourcing/sourcing-1688.mjs`

**Interfaces:**
- Produces: `resolveReviewFx(config) -> {status,cny_per_eur,eur_per_cny,source,as_of}`
- Produces: `normalizeSupplierCandidate(candidate,fx) -> supplier normalization`
- Produces: `calculateOpportunity({group,candidate,fx}) -> {opportunity_ratio,opportunity_band,opportunity_reasons}`

- [ ] **Step 1: Write RED FX and ratio tests**

Assert existing `CNY/EUR=0.12` means EUR-per-CNY and exposes `cny_per_eur=8.333333...`; invalid/missing config gives FX_RATE_REQUIRED. Assert 12x HIGH, 6x MEDIUM, 3x LOW, 36x REVIEW_REQUIRED with literal inputs.

- [ ] **Step 2: Write RED override/range tests**

Assert supplier LOW quantity => UNIT_REVIEW_REQUIRED, missing group unit => TEMU_UNIT_PRICE_REQUIRED, LOW group => GROUP_REVIEW_REQUIRED, range high selected conservatively, ambiguous minimum tier => PRICE_TIER_REVIEW_REQUIRED, and MOQ never affects pack quantity.

- [ ] **Step 3: Run RED and implement calculator**

Run: `node --test test/unit/review-opportunity-calculator.test.mjs`

Use explicit override priority and return stable reason codes. Do not read environment or fetch FX.

- [ ] **Step 4: GREEN and commit**

Run: `node --test test/unit/review-opportunity-calculator.test.mjs test/unit/unit-price-normalizer.test.mjs test/unit/sourcing-1688.test.mjs && git diff --check`

Commit: `feat: calculate review sourcing opportunity ratios`

### Task 5: Extend Review Service/API Read Contract

**Files:**
- Modify: `src/modules/sourcing/sourcing-review-service.mjs`
- Modify: `src/server/index.mjs`
- Modify: `test/unit/sourcing-review-service.test.mjs`
- Modify: `test/integration/server-sourcing-review.test.mjs`
- Modify: `test/integration/sourcing-review-opportunity-contract.test.mjs`

**Interfaces:**
- Consumes: `opportunityContext` containing workbook items and FX from Tasks 1/4.
- Produces: extended bootstrap goods and detail `{group_context,fx_context,temu_context,candidates}`.
- Existing mutation and image/open-link interfaces remain byte-compatible apart from additive response fields.

- [ ] **Step 1: Write service RED tests**

Fixture 3 goods/4 candidates. Assert bootstrap group summaries, detail group items/metrics, normalized candidate fields and band; reversed repository order produces the same response order. Assert fixed-run and 50/250 gates remain.

- [ ] **Step 2: Run RED**

Run: `node --test test/unit/sourcing-review-service.test.mjs`

- [ ] **Step 3: Implement one snapshot derivation path**

Load all base Temu contexts once per service snapshot, merge exact workbook records, normalize/group/calculate, and reuse the same derived model for bootstrap/detail. Preserve all mutation functions unchanged.

- [ ] **Step 4: Wire async startup context**

In `createOperationsServer`, get the fixed run from sourcing repository, load its selected workbook and versioned sourcing FX config before constructing Review service. Keep test injection supported. Do not touch Catalog setup.

- [ ] **Step 5: API integration GREEN and safety assertions**

Assert exact new JSON shape, existing image/link/mutations/revision conflict, Temu DB hash unchanged, sourcing review state unchanged for GETs, and no `/api/catalog` route additions.

- [ ] **Step 6: Regression and commit**

Run: `node --test test/unit/sourcing-review-service.test.mjs test/integration/server-sourcing-review.test.mjs test/integration/sourcing-review-opportunity-contract.test.mjs test/unit/sourcing-controller.test.mjs && git diff --check`

Commit: `feat: expose run scoped opportunity review context`

### Task 6: Extend Review Console State

**Files:**
- Modify: `ui/sourcing-review-state.js`
- Modify: `test/unit/sourcing-review-state.test.mjs`

**Interfaces:**
- Produces state fields: `groupExpanded`, `groupSort`, `comparisonGoodsId`, `imagePreview`, `noteDirty`.
- Produces actions: `toggleGroup()`, `setGroupSort(value)`, `previewGroupImage(goodsId)`, `closeImagePreview()`, `switchToGroupGoods(goodsId,{confirmDiscard})`, `setNoteDirty(value)`.

- [ ] **Step 1: Write state RED tests**

Assert image preview never requests/selects goods; explicit switch does; accordion survives switch; sort is module-local; dirty note blocks switch unless confirmation returns true; candidate default and all existing mutations/conflict reload remain.

- [ ] **Step 2: Run RED and implement minimal state transitions**

Run: `node --test test/unit/sourcing-review-state.test.mjs`

- [ ] **Step 3: Existing behavior regression and commit**

Run: `node --test test/unit/sourcing-review-state.test.mjs test/unit/sourcing-review-ui.test.mjs && git diff --check`

Commit: `feat: add opportunity comparison review state`

### Task 7: Accordion, Price Benchmark and Candidate UI

**Files:**
- Modify: `ui/sourcing-review.html`
- Modify: `ui/sourcing-review.js`
- Modify: `ui/sourcing-review.css`
- Modify: `test/unit/sourcing-review-ui.test.mjs`

**Interfaces:**
- Consumes: Task 5 additive API and Task 6 actions.
- Produces DOM IDs prefixed `reviewOpportunity*`; no Catalog DOM IDs.

- [ ] **Step 1: Write UI RED behavior tests**

Using the existing fake DOM harness, assert Temu listed/unit/group fields, collapsed metrics and six thumbnails, accessible accordion attributes, expanded cards and explicit switch button, preview-only image click, benchmark min/median/current/coverage/FX, candidate supplier unit/ratio/band/warnings, and profit disclaimer.

- [ ] **Step 2: Run RED**

Run: `node --test test/unit/sourcing-review-ui.test.mjs`

- [ ] **Step 3: Implement semantic HTML/JS rendering**

Insert accordion between current Temu and Random5. Reuse controlled image URLs. Add safe text nodes only. Connect dirty-note events and confirmation to state.

- [ ] **Step 4: Implement bounded responsive CSS**

Add max-height/overflow for group items, desktop card grid, warning band styles, current/min badges and modal-like image preview. Do not edit shared shell or Catalog CSS.

- [ ] **Step 5: GREEN, accessibility regression and commit**

Run: `node --test test/unit/sourcing-review-ui.test.mjs test/unit/sourcing-review-state.test.mjs test/integration/server-sourcing-review.test.mjs && npm run check && git diff --check`

Commit: `feat: render Temu opportunity comparison in review console`

### Task 8: Integration Regression and Safety Evidence

**Files:**
- Create: `test/integration/sourcing-review-opportunity-safety.test.mjs`
- Create: `scripts/1688/verify-review-opportunity-v1.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces CLI JSON metrics for 50/250, images, price coverage, grouping and opportunity bands.
- Produces pre/post hashes for Review decisions, Temu logical baseline, Catalog core tables, workbook and raw evidence.

- [ ] **Step 1: Write integration RED tests**

Run fixture GET bootstrap/detail and assert zero DB writes, Review decisions/notes unchanged, image endpoints preserved, duplicate DOM IDs/routes absent, and verifier rejects count/mapping drift.

- [ ] **Step 2: Run RED and implement read-only verifier**

Run: `node --test test/integration/sourcing-review-opportunity-safety.test.mjs`

The verifier opens Temu read-only, queries sourcing read-only, requests local endpoints, and emits deterministic JSON. It must not invoke Review mutations.

- [ ] **Step 3: Focused and related regressions**

Run all Review service/state/UI/image tests, Random5 tests, YingDao UI tests and Catalog/YingDao isolation tests. Record exact counts and failures.

- [ ] **Step 4: Full suite baseline comparison**

Run `npm test`, capture failing test file/name/error, and compare with the approved exact seven baseline failures. Run `npm run check` and `git diff --check`.

- [ ] **Step 5: Commit**

Commit: `test: verify review opportunity compare integration`

### Task 9: Real Stable-runtime Page Acceptance

**Files:**
- Create at runtime only: `docs/superpowers/verification/assets/yingdao-review-opportunity-compare-v1.png` (do not commit)

**Interfaces:**
- Consumes: `/api/health`, `/api/sourcing/imports/current`, Review bootstrap/detail and UI.
- Produces: final metrics, exact URL and screenshot evidence.

- [ ] **Step 1: Freeze production read-only baselines**

Record Temu DB hash/logical core counts, sourcing Review selection/exclusion/note/revision manifest, sourcing integrity/FK, workbook hash, and current 50/250/image counts.

- [ ] **Step 2: Controlled restart**

Verify the 37821 listener belongs to this stable runtime by PID command/path and health identity. Reuse healthy current code if HEAD matches; otherwise stop only the verified runtime process and launch via the existing launcher. Never kill an unknown process.

- [ ] **Step 3: API smoke and real run discovery**

Require `/api/health.service=temu-operator-dashboard`, obtain run ID from `/api/sourcing/imports/current`, and verify bootstrap 50 plus detail totals 250.

- [ ] **Step 4: Browser acceptance**

Open `/sourcing-review.html?run_id=<real>`; select the goods belonging to the largest group with size >1; expand the accordion; position current Temu, group panel, benchmark and first Random5 candidate in view; save screenshot without clicking any mutation.

- [ ] **Step 5: Post-smoke conservation**

Recompute all Step 1 baselines. Require unchanged Review selections/notes/revisions, unchanged Temu DB logical baseline, Catalog writes 0, image mapping errors 0, integrity ok/FK 0.

- [ ] **Step 6: Final verification commit**

Do not commit the screenshot. If only human-readable verification metadata is needed, keep it untracked or report in final; require `git status` clean and `git diff --check` before the task commit. Commit any test-owned non-binary acceptance harness as `test: validate real review opportunity page`.

## Plan Coverage Self-review

- Spec sections 1–13 map to Tasks 1–9; price authority and run binding are Task 1/5.
- Quantity false positives and MOQ separation are Task 2/4/7.
- Group fallback, deterministic metrics and median are Task 3.
- Existing versioned FX semantics and all band overrides are Task 4.
- Additive API and Review mutation compatibility are Task 5.
- Preview versus explicit switch and dirty-note safety are Task 6/7.
- Catalog/image/Review conservation and exact seven baseline comparison are Task 8/9.
- Real URL, largest multi-item group, accordion and screenshot are Task 9.
- Function names and response fields are consistent across tasks; no placeholders remain.

`PLAN_COVERAGE = PASS`
