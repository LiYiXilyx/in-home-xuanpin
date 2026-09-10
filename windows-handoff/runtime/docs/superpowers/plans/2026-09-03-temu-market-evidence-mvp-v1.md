# Temu Market Evidence MVP V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a strictly operator-driven Temu search evidence workflow and manual Temu/1688 price-ratio assessment inside the existing sourcing Review console.

**Architecture:** Add an isolated evidence aggregate to the sourcing database, expose strictly scoped Review APIs, and extend the existing Chrome extension with explicit bind-token and passive screenshot/DOM capture. Integrate a state-isolated panel into the existing Review middle column; all real Temu actions remain manual and all automated acceptance uses local fixtures.

**Tech Stack:** Node.js ESM, SQLite, `node:test`, Chrome Manifest V3, browser DOM/canvas APIs, vanilla JavaScript/CSS.

**Spec:** `docs/superpowers/specs/2026-09-03-temu-market-evidence-mvp-v1-design.md`

## Global Constraints

- Continue on `codex/initial-candidate-snapshot-image-cache-v1`; create no branch/worktree and do not push.
- Do not implement or modify the frozen Initial Candidate Snapshot + Image Cache V1 Tasks 1–14.
- Do not touch candidate ledger fields or semantics, Catalog Campaign/Pool/Membership/QA/Activation, or historical migrations.
- Temu opening, search, See more, scrolling, binding choice, BEFORE, and AFTER triggers remain explicit operator actions.
- Code-initiated Temu fetch/XHR/image download/navigation/scroll/search/See-more counts remain zero.
- Each task follows RED → minimal implementation → GREEN → related regression → `git diff --check` → independent commit.
- All database mutations in tests use temporary sourcing SQLite and output directories. Localhost acceptance uses a fixture page, never real Temu.

---

### Task 1: Manual Price Ratio Calculator

**Files:**
- Create: `src/modules/sourcing/manual-price-assessment.mjs`
- Test: `test/unit/manual-price-assessment.test.mjs`

**Interfaces:**
- Consumes: existing `resolveReviewFx(config)` result `{status,cny_per_eur,eur_per_cny,source,as_of}`.
- Produces: `calculateManualPriceAssessment(input)` returning normalized inputs, unit prices, `price_ratio`, `formula_version:'MANUAL_PRICE_RATIO_V1'`, and validation status.

- [ ] Write failing tests for `10 EUR / 2`, `20 CNY / 4`, `fx_cny_per_eur=8` producing unit prices `5 EUR`, `5 CNY`, `0.625 EUR`, ratio `8`; assert MOQ never substitutes for pack quantity and invalid/missing FX blocks saving.
- [ ] Run `node --test test/unit/manual-price-assessment.test.mjs`; expect module-not-found failure.
- [ ] Implement strict positive-number parsing, six-decimal unit prices, two-decimal ratio, independent nullable MOQ, and error codes `TEMU_PRICE_REQUIRED`, `PACK_QUANTITY_REQUIRED`, `SUPPLIER_PRICE_REQUIRED`, `FX_RATE_REQUIRED`.
- [ ] Re-run focused test; expect PASS.
- [ ] Run `node --test test/unit/review-opportunity-calculator.test.mjs test/unit/unit-price-normalizer.test.mjs`; expect PASS.
- [ ] Run `git diff --check`; commit `feat(sourcing): add manual price ratio calculator`.

### Task 2: Additive Evidence Migration

**Files:**
- Create: `db/sourcing-migrations/005_temu_market_evidence_mvp_v1.sql`
- Test: `test/integration/temu-market-evidence-migration.test.mjs`

**Interfaces:**
- Consumes: existing `sourcing_runs` and `sourcing_run_items(run_id,temu_goods_id)` identities.
- Produces: `temu_market_evidence_sessions`, `temu_market_evidence_phases`, `temu_manual_price_assessments`, and `temu_market_evidence_requests`.

- [ ] Write migration tests for lifecycle CHECKs, composite foreign keys, one writable session partial unique index, one phase per kind, immutable assessment identity, request id uniqueness, integrity check, and foreign-key check.
- [ ] Run the focused test; expect missing-table failure.
- [ ] Add migration 005 only. Define writable statuses `CREATED,BOUND,BEFORE_CAPTURED,AFTER_CAPTURED,ASSESSED`; terminal `CLOSED`; phase statuses `CREATING,SEALED`; store bind-token hash, tab/context hash, screenshot metadata, allowlisted DOM JSON, assessment inputs/results, and request payload hashes.
- [ ] Re-run focused test; expect PASS and `integrity_check=ok`.
- [ ] Run existing sourcing migration/import/review safety tests.
- [ ] Run `git diff --check`; commit `feat(sourcing-db): add market evidence schema`.

### Task 3: Evidence Repository and Ownership State Machine

**Files:**
- Create: `src/db/repositories/temu-market-evidence-repository.mjs`
- Test: `test/integration/temu-market-evidence-repository.test.mjs`

**Interfaces:**
- Produces: `createSession`, `listSessions`, `getSession`, `consumeBindToken`, `rebindSession`, `beginPhase`, `sealPhase`, `saveAssessment`, `closeSession`.
- Every mutation consumes `{reviewRunId,anchorTemuGoodsId,sessionId,expectedRevision,requestId}` as applicable.

- [ ] Write failing tests for multiple historical sessions, one writable session, explicit identities, optimistic revision, ordered transitions, immutable phases, request replay by matching payload hash, and 409 conflict codes.
- [ ] Run focused test; expect missing repository failure.
- [ ] Implement transaction-owned state transitions. Hash one-time bind tokens with SHA-256, expire after 15 minutes, and return raw token only from creation. Implement `EVIDENCE_SESSION_CONTEXT_MISMATCH`, `EVIDENCE_SESSION_ALREADY_WRITABLE`, `EVIDENCE_SESSION_REVISION_CONFLICT`, and phase-order errors.
- [ ] Re-run focused test; expect PASS.
- [ ] Run sourcing Review repository/safety regression tests and assert frozen candidate tables are absent from SQL traces.
- [ ] Run `git diff --check`; commit `feat(sourcing): add evidence session state machine`.

### Task 4: Atomic Evidence Phase Service and Safe File Store

**Files:**
- Create: `src/modules/sourcing/temu-market-evidence-service.mjs`
- Create: `src/modules/sourcing/evidence-screenshot-store.mjs`
- Test: `test/integration/temu-market-evidence-phase.test.mjs`

**Interfaces:**
- Consumes repository plus `screenshotRoot` configured server-side.
- Produces `savePhase({identities,phase,pageContext,safeRegion,pngBase64,cards})`, `getEvidence`, `readScreenshot`, and `saveAssessment`.

- [ ] Write failing tests using a 1×1 fixture PNG expanded with declared dimensions: safe-region validation, PNG signature/SHA/size, allowlisted bounded cards, deterministic ordering/delta, path containment, max two screenshots, and screenshot+DOM atomic rollback with zero visible rows/files.
- [ ] Run focused test; expect missing service failure.
- [ ] Implement server-derived paths, temporary file creation, controlled rename, transaction rollback cleanup, SEALED-only reads, startup orphan-temp cleanup, payload bounds, context matching, and calculator-backed append-only assessments.
- [ ] Re-run focused test; expect PASS.
- [ ] Run sourcing Review, filesystem safety, and deterministic artifact regressions.
- [ ] Run `git diff --check`; commit `feat(sourcing): save atomic passive market evidence`.

### Task 5: Strict Review Evidence API

**Files:**
- Create: `src/server/controllers/temu-market-evidence-controller.mjs`
- Modify: `src/server/router.mjs`
- Modify: `src/server/index.mjs`
- Test: `test/integration/temu-market-evidence-api.test.mjs`

**Interfaces:**
- Produces the exact routes in Design §11, JSON errors through the existing router, and screenshot byte responses.
- Extension consume/capture routes accept explicit session identities and extension CORS; Review mutations require local origin.

- [ ] Write failing HTTP tests for create/list/read/close/bind/rebind/phase/screenshot/assessment, unsupported verbs, payload limits, request-id idempotency, current Review goods mismatch, and zero-write 409/422 responses.
- [ ] Run focused API test; expect 404 routes.
- [ ] Wire the controller and service without modifying Catalog controllers or routes. Add only narrowly scoped extension CORS paths and server-derived screenshot root under the sourcing data directory.
- [ ] Re-run focused API test; expect PASS.
- [ ] Run router, sourcing Review API, Catalog API, and health identity regressions.
- [ ] Run `git diff --check`; commit `feat(api): expose scoped Temu evidence routes`.

### Task 6: Extension Explicit Binding and Safe Crop

**Files:**
- Create: `browser-extension/temu-market-evidence.js`
- Modify: `browser-extension/background.js`
- Modify: `browser-extension/content-script.js`
- Modify: `browser-extension/manifest.json`
- Modify: extension overlay/popup files only for a dedicated evidence section
- Test: `test/unit/temu-market-evidence-extension.test.mjs`

**Interfaces:**
- Produces `detectSafeEvidenceRegion(document)`, `extractPassiveEvidenceCards(document)`, `cropVisibleScreenshot(dataUrl,region,viewport)`, and explicit bind/capture actions.
- Background provides only local API proxy and `chrome.tabs.captureVisibleTab` after an explicit action.

- [ ] Write failing tests with fixture DOM for safe product-area detection, forbidden-header exclusion, overlay hide/restore in `finally`, deterministic card extraction, navigation/query invalidation, and no fallback when a safe region is missing.
- [ ] Instrument forbidden methods (`fetch` to Temu, XHR, scroll, navigation, See-more click, image loader) and assert zero invocations.
- [ ] Implement bind-token input, fixed tab binding, BEFORE/AFTER buttons, local canvas crop, PNG submission, and readable errors. Do not add automation timers or Temu network access.
- [ ] Re-run focused extension tests; expect PASS.
- [ ] Run all existing extension/manual-bind/catalog capture regressions and `npm run check:network-capture`.
- [ ] Run `git diff --check`; commit `feat(extension): capture explicit passive search evidence`.

### Task 7: Review Evidence Client State

**Files:**
- Create: `ui/temu-market-evidence-state.js`
- Test: `test/unit/temu-market-evidence-ui-state.test.mjs`

**Interfaces:**
- Produces `createTemuMarketEvidenceState({api,runId,onChange})` with `selectGoods`, session CRUD, calculator mutation, save assessment, and `saveAndNext` callback.

- [ ] Write failing tests proving state is keyed by run/goods/session, stale async responses cannot overwrite a newly selected goods, old sessions become read-only, explicit return can restore writability only on complete context match, and save-and-next invokes no open/search/session-create action.
- [ ] Run focused test; expect module-not-found failure.
- [ ] Implement isolated evidence state, request sequence cancellation, explicit revision propagation, local dynamic calculator calls, and deterministic query suggestion from the current Temu title without remote calls.
- [ ] Re-run focused test; expect PASS.
- [ ] Run existing sourcing Review UI state, visual index, and Random5 tests.
- [ ] Run `git diff --check`; commit `feat(review): add market evidence UI state`.

### Task 8: Existing Review Page Integration

**Files:**
- Modify: `ui/sourcing-review.html`
- Modify: `ui/sourcing-review.js`
- Modify: `ui/sourcing-review.css`
- Test: `test/integration/temu-market-evidence-review-ui.test.mjs`

**Interfaces:**
- Consumes Task 7 state and Task 5 API.
- Adds only the `Temu人工搜索比价 MVP` section to the current middle panel.

- [ ] Write DOM integration tests for query/session/bind token, readable phase statuses, local screenshot preview, card/delta rendering, Temu reference selection, manual override, Random5 import, MOQ separation, dynamic `价格倍率`, save, and save-and-next stop behavior.
- [ ] Run focused UI test; expect missing controls.
- [ ] Add namespaced `market-evidence-*` DOM, render functions, and listeners. Keep existing Review goods/candidate/visual-index controls unchanged. Remote Temu image URLs are text-only and never assigned to image `src`.
- [ ] Re-run focused UI test; expect PASS.
- [ ] Run all sourcing Review UI/integration regressions and static syntax checks.
- [ ] Run `git diff --check`; commit `feat(review-ui): add Temu market evidence workflow`.

### Task 9: Fixture Acceptance and Final Verification

**Files:**
- Create: `test/fixtures/temu-market-evidence-search.html`
- Create: `test/integration/temu-market-evidence-e2e.test.mjs`
- Create: `docs/superpowers/reports/2026-09-03-temu-market-evidence-mvp-v1-final.md`

**Interfaces:**
- Exercises the full local fixture flow without opening Temu.

- [ ] Write the end-to-end fixture test: create Review session, consume explicit token, bind fixture tab identity, atomic BEFORE, simulated operator-only DOM expansion, atomic AFTER, select price, import one Random5 candidate, manually confirm supplier price, save assessment, save-and-next, and verify no automatic action.
- [ ] Run focused E2E; fix only defects with a new failing assertion first.
- [ ] Run all new feature tests and require 100% PASS.
- [ ] Run all related sourcing Review, Random5, extension, router, Catalog manual-bind, and frozen candidate-ledger regressions.
- [ ] Run `npm test`; compare failures by file/test/error and require no new failures.
- [ ] Start localhost Dashboard only against temporary fixture/copy databases, open `/sourcing-review.html`, verify the section and fixture workflow, then stop only the process started by this task.
- [ ] Audit repository for forbidden automated Temu APIs and frozen-field changes. Verify `NEW_FEATURE_MIGRATIONS=[db/sourcing-migrations/005_temu_market_evidence_mvp_v1.sql]` and `FROZEN_SNAPSHOT_MIGRATIONS=0`.
- [ ] Run `git diff --check`; commit `docs: verify Temu market evidence MVP` and return the complete handoff manifest. Do not push or resume frozen work.
