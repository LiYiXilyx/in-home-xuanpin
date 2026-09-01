# YingDao UI Delivery Contract Design

## Goal

Deliver the existing YingDao / 1688 sourcing UI as an isolated business module inside the Catalog shared Operator shell at `http://127.0.0.1:37821/`, without changing Catalog behavior or the validated sourcing business semantics.

## Fixed boundaries

- Base commit: `b36056ad9dcfa326784b8653273ca7256038da40`.
- Mount only into sibling root `#yingdao-module-root`; never create a second root or mutate `#catalog-module-root`.
- Preserve `/api/sourcing/*`, `/api/sourcing/review/*`, `/sourcing-review.html`, Random5, image-cache, Sheet11, review transaction, and the eight-column YingDao workbook contract.
- Keep frontend state and polling private to the YingDao module. DOM IDs/classes/data attributes use `yingdao-*`.
- Catalog data may be read only through `GET /api/catalog/pools/:pool_version_id/products` with explicit `pool_version_id + category_key + category_profile_version`.
- YingDao performs zero Catalog core-table writes and never calls Catalog mutation APIs.
- One shared server owns port 37821. Existing compatible server is reused; unknown listeners are not killed.
- The validated run `yingdao_random5_v1_20260831_001` remains read-only during real regression.

## Module contract

`ui/modules/yingdao/panel.js` exports:

```js
mountYingdaoPanel({ root, pollIntervalMs, fetchImpl, scheduler, api })
refreshYingdaoPanel()
```

The mount returns `{ refresh, destroy, getState }`. It owns only descendants of the supplied root and its private `yingdaoPollingTimer`. The shared `ui/app.js` imports and mounts the module once; it does not know YingDao internal controls.

## Data flow

Settings, scanning, imports, failed-image retry, and review summaries use existing sourcing APIs. Strict Catalog pool reads are optional source input and require the full identity tuple. Successful operations may emit frozen `yingdao:run-changed` and `yingdao:import-completed` hints; correctness never depends on cross-module events.

## Error and loading isolation

YingDao loading and errors render only under `#yingdao-module-root`. Refresh failure preserves the last successful YingDao state. Catalog loading/errors/refresh/destroy do not modify YingDao state, controls, DOM, or timer, and the symmetric rule applies to YingDao operations.

## Verification

Tests characterize the legacy sourcing UI, drive every extraction through RED→GREEN, assert namespace/state/polling isolation, validate strict Catalog reads and zero Catalog writes, preserve existing APIs/Review Console, detect duplicate IDs/routes/timers/implementations, and re-run the real 50/250 Review V1 read-only safety gate.
