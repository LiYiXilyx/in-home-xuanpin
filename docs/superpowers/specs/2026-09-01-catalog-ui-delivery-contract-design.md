# Catalog UI Delivery Contract Design

Date: 2026-09-01

Status: Approved design, implementation not started

## 1. Goal

Deliver the Temu Catalog operator UI as an independently mounted module inside the existing Operator Dashboard. The module owns Category/Profile capability selection, Initial and Expansion Campaign creation, current Catalog Campaign presentation, open-ended Initial progress, Initial QA, QA staleness, first-Pool activation, Active Pool state, and Catalog-only loading/error/polling.

The shared page must also expose a stable empty mount point for a separately developed YingDao/1688 module. Catalog must neither implement nor mutate YingDao behavior or state.

The target page remains:

```text
http://127.0.0.1:37821/
```

## 2. Current Architecture and Problem

The current `ui/app.js` owns both the legacy Dashboard and the newer Catalog operator panel. Catalog profile loading, Campaign creation, current Campaign polling, Initial QA, activation, DOM rendering, request identity, and state are mixed with Browser Health, Jobs, Review, Excel, and legacy Dashboard polling.

The current Catalog panel markup also lives directly in `ui/index.html` with generic `operator-*` and `initial-*` IDs. This creates three integration risks:

1. Catalog and YingDao work would repeatedly edit the same state and render functions in `ui/app.js`.
2. A whole-page or shared-state refresh could overwrite another module's loading, error, or controls.
3. YingDao would have no stable, category-scoped Pool identity API and could fall back to unsafe global/latest product selection.

This design extracts only the approved Catalog ownership. It does not modularize the whole legacy Dashboard.

## 3. Ownership Boundary

### 3.1 Catalog module owns

```text
Category and Category Profile capabilities
current Catalog Campaign
ordinary Expansion Campaign creation
Initial Campaign creation
OPEN_ENDED Initial quantity presentation
Initial live unique count
Initial QA states: NOT_RUN, RUNNING, FAILED, PASSED_CURRENT, STALE
explicit first-Pool activation
Active Pool identity and Initial-to-Expansion capability transition
Catalog-only loading, error, request identity, rendering, and polling
Catalog integration events
strictly scoped Pool Products read contract
```

### 3.2 Legacy Dashboard remains in `ui/app.js`

```text
Browser Health and browser controls
legacy Jobs and job controls
legacy status metrics and event history
Excel export/open/clear
Review capture and session recovery controls
test-data reset
legacy Dashboard notice/toast behavior
legacy `/api/status` polling
```

These legacy features are not renamed, moved, or broadly refactored in this work.

### 3.3 Explicit non-goals

This work does not implement or refactor:

```text
Random5
1688 image search or capture
YingDao task execution or status
YingDao export/import
1688 price or candidate handling
YingDao image cache workflow
taxonomy content
Catalog database migration
authentication or module-level authorization
Legacy Dashboard Modularization V1
```

## 4. Chosen Architecture

Use a root-rendered Catalog module.

```text
Operator Dashboard Shell
├── Legacy Dashboard UI                  ui/app.js
├── Catalog module root                  #catalog-module-root
│   └── Catalog-owned DOM and state       ui/modules/catalog/*
└── YingDao module root                  #yingdao-module-root
    └── empty in this work
```

The module creates and updates only descendants of the Catalog root passed to `mountCatalogPanel`. It must not rerender `document.body`, the shared shell, legacy controls, or the YingDao root.

### 4.1 Proposed files

```text
ui/modules/catalog/panel.js
ui/modules/catalog/state.js
ui/modules/catalog/api.js
ui/modules/catalog/model.js
ui/modules/catalog/catalog.css
```

Responsibilities:

- `panel.js`: mount lifecycle, Catalog DOM construction, event handlers, local rendering, polling ownership, `mountCatalogPanel`, `refreshCatalogPanel`, and `destroy`.
- `state.js`: the Catalog state shape, immutable snapshots for consumers/tests, loading/error transitions, and normalization of current Profile/Campaign/Pool/QA data.
- `api.js`: Catalog-only HTTP client functions. Every URL must remain under `/api/catalog/...`.
- `model.js`: pure payload builders, quantity/QA view models, and Catalog error messages currently implemented in `ui/operator-campaign.js`.
- `catalog.css`: Catalog-prefixed styles only.

`ui/operator-campaign.js` remains temporarily as a thin re-export compatibility layer for existing imports. It must not contain a second state machine, request handler, poller, or renderer.

## 5. Shared Shell Contract

### 5.1 `ui/index.html`

The current inline Catalog panel is replaced with exactly one Catalog mount point. A separate empty YingDao mount point is added next to it:

```html
<section id="catalog-module-root" aria-label="Temu 商品采集"></section>
<section id="yingdao-module-root" aria-label="1688 / 影刀寻源"></section>
```

The shell also links `ui/modules/catalog/catalog.css`. It contains no Catalog form fields and no YingDao business markup.

### 5.2 `ui/app.js`

After extraction, `ui/app.js` is exactly:

```text
legacy Dashboard shell
+ Catalog module import and mount
```

It must not retain a second copy of any of the following:

```text
catalogState or equivalent Catalog globals
Catalog Profile or Campaign request handlers
Catalog polling or timer
Catalog DOM construction/rendering
Initial QA handler
Initial activation handler
Catalog request identity
Catalog error state
```

The legacy Dashboard's existing state, `/api/status` refresh, and polling remain. Catalog polling is removed from that legacy timer.

The permitted new `app.js` integration seam is limited to:

```js
import { mountCatalogPanel } from './modules/catalog/panel.js';

const catalogRoot=document.querySelector('#catalog-module-root');
const catalogPanel=mountCatalogPanel({root:catalogRoot});
```

The precise lifecycle may use top-level `await`, but it must not make legacy Dashboard rendering depend on Catalog success. Catalog errors render inside the Catalog root.

### 5.3 `ui/styles.css`

Only Catalog-specific rules currently using `.operator-*` or `.initial-*` are moved to `catalog.css`. Legacy Dashboard styles remain. Responsive Catalog rules move with the Catalog styles.

## 6. Module Entry and Lifecycle

The stable public interface is:

```js
mountCatalogPanel({
  root,
  pollIntervalMs = 1500,
  fetchImpl = globalThis.fetch,
  scheduler = globalThis
})

refreshCatalogPanel()
```

`mountCatalogPanel` returns a controller:

```js
{
  refresh,
  destroy,
  getState
}
```

Required semantics:

- Mount validates only the supplied Catalog root.
- It renders the Catalog shell, binds Catalog controls, performs an initial refresh, and starts `catalogPollingTimer`.
- A second mount on the same root is idempotent: it returns the existing controller and creates no duplicate listener or polling timer.
- `refreshCatalogPanel` refreshes only the currently mounted Catalog controller. Calling it before mount throws the explicit `CATALOG_PANEL_NOT_MOUNTED` error and performs no fetch or DOM write.
- `destroy` stops only `catalogPollingTimer`, removes only Catalog-owned listeners/content, and makes the controller inactive.
- `destroy` must never remove or modify `#yingdao-module-root`, its descendants, its state, or its controls.

### 6.1 YingDao absence independence

Catalog must not query, require, wait for, mount, render, or validate `#yingdao-module-root`.

All of these must work when the YingDao root is absent, empty, unmounted, or has no JavaScript loaded:

```text
mountCatalogPanel
refreshCatalogPanel
Catalog polling
Campaign creation
Initial QA
Initial activation
destroy
```

## 7. DOM Namespace

Every Catalog-owned element ID must start with `catalog-`.

Representative IDs:

```text
catalog-panel
catalog-category-select
catalog-profile-select
catalog-create-form
catalog-create-campaign
catalog-current-campaign
catalog-current-category
catalog-current-profile
catalog-current-campaign-id
catalog-active-pool-id
catalog-live-unique-count
catalog-quantity-mode
catalog-qa-status
catalog-run-initial-qa
catalog-activate-initial-pool
catalog-activation-result
catalog-loading
catalog-error
```

Catalog must not create generic IDs such as `status`, `progress`, `error`, `task`, or `start`.

Every Catalog-specific CSS class must start with `catalog-`. Shared primitives already owned by the shell, such as `.panel`, `.primary`, or `.eyebrow`, may be consumed but not redefined by Catalog.

## 8. State Namespace and Authority

The module maintains one Catalog-owned state object named `catalogState` or an equivalent state instance with this documented shape:

```js
{
  profiles: [],
  selectedProfile: null,
  currentCampaign: null,
  currentPool: null,
  quantityPolicy: null,
  initialQa: null,
  activation: null,
  loading: {
    profiles: false,
    current: false,
    create: false,
    qa: false,
    activation: false
  },
  error: null,
  mounted: false,
  lastRefreshedAt: null
}
```

Catalog state must not contain, import, alias, or mutate:

```text
yingdaoState
random5State
currentRun
YingDao run_id
YingDao loading/error
```

Button disabled/loading state is derived only from `catalogState`, the selected Profile capability, current Campaign state, and server-owned QA/activation state.

## 9. Polling Isolation

Catalog owns a separately named `catalogPollingTimer`. It polls only the Catalog current-context endpoints required by the panel.

Required behavior:

- Legacy `/api/status` polling continues independently in `ui/app.js`.
- Catalog refresh failure updates only `catalogState.error` and `#catalog-error`.
- Catalog loading changes only Catalog controls.
- Catalog refresh never calls a whole-page renderer.
- Catalog refresh never clears or replaces the shared shell or YingDao root.
- `destroy` clears only `catalogPollingTimer`.
- YingDao loading/import/export/Random5 state cannot disable Catalog buttons.

## 10. Catalog API Namespace

All Catalog module HTTP calls remain under:

```text
/api/catalog/...
```

Existing Catalog write APIs remain server-authoritative and explicit, including Campaign creation, Initial QA, and Initial activation. The UI extraction does not alter their safety semantics:

```text
Initial OPEN_ENDED capture
explicit Campaign identity
Manual Bind gate
QA STALE
activation mutex
category isolation
idempotent request_id
```

No YingDao endpoint is added under `/api/catalog/`.

## 11. Strictly Scoped Pool Products Read API

### 11.1 Endpoint

```text
GET /api/catalog/pools/:pool_version_id/products
  ?category_key=<exact-category-key>
  &category_profile_version=<exact-profile-version>
```

The response contains a stable input identity and deterministic items:

```json
{
  "ok": true,
  "scope": {
    "category_key": "...",
    "category_profile_version": "...",
    "pool_version_id": "..."
  },
  "products": [
    {
      "platform": "temu",
      "goods_id": "...",
      "title": "...",
      "image_url": "...",
      "image_status": "OK"
    }
  ]
}
```

`title` and `image_url` come from the exact `catalog_staging_products` row referenced by `catalog_pool_version_items.staging_product_id`. The existing `ON DELETE RESTRICT` relationship makes this Pool-bound evidence stable for the Pool lifetime; the endpoint must not select a global/latest Product snapshot.

`image_status` uses the existing persisted `product_images` evidence and the exact Pool-bound `image_url`:

```text
OK   = a matching product_images.source_url has download_status='completed'
       and a non-empty local_path
MISS = no such completed matching image row exists
```

The Product join uses exact `platform + goods_id`. The endpoint must not fabricate `OK`, a local path, or image evidence. A failed, pending, skipped, absent, or source-URL-mismatched image is `MISS`.

### 11.2 Scope gates

The server requires all three exact identities:

```text
pool_version_id
category_key
category_profile_version
```

It must verify the addressed Pool row is bound to the exact Category and Profile. Missing or mismatched scope is a HARD FAIL.

Forbidden fallback:

```text
latest Pool
latest active Pool
global active products
global active memberships
display-name matching
another Category's Pool
another Profile version
```

### 11.3 Read-only guarantee

The endpoint is GET only. A successful or failed request must not:

```text
change Campaign rows or status
change Membership rows or active flags
change Pool rows or activation state
create snapshots
run or update QA
run Activation
change queue or claim state
create Campaign events
perform startup recovery
```

The result order is deterministic:

```text
platform ASC
goods_id ASC
```

If product identity uses text goods IDs with leading zeros, ordering and serialization must preserve the exact stored string. No numeric conversion is allowed.

An integration test fingerprints every protected mutable Catalog table before and after successful, mismatched, and missing-scope requests and proves:

```text
CATALOG_POOL_READ_DB_WRITES = 0
```

The test uses temporary SQLite only.

## 12. Events

Catalog may emit optional enhancement events by dispatching `CustomEvent` from `#catalog-module-root` with `bubbles:true`:

```text
catalog:context-changed
catalog:pool-activated
```

Event detail is a newly created, frozen copy containing only the read-only integration identity:

```text
category_key
category_profile_version
campaign_id
pool_version_id
```

Events must not expose mutable Catalog state or service/repository objects.

Events are not a correctness dependency. YingDao V1 must be able to load after Catalog, reload independently, or miss every event and still recover its source through the explicit scoped GET API using `pool_version_id + category_key + category_profile_version`.

Catalog consumes no YingDao event in this work.

## 13. Read Contract Available to YingDao

YingDao may use only the documented read surfaces:

```text
GET /api/catalog/operator/profiles
GET /api/catalog/operator-campaign/current
GET /api/catalog/pools/:pool_version_id/products?category_key=...&category_profile_version=...
optional catalog:context-changed event
optional catalog:pool-activated event
```

The scoped Pool Products endpoint is the formal product-set source. Events are UI hints only.

YingDao must not call or receive repository/service capabilities for:

```text
membership mutation
Active Pool mutation
Campaign status mutation
Initial QA
Initial activation
queue claim/resume/checkpoint
capture batch submission
```

## 14. Authorization Limitation

The current localhost Dashboard has no module identity, authentication, or per-module authorization. Therefore, "Catalog write APIs are not available to YingDao" is an integration and ownership contract, not a security sandbox.

This design does not claim that a same-origin script is technically incapable of issuing an HTTP request to an existing Catalog write endpoint. Enforced module authorization would require a separate capability/auth design and is explicitly outside this V1.

## 15. Shared File Ownership and Merge Regions

```text
SHARED_FILE_MERGE_REQUIRED
```

### 15.1 `ui/index.html`

Catalog-owned change region:

- Replace the current inline `operator-campaign-panel` block with `#catalog-module-root`.
- Add adjacent empty `#yingdao-module-root`.
- Add one Catalog stylesheet link.

YingDao may later add its module stylesheet or loader, but must not replace `#catalog-module-root` or Catalog markup.

### 15.2 `ui/app.js`

Catalog-owned change regions:

- Top import list: add Catalog mount import and remove legacy Catalog helper import.
- Existing Catalog block: delete old Catalog state/functions/handlers completely.
- Initialization: mount Catalog once.
- Legacy timer: remove only `refreshOperatorCurrent`; retain legacy `refresh()`.

Safe future YingDao change regions:

- Add `mountYingdaoPanel` import near module imports.
- Resolve only `#yingdao-module-root`.
- Mount YingDao alongside, not inside, Catalog.

YingDao must not rewrite the Catalog import, Catalog root, Catalog controller, legacy Dashboard refresh, or Catalog lifecycle.

### 15.3 `ui/styles.css`

Catalog removes only its old `.operator-*` and `.initial-*` rules after identical behavior is provided by `catalog.css`. YingDao must not place module-specific rules back into the shared stylesheet unless a later shared-shell contract explicitly approves them.

### 15.4 `src/server/router.mjs`

Catalog adds only registration for the GET Pool Products route. YingDao may register separate endpoints outside `/api/catalog/`, but must not change the route's method, scope requirements, or fallback behavior.

## 16. Error Handling

- Profile/current-context polling errors appear only in `#catalog-error`.
- Create, QA, and activation errors retain existing operator-safe Catalog error mapping.
- QA failures display mandatory Gate codes and actions; no bypass control is introduced.
- A Catalog API error does not set legacy Dashboard or YingDao loading/error state.
- A YingDao error cannot disable Catalog buttons.
- Missing Catalog root is an explicit mount error and must not trigger whole-page replacement.
- Missing YingDao root is irrelevant to Catalog lifecycle.

## 17. TDD and Regression Matrix

Implementation follows RED -> minimal implementation -> GREEN -> related regression -> commit.

### 17.1 Module isolation

```text
Catalog refresh -> YingDao root and descendants unchanged
Catalog loading -> YingDao controls unchanged
Catalog API failure -> YingDao state and error unchanged
Catalog campaign_id -> does not overwrite YingDao run_id
Catalog rerender -> YingDao mount still attached
Catalog destroy -> YingDao root and descendants unchanged
YingDao root absent -> Catalog mount/refresh/destroy PASS
```

### 17.2 Namespace and shell

```text
all Catalog-owned IDs start catalog-
all Catalog-owned module classes start catalog- or use approved shared primitives
app.js has no Catalog state/request/render/poll/QA/activation duplicate
app.js legacy Dashboard behavior remains
index.html contains both stable roots
no document.body.innerHTML or whole-shell replacement
```

### 17.3 State, buttons, and polling

```text
catalogState contains only Catalog fields
catalogPollingTimer starts once and stops on destroy
legacy polling and Catalog polling are independent
Initial OPEN_ENDED target remains null
QA NOT_RUN/RUNNING/FAILED/PASSED_CURRENT/STALE state matrix remains correct
Activation stays disabled unless latest QA is PASSED_CURRENT
Initial-to-Expansion capability refreshes after activation
```

### 17.4 Read API

```text
exact category/profile/pool -> deterministic products
wrong category -> HARD FAIL / 0 writes
wrong profile -> HARD FAIL / 0 writes
missing scope -> HARD FAIL / 0 writes
unknown Pool -> HARD FAIL / 0 writes
no Pool selector may fall back to latest/global active
POST/other method is not accepted by the read route
leading-zero goods_id remains unchanged
CATALOG_POOL_READ_DB_WRITES = 0
```

### 17.5 Existing safety regressions

The directly related tests must remain green:

```text
Initial Campaign create
Expansion Campaign create
Manual Bind context
Initial OPEN_ENDED capture
Initial QA and QA STALE
Initial activation mutex and rollback
category and membership isolation
operator Catalog API
operator Catalog UI
static-server nested module delivery
```

The approved seven unrelated full-suite baseline failures remain identity-matched; `NEW_FAILURES=0` is required.

## 18. Implementation Commit Boundary

The Catalog/shared-shell implementation commit may include only:

```text
ui/modules/catalog/*
ui/operator-campaign.js compatibility re-export
minimal ui/index.html mount/style link changes
minimal ui/app.js import/mount/removal changes
Catalog-style extraction from ui/styles.css
strict Catalog Pool read repository/service/controller/route work
Catalog isolation/read API tests
Catalog UI Delivery Manifest
```

It must not include YingDao business files, production data, unrelated legacy Dashboard refactors, or the nine existing unstaged CRLF migration diffs.

## 19. Delivery Manifest Requirement

Implementation must produce a committed manifest with this exact top-level structure:

```markdown
# Catalog UI Delivery Manifest

## Mount Point
## Entry Functions
## DOM Namespace
## State Namespace
## API Namespace
## Polling
## Events Emitted
## Events Consumed
## Read APIs Exposed To YingDao
## Catalog Write APIs Not Available To YingDao
## Files Owned By Catalog UI
## Files Shared With Operator Shell
## Integration Instructions
```

The manifest must identify safe YingDao edit regions and forbidden Catalog/legacy regions in shared files.

## 20. Design Gates

Implementation may be declared complete only when all are true:

```text
CATALOG_UI_NAMESPACE_ISOLATED = YES
CATALOG_API_NAMESPACE_ISOLATED = YES
CATALOG_STATE_ISOLATED = YES
CATALOG_POLLING_ISOLATED = YES
YINGDAO_UI_ROOT_PRESERVED = YES
YINGDAO_ROOT_REQUIRED_BY_CATALOG = NO
CATALOG_EVENTS_REQUIRED_FOR_YINGDAO_CORRECTNESS = NO
APP_JS_CATALOG_DUPLICATE_IMPLEMENTATION = NO
CATALOG_POOL_READ_DB_WRITES = 0
CATALOG_POOL_READ_GLOBAL_FALLBACK = NO
INITIAL_OPEN_ENDED_CAPTURE_PRESERVED = YES
QA_STALE_PRESERVED = YES
ACTIVATION_MUTEX_PRESERVED = YES
CATEGORY_ISOLATION_PRESERVED = YES
EXPLICIT_CAMPAIGN_PRESERVED = YES
NEW_FAILURES = 0
```

## 21. Design Self-Review

```text
PLACEHOLDERS = 0
UNRESOLVED_SCOPE_DECISIONS = 0
CATALOG_YINGDAO_STATE_COLLISIONS = 0
CATALOG_YINGDAO_DOM_COLLISIONS = 0
CATALOG_LEGACY_DUPLICATE_IMPLEMENTATION_ALLOWED = 0
UNSCOPED_POOL_READ_PATHS = 0
PRODUCTION_DATABASE_WRITES_DESIGNED = 0
YINGDAO_BUSINESS_IMPLEMENTED = 0
DESIGN_GATE = PASS
```
