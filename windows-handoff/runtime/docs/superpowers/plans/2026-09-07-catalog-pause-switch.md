# Catalog Pause and Switch Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution.

**Goal:** Operator-controlled suspension of an exact Initial task without losing collected products, followed by existing explicit category entry.

**Architecture:** Reuse operator-entry continuation. A synchronous SQLite transaction checks exact scope, queue generation and process activity, changes Campaign to paused, Queue/Source to pending, finishes the open run without resetting metrics, clears binding and claim, and records the request in Campaign config. A separate explicit click starts/continues the selected category. No automatic takeover or collection.

**Tech Stack:** Node SQLite, existing HTTP router, Catalog root-rendered module.

**Spec:** Approved conversation design: safe pause → select category → explicit start/continue → manual detect/bind/capture.

## Constraints

- Fixture databases only; no production mutation, migration, restart or push during development.
- No cancellation, deletion, global latest lookup, taxonomy or frozen Snapshot changes.
- Initial continuation reuses existing Campaign/Queue/Source; new run only after the old run is finished.
- Reject busy, ambiguous, wrong-scope, stale-generation and unsupported task types with zero writes.
- Binding invalidation must survive continuation: bindings older than the latest suspension cannot submit.
- Expansion creation remains existing explicit count flow; do not add an unreviewed Expansion resume state machine.

## Task 1 — Atomic Initial suspension

Files: `src/modules/catalog-scale/operator-entry-service.mjs`, `catalog-campaign-service.mjs`; test `test/integration/catalog-pause-switch.test.mjs`.

- [ ] RED: call `pauseOperatorInitial({profile,campaignId,queueId,expectedClaimGeneration,requestId})`; assert paused/pending/pending, null claim, finished run, unchanged metrics, replay zero writes, busy/wrong identity rejection and rollback.
- [ ] Run `node --test test/integration/catalog-pause-switch.test.mjs` and observe missing method failure.
- [ ] Add transactional service using `transaction(db, fn)`, `readChildren`, explicit SQL generation guard, append `operatorPause` entries to config; record binding invalidation timestamp. Check all activity flags except idle binding.
- [ ] GREEN and related `catalog-explicit-entry.test.mjs`; `git diff --check`; commit.

## Task 2 — Explicit scoped HTTP API

Files: `src/server/controllers/catalog-controller.mjs`, `src/server/router.mjs`, `ui/modules/catalog/api.js`; test `test/integration/catalog-pause-switch-api.test.mjs`.

- [ ] RED: POST `/api/catalog/operator/initial-campaigns/:id/pause`; wrong path/body identity produces zero writes; GET does not mutate; success returns exact Campaign and generation.
- [ ] Add `pauseOperatorInitial` controller registry lookup, local-origin route, and `pauseInitial(id,body)` client.
- [ ] GREEN, existing Entry HTTP regression; `git diff --check`; commit.

## Task 3 — Catalog button and final regression

Files: `ui/modules/catalog/panel.js`; test `test/unit/catalog-pause-switch-ui.test.mjs`.

- [ ] RED: switching selection never pauses automatically; confirmed button sends current task identity (not selected target), repeated click sends once, failure retains request identity; no create/bind/capture calls.
- [ ] Add local busy/request state, confirmation, generation in current context, refresh protection and success guidance. Only offer suspension for supported Initial tasks. Keep selected target unchanged.
- [ ] GREEN; Catalog dual-module/Entry tests; full suite with fixture environment and baseline comparison; `git diff --check`; commit.
- [ ] Report development result, deployment still pending, no production task action.

## Execution record

2026-09-07: Tasks 1–3 implemented on `codex/catalog-pause-switch-v1`. Original checklists above preserve the planned sequence. Service, HTTP and UI RED failures were observed before each implementation; final targeted tests pass. Full suite: 861 tests, 852 pass, 2 skipped, exactly the same 7 known baseline failures (two Excel/reset fixture assertions and five image-cache fixture assertions), no new failures. `npm run check` and `git diff --check` pass.

Additional audited dependency: Initial preview export now holds activity registration until its promise settles, so pause cannot race an asynchronous export. Source-run counters are preserved on finish. Old bound-at evidence is rejected after a pause even after continuation.

No production database writes, migration, capture, restart, stable merge or push. Stable remains `230c4fc`. Deployment and real operator acceptance are pending. The new button is deliberately scoped to Initial Campaigns; existing Expansion creation remains unchanged, and Expansion suspension/resume is not claimed by this delivery.
