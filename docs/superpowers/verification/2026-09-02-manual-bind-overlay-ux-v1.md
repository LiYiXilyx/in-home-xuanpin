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

Pending ff-only stable integration, controlled Dashboard restart, unpacked-extension reload, and non-mutating visual inspection on the real Girls' Sets page. The acceptance screenshot must remain outside the repository.
