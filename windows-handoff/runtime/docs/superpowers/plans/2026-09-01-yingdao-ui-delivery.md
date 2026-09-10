# YingDao UI Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the validated YingDao / 1688 sourcing UI into the Catalog shared Operator shell as a namespace-, state-, polling-, API-, and database-isolated module.

**Architecture:** Start from Catalog shared baseline `b36056a`, restore the already-validated sourcing core without rewriting it, then extract the homepage sourcing controls into `ui/modules/yingdao/*`. The shared shell performs one import and one mount; all rendering, state, API calls, errors, controls, and polling remain module-private.

**Tech Stack:** Node.js ESM, browser DOM modules, native `fetch`, Node test runner, SQLite, existing local Operator server.

**Spec:** `docs/superpowers/specs/2026-09-01-yingdao-ui-delivery-contract-design.md`

## Global Constraints

- Do not modify Catalog state machines, Catalog repository writes, Random5 semantics, review transactions, Sheet05, or validated sourcing identities.
- Preserve `/api/sourcing/*`, `/api/sourcing/review/*`, `/sourcing-review.html`, the eight-column YingDao workbook, and real run `yingdao_random5_v1_20260831_001`.
- All YingDao DOM/CSS/data namespaces are `yingdao-*`; state and timers are private.
- Shared files receive only mount/import/style/route compatibility edits.
- Do not stage the nine known CRLF migration diffs. Do not push.

---

### Task Y1: Existing sourcing baseline and characterization

**Files:**
- Restore from validated commits: sourcing migrations, modules, controllers, Review Console, tests, and safety verifier
- Create: `test/unit/yingdao-existing-ui-characterization.test.mjs`

**Interfaces:**
- Consumes: Catalog baseline `b36056a`
- Produces: validated `/api/sourcing/*`, `/sourcing-review.html`, and legacy homepage behavior ready for extraction

- [ ] Write a failing characterization test asserting that the Catalog baseline lacks the sourcing settings/import/review routes and homepage entry.
- [ ] Run `node --test test/unit/yingdao-existing-ui-characterization.test.mjs`; expect route/entry assertions to fail.
- [ ] Bring in commits `717ed93..21dcdac` selectively, resolving shared files by preserving Catalog mounts and restoring only sourcing behavior.
- [ ] Run sourcing migration/import/review tests and the characterization test; expect PASS.
- [ ] Run `git diff --check`, stage only sourcing files, and commit `test: characterize existing YingDao delivery`.

### Task Y2: DOM module skeleton and namespace

**Files:**
- Create: `ui/modules/yingdao/panel.js`
- Create: `ui/modules/yingdao/yingdao.css`
- Create: `test/fixtures/yingdao-panel-dom-fixture.mjs`
- Create: `test/unit/yingdao-module-namespace.test.mjs`

**Interfaces:**
- Produces: `mountYingdaoPanel({root,...})`, `refreshYingdaoPanel()`, controller `{refresh,destroy,getState}`

- [ ] Write RED tests for idempotent same-root mount, second-root rejection, root-only destroy, `yingdao-*` IDs/classes, and refresh-before-mount rejection.
- [ ] Run the namespace test; expect missing module/export failures.
- [ ] Implement minimal markup and mount lifecycle; never call `document.body.innerHTML` or query Catalog IDs.
- [ ] Run the namespace and Catalog dual-module tests; expect PASS.
- [ ] Run `git diff --check` and commit `feat: establish YingDao UI module boundary`.

### Task Y3: Private state, model, and API extraction

**Files:**
- Create: `ui/modules/yingdao/state.js`
- Create: `ui/modules/yingdao/model.js`
- Create: `ui/modules/yingdao/api.js`
- Create: `test/unit/yingdao-state-api.test.mjs`

**Interfaces:**
- Produces: private `yingdaoState`, detached frozen snapshots, `createYingdaoApi({fetchImpl})`, and view-model/control derivation

- [ ] Write RED tests requiring approved state keys (`currentRun`, `selectedTask`, `loading`, `error`, `progress`, `random5`, `imageCache`, `exportStatus`, `importStatus`, `scanStatus`, `reviewSummary`) and exact sourcing URLs.
- [ ] Assert unknown Catalog/business keys are rejected and API errors preserve code/message.
- [ ] Implement minimal immutable snapshots, patch validation, model formatting, and sourcing-only API client.
- [ ] Run the state/API tests and existing sourcing UI-state tests; expect PASS.
- [ ] Run `git diff --check` and commit `refactor: isolate YingDao state model and API`.

### Task Y4: Polling, loading, and error isolation

**Files:**
- Modify: `ui/modules/yingdao/panel.js`
- Create: `test/unit/yingdao-polling-isolation.test.mjs`

**Interfaces:**
- Consumes: module state/API
- Produces: private `yingdaoPollingTimer`, coalesced `refresh()`, isolated error rendering

- [ ] Write RED tests for one timer per mount, coalesced refresh, YingDao-only clearInterval, and Catalog root/state/control preservation on loading/error/refresh/destroy.
- [ ] Run tests; expect timer and refresh failures.
- [ ] Implement one private timer, in-flight promise coalescing, and root-local render/error paths.
- [ ] Run YingDao and Catalog polling-isolation suites; expect PASS.
- [ ] Run `git diff --check` and commit `feat: isolate YingDao polling lifecycle`.

### Task Y5: Existing sourcing/import controls inside the module

**Files:**
- Modify: `ui/modules/yingdao/panel.js`
- Modify: `ui/modules/yingdao/model.js`
- Modify: `ui/modules/yingdao/yingdao.css`
- Create: `test/unit/yingdao-panel.test.mjs`

**Interfaces:**
- Consumes: existing settings/path-dialog/scan/import/retry APIs
- Produces: namespaced controls with unchanged scan/import/retry semantics

- [ ] Write RED tests for settings render, path dirty→`SCAN_STALE`, scan token forwarding, import gating, failed-image retry gating, and YingDao-only disabled controls.
- [ ] Run tests; expect missing handlers/rendering failures.
- [ ] Move the existing source path, preview, metrics, scan/import/retry rendering and handlers into the module without changing payloads.
- [ ] Run panel, controller, import-service, and path-dialog regressions; expect PASS.
- [ ] Run `git diff --check` and commit `feat: mount sourcing import controls in YingDao module`.

### Task Y6: Review summary and Review Console entry

**Files:**
- Modify: `ui/modules/yingdao/panel.js`
- Modify: `ui/modules/yingdao/api.js`
- Create: `test/unit/yingdao-review-entry.test.mjs`

**Interfaces:**
- Consumes: `GET /api/sourcing/review/bootstrap`
- Produces: overview summary and link to `/sourcing-review.html`; no review mutation on homepage

- [ ] Write RED tests for current run/goods/candidates/review counts, exact independent-page link, and absence of mutation calls.
- [ ] Implement summary refresh and namespaced link/card.
- [ ] Run Review Console UI/API/service regressions; expect 50/250 behavior preserved.
- [ ] Run `git diff --check` and commit `feat: expose Review Console from YingDao panel`.

### Task Y7: Minimal shared-shell wiring and legacy removal

**Files:**
- Modify: `ui/index.html`
- Modify: `ui/app.js`
- Modify: `ui/styles.css`
- Create: `test/unit/yingdao-app-shell.test.mjs`

**Interfaces:**
- Consumes: `#yingdao-module-root`, `mountYingdaoPanel`
- Produces: one module import/mount and zero legacy YingDao implementation

- [ ] Re-check `git status` and shared-file diffs; stop on new foreign shared edits.
- [ ] Write RED tests asserting one YingDao stylesheet, one import, one mount, no legacy `sourcingModel`, `refreshSourcing`, sourcing DOM map, handlers, or second timer.
- [ ] Remove legacy YingDao markup/logic/styles while preserving Catalog import/mount and legacy Dashboard polling byte-for-byte outside the integration seam.
- [ ] Run shared-shell, Catalog app-shell, and duplicate-implementation tests; expect PASS.
- [ ] Run `git diff --check` and commit `refactor: wire YingDao module into shared shell`.

### Task Y8: Strict Catalog scoped read dependency

**Files:**
- Modify: `ui/modules/yingdao/api.js`
- Modify: `ui/modules/yingdao/state.js`
- Create: `test/unit/yingdao-catalog-read-boundary.test.mjs`
- Create: `test/integration/yingdao-catalog-pool-read.test.mjs`

**Interfaces:**
- Produces: `readCatalogPoolProducts({poolVersionId,categoryKey,categoryProfileVersion})`

- [ ] Write RED tests for the exact GET URL/query tuple and rejection of missing identity, wrong category/profile, unknown pool, fallback keys, and every Catalog mutation URL.
- [ ] Snapshot protected Catalog table digests before/after the read.
- [ ] Implement the strict read method and optional copied source context; do not add a Catalog repository writer.
- [ ] Run strict pool API and zero-write tests; expect PASS and unchanged digests.
- [ ] Run `git diff --check` and commit `feat: consume strict Catalog pool read contract`.

### Task Y9: Cross-module isolation verifier

**Files:**
- Create: `test/unit/yingdao-catalog-isolation.test.mjs`
- Create: `scripts/1688/verify-yingdao-ui-delivery.mjs`

**Interfaces:**
- Produces: machine-readable gates for DOM IDs, routes, polling owners, implementations, roots, and Catalog write boundary

- [ ] Write RED tests simulating YingDao/Catalog refresh, loading, error, polling start/stop, and destroy in both directions.
- [ ] Add static checks for duplicate IDs/routes/timers and `run_id !== campaign_id`.
- [ ] Implement the verifier and fixtures without coupling either module to the other.
- [ ] Run the isolation verifier and both module suites; expect all gates PASS/0.
- [ ] Run `git diff --check` and commit `test: verify YingDao and Catalog UI isolation`.

### Task Y10: Real read-only Review V1 regression and shared server smoke

**Files:**
- Create: `test/integration/yingdao-ui-delivery-smoke.test.mjs`
- Modify: `scripts/1688/verify-yingdao-ui-delivery.mjs`

**Interfaces:**
- Consumes: real sourcing and Temu DB read-only, shared port 37821
- Produces: 50/250 identity and one-server smoke evidence

- [ ] Write RED assertions for GET `/`, `/sourcing-review.html`, nested module assets, 50 goods, 250 candidates, zero mapping errors, integrity ok/FK0, unchanged Random5/ranks, and zero real mutation.
- [ ] Health-check 37821; reuse only a compatible Operator process and block unknown listeners.
- [ ] Complete the verifier/smoke harness and run against the real databases read-only.
- [ ] Run all sourcing/review/Catalog related regressions and `npm run check`; expect no new failures.
- [ ] Run `git diff --check` and commit `test: validate shared YingDao Operator delivery`.

### Task Y11: Delivery manifest and final verification

**Files:**
- Create: `docs/superpowers/manifests/2026-09-01-yingdao-ui-delivery-manifest.md`
- Create: `docs/superpowers/verification/2026-09-01-yingdao-ui-delivery.md`

**Interfaces:**
- Produces: integration handoff for the Catalog window and final evidence

- [ ] Generate the manifest with mount, entries, namespaces, APIs, events, Catalog reads/writes, owned/shared files, server contract, commit list, and integration instructions.
- [ ] Record shared-file changes explicitly and list the one known unrelated Catalog baseline failure.
- [ ] Run focused new tests, related regressions, `npm test`, `npm run check`, verifier, real 50/250 safety gate, and `git diff --check`.
- [ ] Confirm no migration CRLF files are staged, no push occurred, and worktree is clean after the docs commit.
- [ ] Commit `docs: publish YingDao UI delivery manifest` and stop.
