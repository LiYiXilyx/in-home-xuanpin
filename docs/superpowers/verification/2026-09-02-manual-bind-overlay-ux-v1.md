# Manual Bind Operator Overlay UX V1 Verification

## Automated evidence

- Feature verifier: `35/35 PASS`.
- Browser-extension related regression: `47/47 PASS`.
- Syntax/static check: `npm run check` PASS plus direct checks for all new extension modules.
- Full suite (outside the restricted network sandbox, with the approved YingDao source directory read-only): `714 total / 705 pass / 7 known baseline failures / 2 skip`.
- New failures: `0`.

The seven failures match the approved baseline by file, test name, assertion class, and reason:

1. `test/integration/server-jobs.test.mjs` — clear Excel — HTTP `400 !== 200`.
2. `test/integration/server-jobs.test.mjs` — test reset — HTTP `400 !== 200`.
3. `test/unit/catalog-parser.test.mjs` — image signature — `IMAGE_INVALID_CONTENT !== IMAGE_SIGNATURE_INVALID`.
4. `test/unit/image-cache.test.mjs` — invalid content type — `IMAGE_INVALID_CONTENT !== IMAGE_MIME_INVALID`.
5. `test/unit/image-cache.test.mjs` — missing content type — `IMAGE_INVALID_CONTENT !== IMAGE_MIME_INVALID`.
6. `test/unit/image-cache.test.mjs` — too-small image — `IMAGE_INVALID_CONTENT !== IMAGE_TOO_SMALL`.
7. `test/unit/image-cache.test.mjs` — valid cache reuse — `failed !== completed`.

## Safety evidence

- The mode resolver selects Manual Bind only from the explicit current Campaign context.
- Manual Bind mounts no legacy Auto Runner DOM and starts no legacy polling.
- The page owns one Catalog root, one optional launcher, and one deduplicated toast container.
- Detect, bind, and capture remain three explicit operations; no auto navigation, scrolling, pagination, See-more click, or capture was added.
- OPEN_ENDED state exposes `不限数量` and never renders the persistence sentinel or `0 / 0`.
- Popup and page Overlay consume the same immutable Profile/Campaign/Page Health model.
- `ui/modules/yingdao`, sourcing, Visual Index, Random5, and Opportunity files are unchanged from base `44c9b5b`.
- Automated tests used temporary/fixture/copied data only. No production Catalog row was changed and no real Temu action was started.

## Runtime acceptance

- Stable branch was fast-forwarded to `035d8a1c842f2c7793fa7273eb83685bb77455a4`.
- Dashboard was stopped only through its owning execution session and restarted from the stable runtime. New PID: `42315`; `/api/health` returned `service=temu-operator-dashboard`.
- The operator manually reloaded the unpacked extension because Chrome security policy prevents automation of `chrome://extensions/`.
- The real Girls' Sets page was refreshed after login and inspected without invoking detect, bind, or capture.
- DOM evidence: one Overlay root, one primary panel, one toast container, zero legacy Auto Runner/manual/capture/review controls.
- Dynamic copy: `小女孩童装 / girls`, `OPEN_ENDED`, `手工采集 · 不限数量`, current unique `0`.
- Action gates: detect enabled; bind and capture disabled with visible reasons; technical details collapsed.
- Viewport evidence: panel `390 × 562.8`, bottom `786` within an `1904 × 804` viewport.
- Acceptance screenshot: `/private/tmp/temu-manual-bind-overlay-ux-v1-acceptance.png` (outside the repository).

Before the new extension was reloaded, the old installed Auto Runner had already moved the existing Girls' Sets Campaign to `manual_required` with a Motorcycle context-mismatch checkpoint. The replacement did not repair or overwrite that history. Post-acceptance read-only verification remained `current_unique=0`, `candidate_revision=0`, QA `NOT_RUN`, and the checkpoint heartbeat remained `2026-09-02T05:39:11.780Z`; therefore the new extension performed no detect, bind, capture, or Catalog write during acceptance.
