# Temu Market Evidence MVP V1 — Final Verification

## Scope

Implemented a passive, operator-triggered Temu market-evidence workflow owned by an explicit `review_run_id + anchor_temu_goods_id + session_id`. The implementation does not navigate Temu, click See more, run searches, or capture without an operator action.

The frozen Initial Candidate Snapshot + Image Cache V1 design and plan were not changed and its implementation tasks were not started.

## Delivered

- Additive sourcing migration `005_temu_market_evidence_mvp_v1.sql`.
- Explicit evidence-session lifecycle and optimistic revision checks.
- One-time binding token tied to the exact Review run and anchor goods.
- Atomic BEFORE/AFTER phase persistence: cropped PNG plus canonical DOM cards either both seal or both leave zero writes.
- Safe screenshot region detection that hard-fails without falling back to the full viewport.
- Retina-aware screenshot scaling with consistent X/Y scale validation.
- Manual Temu/1688 pack-unit price assessment and explicit FX provenance.
- Strict `/api/sourcing/review/...` routes and extension-only phase submission route.
- Existing Review page integration and existing extension-popup integration; no second floating overlay is mounted.
- Local, fixture-only end-to-end acceptance.

## Safety Contract

- `SAFE_SCREENSHOT_REGION_NOT_FOUND` produces zero phase writes.
- Session ownership mismatch produces `EVIDENCE_SESSION_CONTEXT_MISMATCH` / HTTP 409.
- Old sessions remain readable after Review goods changes, while writes use the current explicit run/goods/session/revision tuple.
- Screenshot crop excludes navigation/account regions through a product-card-derived safe region; full viewport fallback does not exist.
- The extension performs no automatic navigation, scrolling, search, See more clicks, or remote image loading.
- Production databases and real Temu pages were not used by acceptance tests.

## Verification

### New feature tests

`19 PASS / 0 FAIL` across calculation, migration, repository, phase atomicity, Retina screenshot handling, API, extension, Review UI state, and end-to-end fixtures. The localhost API test passed when loopback binding was allowed.

### Related regressions

- Manual Bind / OPEN_ENDED / overlay regression: `52 PASS / 0 FAIL`.
- `npm run check`: PASS.
- `git diff --check`: PASS before the final report commit.
- Localhost Review fixture: PASS. The page loaded one fixture Review item; the Temu market-evidence panel was visible; Create Session was enabled; BEFORE/AFTER were initially unsaved; assessment writes remained disabled before AFTER.

### Full suite

`771 tests: 755 PASS, 11 FAIL, 5 SKIP`.

The 11 failures are not introduced by this feature:

- 7 approved baseline failures: two Excel cleanup/reset HTTP 400 assertions and five image-cache error/status assertions.
- 4 environment-dependent real-data checks: current sourcing migration characterization DB, current sourcing repository DB, Temu sourcing-context DB, and `YINGDAO_REAL_SOURCE_DIR`.

No Temu market-evidence test failed in the full suite. Loopback-dependent tests pass outside the restricted sandbox.

## Acceptance Gates

```text
EVIDENCE_SESSION_EXPLICIT_OWNERSHIP = YES
OLD_SESSION_READ_ONLY_ON_GOODS_SWITCH = YES
SAFE_SCREENSHOT_REGION_REQUIRED = YES
FULL_VIEWPORT_FALLBACK = NO
BEFORE_DOM_AND_SCREENSHOT_ATOMIC = YES
AFTER_DOM_AND_SCREENSHOT_ATOMIC = YES
RETINA_SCREENSHOT_SUPPORTED = YES
MANUAL_TEMU_ACTIONS_ONLY = YES
PRODUCTION_DATABASE_WRITES = 0
REAL_TEMU_AUTOMATION_STARTED = NO
FROZEN_SNAPSHOT_IMAGE_CACHE_CONTRACT_CHANGED = NO
NEW_FEATURE_FAILURES = 0
FULL_SUITE_GREEN = NO
```

## Known Limitation

This MVP is a localhost integration contract, not a security sandbox or authenticated multi-user system. Its single-process/local-operator assumptions must be revisited before remote or concurrent multi-operator deployment.
