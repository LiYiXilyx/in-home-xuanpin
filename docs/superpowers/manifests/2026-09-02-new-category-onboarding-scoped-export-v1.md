# New Category Onboarding & Scoped Export V1 Delivery Manifest

## Operator flow

`添加新类目` → validation-only → register Profile → registry reload → explicit OPEN_ENDED Initial Campaign → Manual Bind capture → scoped preview → Initial QA → explicit activation → scoped formal Pool export.

## Profile storage

Operator Profiles are stored atomically below `<dirname(TEMU_CONFIG_PATH)>/data/operator-category-profiles/`. Built-in and operator roots are rescanned on every list/resolve. There is no update/delete/overwrite API.

## Catalog APIs

- `POST /api/catalog/operator/category-profiles/validate`
- `POST /api/catalog/operator/category-profiles`
- existing explicit Initial Campaign, QA, activation, Manual Bind endpoints
- `POST /api/catalog/operator/initial-campaigns/:campaign_id/preview-export`
- `POST /api/catalog/pools/:pool_version_id/export`

## Safety scopes

Product identity remains `platform + goods_id`; Category membership remains separate. Preview requires exact Campaign/category/profile/revision. Formal export requires exact Category/profile/Pool. Neither endpoint has latest/global fallback. Capture-only taxonomy is `UNCONFIGURED`; Classification and Opportunity remain blocked.

## UI ownership

All onboarding and export UI is under `ui/modules/catalog/*`, uses `catalog-*` DOM and `catalogState`, and touches only `#catalog-module-root`. YingDao roots, state, polling, APIs, Random5, Review, Visual Index and supplier caches are unchanged.

## Manual Bind

The existing `MANUAL_BIND_PASSIVE_CAPTURE` path is reused. Capture-only binding additionally verifies aliases, breadcrumbs and normalized listing host/path. Auto navigation, scrolling, pagination, See more, CAPTCHA handling and automatic capture remain off.

## Excel

Preview metadata is `PREVIEW / NOT_ACTIVE_POOL`. Formal metadata is `FORMAL_POOL / ACTIVE_POOL`. Both contain five deterministic sheets and preserve missing images as `MISS`. Exports are read-only against SQLite and save via atomic replacement.

## Verification

Run `npm run verify:new-category-onboarding`. It uses only a self-owned temporary directory/SQLite and performs no real Temu capture or production database write.
