# YingDao Excel-Wide Visual Retrieval & Multi-Run Review V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, workbook-wide semantic visual index and safe multi-run Review workflow without remote vision calls or Catalog writes.

**Architecture:** Extract all Sheet 05 goods and embedded images from the selected run workbook, preprocess locally, embed with fixed macOS Vision FeaturePrint revision 2, combine cosine similarity with dHash and metadata warnings, and persist an atomic versioned index. Review APIs load matches lazily and map them to run lifecycle state while mutations remain strictly current-run scoped.

**Tech Stack:** Node.js ESM, Sharp, JSZip, Swift 6/macOS Vision, SQLite read-only repositories, vanilla browser JS/CSS, node:test.

**Spec:** `docs/superpowers/specs/2026-09-01-yingdao-excel-visual-retrieval-multirun-v1-design.md`

## Global Constraints

- Visual universe is the selected run workbook Sheet 05, never the current 50 goods.
- OpenAI and remote vision calls are zero; model/index artifacts are not committed.
- No Catalog files, routes, state, polling, schema, or core tables are changed.
- No Review smoke mutation; existing selections, notes, exclusions, images, and Random5 order remain unchanged.
- No hardcoded Review run ID or system-wide 50/250 count.
- Existing supplier path/SHA/JPEG/decode safety remains unchanged.

---

### Task 1: Workbook visual universe

**Files:** Create `src/modules/sourcing/visual-workbook-universe.mjs`; modify `src/modules/sourcing/random5-workbook.mjs`; test `test/unit/visual-workbook-universe.test.mjs`.

**Interfaces:** Produces `loadVisualWorkbookUniverse({workbookPath, artifact})` and reusable `readSheet05PackageSemantics()`.

- [ ] Write tests for exact Sheet 05 headers, full-row extraction, embedded image-to-goods mapping, duplicate rejection, missing image status, and workbook-bound fingerprint.
- [ ] Run the test and confirm RED because the loader does not exist.
- [ ] Export the existing package semantics helper and implement the minimal universe loader.
- [ ] Run focused workbook and Sheet 11 regression tests GREEN.
- [ ] Run `git diff --check` and commit `feat: extract workbook wide visual universe`.

### Task 2: Local Vision embedding backend

**Files:** Create `tools/yingdao-vision-embed.swift`, `src/modules/sourcing/local-visual-embedding.mjs`; test `test/unit/local-visual-embedding.test.mjs`.

**Interfaces:** Produces `createLocalVisualEmbeddingBackend({cacheRoot, runProcess})` with `info()`, `embedBatch(jobs)`, and deterministic compile identity.

- [ ] Write tests proving fixed revision/model identity, normalized 768D vectors, cache identity, failed backend error, and zero network dependency.
- [ ] Run RED.
- [ ] Implement compiled JSONL Swift sidecar and Node process wrapper with no shell interpolation.
- [ ] Run fixture and real single-image GREEN plus regression.
- [ ] Run `git diff --check` and commit `feat: add local vision embedding backend`.

### Task 3: Deterministic preprocessing and pHash

**Files:** Create `src/modules/sourcing/visual-image-features.mjs`; test `test/unit/visual-image-features.test.mjs`.

**Interfaces:** Produces `preprocessVisualImage()`, `computeDHash64()`, `hammingDistance64()`, and `PREPROCESSING_VERSION`.

- [ ] Write RED tests for JPEG normalization, decode failure, deterministic hash, near duplicate distance, and path-independent output.
- [ ] Implement Sharp 224x224 sRGB preprocessing and 64-bit dHash.
- [ ] Run GREEN and image safety regression.
- [ ] Run `git diff --check` and commit `feat: add deterministic visual image features`.

### Task 4: Atomic visual index

**Files:** Create `src/modules/sourcing/visual-index-store.mjs`, `scripts/1688/build-visual-index.mjs`; modify `.gitignore`, `package.json`; test `test/unit/visual-index-store.test.mjs`.

**Interfaces:** Produces `createVisualIndexStore({cacheRoot, embeddingBackend})` with `status()`, `build()`, and `loadReady()`.

- [ ] Write RED tests for identity, READY/STALE, idempotency, failed-build preservation, vector/count QA, and Review-state non-invalidation.
- [ ] Implement temp build, thumbnails, JSONL/binary artifacts, validation, and atomic activation.
- [ ] Run GREEN and verify generated artifacts are ignored.
- [ ] Run `git diff --check` and commit `feat: build atomic workbook visual index`.

### Task 5: Anchor-centric retrieval

**Files:** Create `src/modules/sourcing/visual-retrieval.mjs`; test `test/unit/visual-retrieval.test.mjs`.

**Interfaces:** Produces `queryVisualIndex({index, anchorGoodsId, topK, threshold})`.

- [ ] Write RED tests for self exclusion, thresholds, stable order, pHash boost, metadata conflict, input reversal, and taxonomy-not-sufficient behavior.
- [ ] Implement cosine-first scoring, dHash signal, metadata warning/penalty, reasons, and deterministic order.
- [ ] Run GREEN and regression.
- [ ] Run `git diff --check` and commit `feat: query workbook visual neighbors deterministically`.

### Task 6: Multi-run lifecycle and dynamic counts

**Files:** Modify sourcing repositories/service/server bootstrap and `ui/sourcing-review.js`; create `src/modules/sourcing/review-lifecycle-mapper.mjs`; tests in Review service/state suites.

**Interfaces:** Produces run metadata count validation and `mapReviewLifecycle(matches, runs, plan)`.

- [ ] Write RED tests for 17x5 final batch, metadata counts, missing run URL, cross-run mapping, unresolved plan, and cross-run mutation rejection.
- [ ] Remove global 50/250 and hardcoded run fallback; load Review services by requested run safely.
- [ ] Implement read-only lifecycle mapping without inventing plan goods.
- [ ] Run GREEN and existing mutation/409 regression.
- [ ] Run `git diff --check` and commit `feat: support dynamic multi run sourcing review`.

### Task 7: Lazy visual APIs and safe images

**Files:** Modify Review controller/router/server; create `src/modules/sourcing/visual-index-images.mjs`; tests in `test/integration/server-sourcing-review.test.mjs` and safety suites.

**Interfaces:** Adds visual matches/status/build and workbook-scoped image GET endpoints.

- [ ] Write RED tests for lazy response contract, run/index binding, traversal, malformed encoding, arbitrary path rejection, realpath containment, signature/decode, and old image routes.
- [ ] Implement endpoint/controller wiring and safe thumbnail resolver.
- [ ] Run GREEN, supplier image regression, and route-collision checks.
- [ ] Run `git diff --check` and commit `feat: expose safe lazy visual review api`.

### Task 8: Visual market metrics and ratios

**Files:** Create `src/modules/sourcing/visual-market-metrics.mjs`; modify Review opportunity service/calculator; tests in calculator and service suites.

**Interfaces:** Produces `calculateVisualMarketMetrics()` and feeds `visual_market_min_reliable_unit_price_eur` to opportunity calculations.

- [ ] Write RED tests for reliable-only samples, anchor/other minimum, deterministic median, metadata exclusion, MOQ separation, and risk-band precedence.
- [ ] Implement metrics and visual-market ratio integration while preserving FX and conservative quantity parsing.
- [ ] Run GREEN and prior opportunity regression.
- [ ] Run `git diff --check` and commit `feat: compare sourcing costs with visual market prices`.

### Task 9: Review state and UI

**Files:** Modify `ui/sourcing-review-state.js`, `ui/sourcing-review.js`, `ui/sourcing-review.html`, `ui/sourcing-review.css`; tests in Review state/UI suites.

**Interfaces:** Adds private visual index/matches/loading/error/expanded/preview state and lazy accordion rendering.

- [ ] Write RED tests for NOT_BUILT/BUILDING/READY/STALE/FAILED, lazy load, six collapsed/twenty expanded, preview-only image clicks, current-run switch, cross-run URL, and no-run disabled mutations.
- [ ] Implement accessible accordion, cards, metrics bar, preview, lifecycle actions, and YingDao-only build controls.
- [ ] Run GREEN, existing Review UI regression, duplicate DOM and Catalog isolation.
- [ ] Run `git diff --check` and commit `feat: render excel wide visual review matches`.

### Task 10: Stabilization and integration regression

**Files:** Modify only affected tests/static path conversion if production behavior requires it; add `test/integration/sourcing-review-visual-index.test.mjs` and safety verifier.

**Interfaces:** Produces deterministic end-to-end verification and exact baseline comparison.

- [ ] Add integration tests for current 50/250 preservation, images, selections, Random5 order, zero Catalog writes, Unicode paths, and 50-repeat isolation.
- [ ] Reproduce both known new failures RED.
- [ ] Fix URL pathname decoding with containment unchanged and replace timestamp flake with deterministic business-state assertion.
- [ ] Run focused, related regression, `npm run check`, `git diff --check`, then full suite and compare exact seven failures by file/test/reason.
- [ ] Commit `test: stabilize excel visual review integration`.

### Task 11: Real index and page acceptance

**Files:** No committed production changes; artifacts stay in configured ignored cache; screenshot is outside repository.

**Interfaces:** Uses build CLI and live Review endpoints.

- [ ] Hash production DBs/workbook and record Review selections/notes/exclusions before acceptance.
- [ ] Build the real selected-workbook index and capture counts, fingerprints, model identity, duration, and zero remote calls.
- [ ] Controlled-restart only the verified stable-runtime dashboard and verify `/api/health` identity.
- [ ] Select a real anchor with matches and five candidates, open explicit run/goods URL, expand visual accordion, preview one image, and capture the screenshot outside the repository.
- [ ] Re-hash data, prove no mutations/Catalog writes, keep Dashboard/page open, and report Final Verification.
