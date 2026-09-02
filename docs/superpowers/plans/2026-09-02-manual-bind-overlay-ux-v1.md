# Manual Bind Operator Overlay UX V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace competing Temu Catalog extension overlays with one context-selected, readable Manual Bind operator surface shared with Popup.

**Architecture:** Pure mode and view-model modules select and describe the server-owned Campaign; a single Overlay renderer owns all Catalog listing UI. Manual and legacy runners remain behaviorally separate, and Popup consumes the same view model rather than duplicating business interpretation.

**Tech Stack:** Chrome Manifest V3, browser content scripts, vanilla DOM/CSS, Node.js VM/Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-02-manual-bind-overlay-ux-v1-design.md`

## Global Constraints

- No real detect, bind, capture, QA, activation, Campaign creation, or production Catalog writes.
- Do not modify YingDao/sourcing/Visual Index/Random5/Opportunity files.
- Manual Bind remains passive: no automatic scroll/navigation/pagination/See more/CAPTCHA/category switching.
- Full suite retains the exact approved seven baseline failures and adds zero failures.
- Each task follows RED → minimal implementation → GREEN → related regression → `git diff --check` → commit.

---

### Task 1: Audit and delivery contracts

**Files:**
- Create: `docs/superpowers/specs/2026-09-02-manual-bind-overlay-ux-v1-design.md`
- Create: `docs/superpowers/plans/2026-09-02-manual-bind-overlay-ux-v1.md`

**Interfaces:** Documents the exact mount points, mode values, shared model, files, safety boundaries, and verification commands consumed by Tasks 2–7.

- [ ] Audit every extension fixed mount and Motorcycle constant.
- [ ] Record the single-overlay architecture and no-production-write boundary.
- [ ] Self-review for placeholders, contradictions, scope gaps, and exact seven-task coverage.
- [ ] Run `git diff --check` and commit the design and plan.

### Task 2: Central overlay mode resolver

**Files:**
- Create: `browser-extension/catalog-overlay-mode.js`
- Modify: `browser-extension/manifest.json`
- Modify: `browser-extension/catalog-auto-runner.js`
- Modify: `browser-extension/catalog-manual-passive-runner.js`
- Test: `test/unit/catalog-overlay-mode.test.mjs`

**Interfaces:** Produces `TemuCatalogOverlayMode.resolveCatalogOverlayMode(context)` returning only `MANUAL_BIND | LEGACY_AUTO_RUNNER | NO_CONTEXT | BLOCKED`.

- [ ] RED: assert all four modes and that Manual Bind mounts neither legacy DOM nor legacy polling.
- [ ] Run the focused test and observe missing resolver/legacy mount failure.
- [ ] Implement the pure resolver, load it before runners, and gate both boot paths.
- [ ] GREEN plus Auto/Manual runner regressions; run `git diff --check`; commit.

### Task 3: Dynamic Profile/Page Health view model

**Files:**
- Create: `browser-extension/catalog-operator-view-model.js`
- Modify: `browser-extension/manifest.json`
- Modify: `browser-extension/catalog-manual-passive-runner.js`
- Test: `test/unit/catalog-operator-view-model.test.mjs`

**Interfaces:** Produces `TemuCatalogOperatorViewModel.build(snapshot)` and `contextIdentity(snapshot)`; the model contains identity, quantity, steps, health rows, errors, counts, and technical details.

- [ ] RED: girls context contains no Motorcycle text; Motorcycle stays correct; expected/actual rows and OPEN_ENDED semantics are literal.
- [ ] RED: an older context identity cannot overwrite the current model.
- [ ] Implement immutable dynamic projection and human error guidance without changing binding logic.
- [ ] GREEN plus Manual Bind/Profile tests; run `git diff --check`; commit.

### Task 4: Single light operator panel

**Files:**
- Create: `browser-extension/catalog-operator-overlay.js`
- Modify: `browser-extension/manifest.json`
- Modify: `browser-extension/catalog-manual-passive-runner.js`
- Test: `test/unit/catalog-operator-overlay.test.mjs`

**Interfaces:** Produces `TemuCatalogOperatorOverlay.mount({runner,document,sessionStorage})`, returning `{render,destroy}` and owning only `#temu-catalog-operator-overlay` plus the shared toast host.

- [ ] RED: exactly one primary panel, three gated actions, light theme tokens, font minima, expected/actual health, default-collapsed details, visible disabled reason.
- [ ] Implement semantic DOM and approved styles; wire explicit clicks to existing runner actions.
- [ ] GREEN plus accessibility/collapse tests; run `git diff --check`; commit.

### Task 5: Toast, launcher, and viewport consolidation

**Files:**
- Modify: `browser-extension/catalog-operator-overlay.js`
- Modify: `browser-extension/catalog-capture.js`
- Modify: `browser-extension/content-script.js`
- Test: `test/unit/catalog-overlay-layout.test.mjs`

**Interfaces:** Adds `overlay.toast(kind,message)` with deduplication and one container; Overlay dataset exposes expanded/collapsed state for capture-button suppression.

- [ ] RED: expanded panel hides duplicate launcher/capture button; collapsed shows one launcher; duplicate toast merges; viewport bounds prevent action overlap.
- [ ] Implement one Catalog launcher/toast owner and preserve Review-only behavior.
- [ ] GREEN plus extension capture/review regressions; run `git diff --check`; commit.

### Task 6: Popup/Overlay shared state and operations

**Files:**
- Modify: `browser-extension/popup.html`
- Modify: `browser-extension/popup.js`
- Modify: `browser-extension/manifest.json`
- Test: `test/unit/catalog-popup-view-model.test.mjs`

**Interfaces:** Popup calls `TemuCatalogOperatorViewModel.build(state)` and the same `MANUAL_DETECT_CURRENT | MANUAL_BIND_CURRENT | MANUAL_CAPTURE_CURRENT` messages; technical details use a collapsed `<details>` element.

- [ ] RED: identical snapshot yields identical category/profile/health/binding/quantity/counts in Popup and Overlay; no `0 / 0` for OPEN_ENDED.
- [ ] Implement shared rendering and advanced-only legacy explanation.
- [ ] GREEN plus popup/browser-extension regressions; run `git diff --check`; commit.

### Task 7: Delivery verification and real-page acceptance

**Files:**
- Create: `scripts/verify-manual-bind-overlay-ux-v1.mjs`
- Create: `docs/superpowers/verification/2026-09-02-manual-bind-overlay-ux-v1.md`
- Test: all new and related extension/Catalog/YingDao isolation tests.

**Interfaces:** Verifier rejects production config/database inputs, runs fixture-only checks, and prints the final overlay safety gates.

- [ ] Run verifier, related regression, `npm run check`, and full suite; compare exact seven failure identities.
- [ ] Prove `ui/modules/yingdao`, sourcing, and production data are unchanged; remove local `node_modules` link; ensure clean worktree.
- [ ] Push feature normally, ff-only merge stable, rerun stable verification, and push stable normally.
- [ ] Controlled-restart Dashboard; reload unpacked extension; refresh real Girls' Sets page without detect/bind/capture.
- [ ] Inspect panel counts/text/layout, save screenshot outside repository, keep Dashboard/page open, write verification report, and commit/push it without force.
