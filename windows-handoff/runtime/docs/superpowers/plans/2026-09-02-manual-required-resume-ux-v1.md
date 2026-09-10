# Girls' Sets Manual Required Resume UX V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely resume the one explicit Girls' Sets initial Campaign and make the Manual Bind overlay require recovery, redetection, and a persisted bind checkpoint before capture can be enabled.

**Architecture:** Reuse the existing `/api/catalog-extension/resume` contract. Extend the extension runner with an explicit `RECOVERY_REQUIRED` state and a single recovery action, keep server status authoritative, and make binding a two-phase local commit. No new server route, Campaign, Queue, or product write path is introduced.

**Tech Stack:** Node.js test runner, MV3 Chrome extension JavaScript, existing Catalog service and SQLite repository.

**Spec:** `/Users/chuangyangdianzi/.codex/attachments/3242f2f3-a14f-4a33-8620-48317dd715f2/pasted-text.txt`

## Global Constraints

- Resume only `catalog_campaign_37e57e89cdaf4408b9c6fff761afcca6` after a final production identity recheck.
- Never create, cancel, or delete a Campaign/Queue/Source; never write products, memberships, pools, snapshots, QA, Excel, Motorcycle, or YingDao data.
- Browser binding success requires a persisted server checkpoint.
- Recovery invalidates all detection and binding state and requires explicit redetection and rebinding.
- Real acceptance must stop before clicking “采集当前页面”.
- Feature and stable pushes are ordinary fast-forward pushes only.

---

### Task 1: Existing resume contract and checkpoint reset semantics

**Files:**
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`
- Modify: `test/integration/catalog-rpa.test.mjs`

**Interfaces:**
- Consumes: `resumeExtensionRunner(input)` and repository transition helpers.
- Produces: an atomic resume result with Campaign `running`, Source/Queue `opening`, cleared errors, and checkpoint fields expressing `UNBOUND` manual passive recovery.

- [ ] Add an integration test that transitions a fixture to `manual_required`, resumes it through the extension contract, and asserts all three statuses, cleared errors, no duplicate Campaign/Queue, and invalidated binding fields.
- [ ] Run the exact integration test and verify RED on stale checkpoint semantics.
- [ ] Make the smallest service change inside the existing transaction boundary.
- [ ] Run the focused test and related Catalog RPA regressions; run `git diff --check`.
- [ ] Commit as `fix: reset manual binding on catalog resume`.

### Task 2: Runner recovery state and two-phase binding

**Files:**
- Modify: `browser-extension/catalog-manual-passive-runner.js`
- Modify: `browser-extension/background.js`
- Modify: `test/unit/catalog-manual-passive-runner.test.mjs`

**Interfaces:**
- Consumes: `RESUME_CATALOG_RUNNER` background message and `getContext()`.
- Produces: `recoverCurrentTask()`, `RECOVERY_REQUIRED`, server-authoritative refresh, and bind commit only after checkpoint success.

- [ ] Add unit tests for manual-required restore, detect-only non-resume, blocked bind/capture, successful/failed/idempotent recovery, and successful/failed binding checkpoint ordering.
- [ ] Run the focused test and verify RED for the missing state/action.
- [ ] Implement the minimum runner and background adapter changes.
- [ ] Run focused and related extension regressions; run `git diff --check`.
- [ ] Commit as `fix: gate manual bind behind campaign recovery`.

### Task 3: Recovery-required operator UI

**Files:**
- Modify: `browser-extension/catalog-operator-view-model.js`
- Modify: `browser-extension/catalog-operator-overlay.js`
- Modify: `test/unit/catalog-operator-view-model.test.mjs`
- Modify: `test/unit/catalog-operator-overlay.test.mjs`

**Interfaces:**
- Consumes: runner `RECOVERY_REQUIRED` snapshots and `recoverCurrentTask()`.
- Produces: Chinese recovery copy, `temu-catalog-recover`, disabled bind/capture controls, and truthful post-resume UNBOUND rendering.

- [ ] Add view-model and markup/action tests covering recovery visibility and all button gates.
- [ ] Run focused tests and verify RED.
- [ ] Implement minimal model/markup/wiring changes without touching YingDao UI.
- [ ] Run focused and browser-extension regressions; run `git diff --check`.
- [ ] Commit as `fix: show catalog recovery-required state`.

### Task 4: Final regression, integration, and production acceptance

**Files:**
- Modify only if verification reveals a requirement defect; any fix must start with a failing test.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: pushed feature/stable heads and a browser left at BOUND with capture enabled but not executed.

- [ ] Run new feature tests, related Catalog/YingDao regressions, `npm run check`, full suite, and compare the exact known baseline failure set.
- [ ] Push the feature branch normally, fast-forward stable after refetch/recheck, rerun verification, and push stable normally.
- [ ] Recheck the one production Campaign and before-counts, reload the stable extension, then invoke only the recovery, detection, and binding actions.
- [ ] Verify Campaign/Queue/Source status, persisted checkpoint, zero protected-data count changes, and zero capture writes.
- [ ] Leave the Girls' Sets page open with capture enabled and report the exact final template.
