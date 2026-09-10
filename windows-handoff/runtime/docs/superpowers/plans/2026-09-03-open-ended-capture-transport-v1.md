# Girls' Sets OPEN_ENDED Capture Transport V1 Implementation Plan

> 每个任务严格执行 RED → 最小实现 → GREEN → related regression → `git diff --check` → 独立 commit。测试数据库仅使用 temporary/fixture SQLite。

**Goal:** 修复 OPEN_ENDED 单击仅提交 1 条，按 Campaign 明确 DOM optional / network required 策略，并提供真实、可审计的批次与 UI 统计。

**Architecture:** 浏览器扩展集中解析 batch limit 与 transport policy；候选始终由当前 DOM 驱动。服务端复用同一业务语义验证 card evidence，并按实际接收/落库结果返回统计。Manual runner 将 page identity 和 transport readiness 分离，overlay 只展示真实模型。

## Task 1: OPEN_ENDED Batch Limit

**Files:** `browser-extension/catalog-capture.js`, `test/unit/catalog-network-capture.test.mjs`

**RED:** 添加 `resolvePassiveBatchLimit` 行为测试：null/undefined→300、40 DOM→40、350→300、10→10、0/负数/NaN→`INVALID_PASSIVE_BATCH_LIMIT`；运行该测试确认因现有 null→0 逻辑失败。

**Minimal implementation:** 新增并导出 `resolvePassiveBatchLimit(maxCards)`；`capturePassive` 仅使用该入口，不再用 `Number(maxCards)||0`。

**GREEN/regression:** 运行 `catalog-network-capture.test.mjs`、`catalog-manual-passive-runner.test.mjs`、`browser-extension.test.mjs`；检查 300 分片与 targeted limit 未变。

**Commit:** `fix: resolve open-ended passive batch limit`

## Task 2: Central Capture Transport Policy

**Files:** 新建 `browser-extension/catalog-capture-transport-policy.js`; 修改 `browser-extension/manifest.json`, `browser-extension/catalog-capture.js`, `browser-extension/catalog-manual-passive-runner.js`; 测试 `test/unit/catalog-capture-transport-policy.test.mjs`, `test/unit/browser-extension.test.mjs`。

**RED:** 测试已冻结合法 policy、Capture-only Initial legacy derivation、其它 Campaign strict default、非法 frozen policy HARD FAIL；证明 sentinel/OPEN_ENDED 本身不能降级 strict。

**Minimal implementation:** 实现 `resolveCaptureTransportPolicy({campaign,profile})`，返回 `{policy,source}`；manifest 在 capture/runner 前加载；runner 与 capture 只消费 resolver。

**GREEN/regression:** 运行新测试、quantity policy、overlay mode、Manual Bind tests；确认 Motorcycle/Refresh 均 strict。

**Commit:** `feat: resolve campaign capture transport policy`

## Task 3: Policy-aware DOM Candidate Generation

**Files:** `browser-extension/catalog-capture.js`, `browser-extension/catalog-product-merger.js`（仅必要时）, `test/unit/catalog-network-capture.test.mjs`。

**RED:** 使用 40 DOM/1 Network fixture：DOM optional 得 40（1 enhanced、39 DOM），strict 得 1；Network-only 为 rejected diagnostic 且不提交；DOM 缺非核心字段保持 null；DOM 缺 goods_id/title/Temu URL 不合格。

**Minimal implementation:** 新增 `buildPassiveCandidates({domCards,networkRecords,requested,policy,limit,pageBinding,capturedAt})`。遍历 DOM，验证最低契约，同 ID 时 merge；生成 diagnostics，不遍历 Network 生成正式 card。

**GREEN/regression:** 网络 parser/cache/bridge、identity、Full Refresh sales evidence tests 全部通过。

**Commit:** `feat: build policy-scoped passive candidates`

## Task 4: Server Evidence Gate and Actual Transport Audit

**Files:** `src/modules/catalog-scale/capture-transport-policy.mjs`（服务端等价 resolver）, `src/modules/catalog-scale/catalog-campaign-service.mjs`, `test/integration/catalog-manual-binding.test.mjs`, `test/integration/initial-campaign-create.test.mjs`, `test/integration/initial-manual-capture.test.mjs`。Campaign 创建与 config freeze 均继续由现有 `catalog-campaign-service.mjs` 负责，不新增平行 service。

**RED:** temporary SQLite 测试：Capture-only Initial 接收 DOM 与 enhanced；strict Campaign 拒绝 DOM-only 0 writes；Network-only/错误 binding 拒绝；批次返回真实 `networkEnrichedSaved/domOnlySaved/networkOnlyRejected`；新 Initial config 冻结 policy；现有 Girls legacy 由明确规则解析。

**Minimal implementation:** 服务端依据 campaign/profile policy 验证每卡；DOM optional 要求最低字段及 binding，strict 保持 Network evidence。`captureBatch` 从验证后的实际 cards 统计 transport，并放入 batch/audit 返回；不修改历史 rows。

**GREEN/regression:** Manual binding、Initial pool、operator campaign、Full Refresh、multi-category isolation tests 通过。

**Commit:** `feat: enforce and audit capture transport policy`

## Task 5: Page Identity / Transport Readiness Split

**Files:** `browser-extension/catalog-manual-passive-runner.js`, `browser-extension/catalog-manual-binding.js`, `browser-extension/catalog-operator-view-model.js`, `test/unit/catalog-manual-passive-runner.test.mjs`, `test/unit/catalog-manual-binding.test.mjs`, `test/unit/catalog-operator-view-model.test.mjs`。

**RED:** DOM optional 的 40 DOM/1 intersection 为 `READY_WITH_DOM` 且可绑定；strict 为 `READY_NETWORK_ENRICHED`（intersection>0）或 BLOCKED；页面身份任一失败始终 BLOCKED；See more 仅增加卡片不使 binding 失效。

**Minimal implementation:** identity health 不含 transport；runner 用 policy candidate diagnostics 生成 transport health/warning。Snapshot 保存全部分层计数，capture 前服务器提交前再次计算。

**GREEN/regression:** page context loss、unbound zero-write、CAPTCHA/search、Girls breadcrumb、Motorcycle strict 回归通过。

**Commit:** `feat: separate page and transport readiness`

## Task 6: Detailed Capture Result UI

**Files:** `browser-extension/catalog-operator-view-model.js`, `browser-extension/catalog-operator-overlay.js`, `browser-extension/popup.js`（若共享模型已覆盖则不改）, tests `catalog-operator-view-model.test.mjs`, `catalog-operator-overlay.test.mjs`, `catalog-popup-view-model.test.mjs`。

**RED:** Toast/面板断言 received/new/duplicates/excluded/failed/current 与 enhanced/DOM/network-only；第二次重复 capture 显示 new=0；OPEN_ENDED 不出现 0/0；Catalog rerender 不碰 YingDao root/state。

**Minimal implementation:** view model 只映射 server batch/audit + refreshed campaign；overlay 格式化多行/明确文本，不用候选数伪造持久化数。

**GREEN/regression:** Catalog overlay、popup、Catalog/YingDao isolation tests 通过。

**Commit:** `feat: show actual passive capture results`

## Task 7: End-to-end Temporary SQLite and Verification Script

**Files:** 新建 `scripts/verify-open-ended-capture-transport-v1.mjs`; 修改 `package.json`; 新建/修改 `test/integration/open-ended-capture-transport-v1.test.mjs`。

**RED:** 端到端 fixture 覆盖已有 1 条 + 40 visible、首次 delta、重复点击、See more delta、Girls Profile/Campaign count=1、cross-category=0、Motorcycle/Refresh strict。

**Minimal implementation:** verifier 只接受 temporary root/database，输出机器可读 Gate；package script 注册 verifier。

**GREEN/regression:** 新增测试 100% PASS；相关 regression 100% PASS；`npm run check` 与 `git diff --check`。

**Commit:** `test: verify open-ended capture transport safety`

## Task 8: Feature/Stable Integration and Controlled Production Acceptance

**No feature code changes.**

1. 在 feature worktree 跑 focused、related、full suite，记录 exact failure identities；缺依赖/loopback 的结果不能冒充正式 full suite。
2. 确认无 YingDao 文件变化、无 DB/log/cache/artifact 入 commit；普通 push feature。
3. stable 未未知前进且 clean 时 `git merge --ff-only codex/open-ended-capture-transport-v1`。
4. 在依赖完整的 stable runtime 重跑 focused、related、full suite、`npm run check`、`git diff --check`；失败集合必须 exact approved 7，new failures=0。
5. 受控核验并重启已验证身份的 Dashboard；验证 `/api/health` service identity。不得仅凭 PID/端口 kill。
6. 运营人工重新加载稳定目录扩展、Temu 页强刷、检测、绑定。自动化不得点击 See more/滚动。
7. 只对明确 Girls Campaign 记录 before metrics，并只点击一次 capture。若 unique 未增加立即停止。
8. 只读验证 Campaign/Profile count、cross-category、integrity、FK；调用 exact Campaign scoped Preview Export，核验行数/图片状态并用 Finder 打开目录。
9. 普通 push stable；核对 remote HEAD 等于 local。

**Final evidence:** 按用户指定的 Final Verification 字段逐项返回；任何无法验证项写 `NOT VERIFIED`，不得推测。

## Design → Plan Coverage

- Null limit 与 300 cap：Task 1
- 集中 policy/legacy derivation/freeze：Tasks 2、4
- DOM optional、strict、Network-only、最低字段：Tasks 3、4
- Identity/transport 双 gate 与分层 diagnostics：Task 5
- 真实服务端统计和 UI：Tasks 4、6
- Dedupe、See more、跨类目/Motorcycle/Refresh/YingDao：Tasks 3、5、7
- 临时 SQLite、full suite exact failures、单次生产验收、scoped Excel、push：Task 8
