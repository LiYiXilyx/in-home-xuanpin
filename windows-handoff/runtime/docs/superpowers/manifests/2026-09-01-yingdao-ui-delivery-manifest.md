# YingDao UI Delivery Manifest

## Base

- Catalog shared baseline: `b36056ad9dcfa326784b8653273ca7256038da40`
- Delivery branch: `codex/yingdao-ui-delivery`
- Shared Operator origin: `http://127.0.0.1:37821`
- Validated sourcing run: `yingdao_random5_v1_20260831_001`
- Review Console owner: `YINGDAO`

## Mount Point

The shared shell owns two sibling roots. Catalog remains mounted at `#catalog-module-root`; YingDao mounts only at `#yingdao-module-root`.

## Entry Functions

- `mountYingdaoPanel({root, pollIntervalMs, scheduler, api})`
- `refreshYingdaoPanel()`
- Controller returned by mount: `{refresh, destroy, getState}`

The same-root mount is idempotent. A second live root is rejected. Destroy clears only the YingDao root and its timer.

## DOM Namespace

Every YingDao-owned ID and class uses the `yingdao-*` prefix. The final verifier reports:

- duplicate DOM IDs: `0`
- YingDao IDs outside namespace: `0`

## State Namespace

State is module-private and created by `createYingdaoState()`. It owns `currentRun`, `selectedTask`, `loading`, `error`, `progress`, `random5`, `imageCache`, `exportStatus`, `importStatus`, `scanStatus`, `reviewSummary`, settings, scan token, and preview. Unknown state keys—including Catalog state keys—are rejected.

No YingDao code imports, mutates, or aliases `catalogState`, `campaignState`, `currentCampaign`, or manual-capture state.

## API Namespace

Existing validated namespaces are preserved:

- `/api/sourcing/settings`
- `/api/sourcing/path-dialog`
- `/api/sourcing/scan`
- `/api/sourcing/imports`
- `/api/sourcing/imports/current`
- `/api/sourcing/imports/:run_id`
- `/api/sourcing/imports/:run_id/retry-failed-images`
- `/api/sourcing/review/*`

No YingDao mutation route exists under `/api/catalog/*`.

## Polling

YingDao owns one private `yingdaoPollingTimer` inside its mount closure. Refresh calls coalesce through one in-flight promise. Starting, failing, refreshing, or destroying YingDao does not change Catalog controls, state, DOM, or polling.

## Events Emitted

None. The V1 integration uses direct module lifecycle calls and does not claim a shared global event name.

## Events Consumed

None.

## Catalog Read Dependencies

The only Catalog dependency exposed by the YingDao client is:

`GET /api/catalog/pools/:pool_version_id/products?category_key=...&category_profile_version=...`

All three scope values are mandatory. Unknown pool, category/profile mismatch, and missing identity fail closed. No fallback to current campaign, latest pool, or implicit category is allowed.

## Catalog Write Boundaries

YingDao performs zero writes to Catalog core tables and exposes no Catalog mutation capability. Verification covers Campaign, Membership, Pool, Pool Item, queue/claim, Initial QA, and Initial Activation boundaries.

## Database Write Ownership

- Writable: `data/1688_sourcing.db` and sourcing-owned settings/run/review structures.
- Read-only context: `data/temu_research_v2.db`.
- Catalog core writes from YingDao: `0`.

## Excel Contract

Existing validated Random5 import, image cache, Sheet 11, and Sheet 05 preservation behavior are retained. The UI only invokes the existing sourcing flow; it does not duplicate parser, Random5, image, or workbook logic in browser code.

## Review Console

- Standalone route: `/sourcing-review.html`
- Homepage entry owner: YingDao panel
- Fixed validated V1 run: `yingdao_random5_v1_20260831_001`
- Current real evidence: `50` goods, `250` candidates, `0` image mapping errors
- Mutations remain under `/api/sourcing/review/*` and write only the sourcing database.

## Files Owned By YingDao UI

- `ui/modules/yingdao/panel.js`
- `ui/modules/yingdao/state.js`
- `ui/modules/yingdao/model.js`
- `ui/modules/yingdao/api.js`
- `ui/modules/yingdao/yingdao.css`
- `ui/sourcing-review.html`
- `ui/sourcing-review.js`
- `ui/sourcing-review-state.js`
- `ui/sourcing-review.css`
- `scripts/1688/verify-yingdao-ui-delivery.mjs`
- YingDao/sourcing unit and integration tests

## Files Shared With Operator Shell

### SHARED_FILE_CHANGE

- File: `ui/index.html`
- Region: stylesheet declarations only
- Reason: load the YingDao module stylesheet; the existing sibling mount root is retained
- Final merge owner: shared Operator shell integration branch

### SHARED_FILE_CHANGE

- File: `ui/app.js`
- Region: imports, root lookup, and final mount calls only
- Reason: import and mount the isolated YingDao module once
- Final merge owner: shared Operator shell integration branch

### SHARED_FILE_CHANGE

- File: `src/server/index.mjs`
- Region: sourcing controller/repository construction, route dependency injection, and owned connection close
- Reason: serve existing sourcing and Review features from the one Operator server
- Final merge owner: shared Operator shell integration branch

### SHARED_FILE_CHANGE

- File: `src/server/router.mjs`
- Region: `/api/sourcing/*` and `/api/sourcing/review/*` registration plus sourcing error/status mapping
- Reason: preserve validated sourcing routes without placing them under Catalog
- Final merge owner: shared Operator shell integration branch

`ui/styles.css` and `scripts/start-operator-console.mjs` were not changed by this delivery.

## Shared Server Contract

YingDao does not start a second server. It is served by the existing Operator process on `127.0.0.1:37821`. Port reuse remains a launcher/shell responsibility: compatible health response may be reused; an unknown listener must block, never be killed or silently moved.

## Existing Compatibility

- Existing sourcing routes preserved: `YES`
- Review Console owner: `YINGDAO`
- Shared server reused: `YES`
- Duplicate DOM IDs: `0`
- Duplicate routes: `0`
- Duplicate global polling/event ownership: `0`
- Legacy duplicate YingDao homepage implementation: `0`
- Legacy duplicate Catalog implementation: `0`

## Integration Instructions

1. Integrate this delivery on top of Catalog baseline `b36056a` or a descendant containing it.
2. Keep `#catalog-module-root` and `#yingdao-module-root` as sibling roots.
3. Preserve the single import/mount statements in `ui/app.js`; do not copy YingDao DOM or handlers back into the shell.
4. Preserve `/api/sourcing/*`, `/api/sourcing/review/*`, and `/sourcing-review.html` without renaming them for cosmetic namespace uniformity.
5. Do not add YingDao writes to `/api/catalog/*` or Catalog core tables.
6. Re-run `scripts/1688/verify-yingdao-ui-delivery.mjs`, focused isolation tests, the real 50/250 safety gate, `npm run check`, and `git diff --check` after integration.

## Commit List

### Delivery planning

- `7039841` docs: plan YingDao UI delivery

### Preserved validated sourcing compatibility

- `0f9410c` through `7d3b7a1`: additive sourcing schema, scanner/parser, stable Random5, import, verified image cache, Sheet 11, local console, QA/CLI, Review migration/repository/context/service/images/API/UI/acceptance

### Modular UI delivery

- `45b76e9` test: characterize existing YingDao delivery
- `cdc7f0b` feat: establish YingDao UI module boundary
- `2433971` refactor: isolate YingDao state model and API
- `cd0867a` feat: isolate YingDao polling lifecycle
- `20c6d9f` feat: mount sourcing import controls in YingDao module
- `30a2fcf` feat: expose Review Console from YingDao panel
- `d09c2b2` refactor: wire YingDao module into shared shell
- `f92dd5e` feat: consume strict Catalog pool read contract
- `44c3747` test: verify YingDao and Catalog UI isolation
- `2c1fc8d` test: validate shared YingDao Operator delivery
- `07ced8e` fix: bind YingDao review summary to validated run
- `db4850e` fix: show validated Review run in YingDao overview
- `4b1917c` test: align Review entry with YingDao module mount

## Verification Summary

- New/focused tests: pass
- Real Review safety: `50 / 250`, mapping errors `0`, sourcing integrity `ok`, FK violations `0`
- Temu context: `50 / 50`, read-only `true`, Active Pool `2135`
- Full suite: `548` pass, `7` fail; the same `7` failures reproduce on unmodified Catalog baseline `b36056a`, so new failures are `0`
- Syntax/check suite: pass
- No push performed

