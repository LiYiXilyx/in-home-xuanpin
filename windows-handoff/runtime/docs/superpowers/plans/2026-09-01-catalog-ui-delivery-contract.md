# Catalog UI Delivery Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the approved Temu Catalog operator panel into an independently mounted, root-rendered module with isolated state/polling, a strict read-only Pool Products API, an untouched YingDao mount seam, and a committed delivery manifest.

**Architecture:** `ui/app.js` remains the legacy Dashboard shell and mounts a Catalog controller into `#catalog-module-root`; all Category/Profile, Campaign, Initial QA/Activation, rendering, loading/error, and polling behavior moves into `ui/modules/catalog/*`. A new GET-only Catalog Pool reader validates `pool_version_id + category_key + category_profile_version`, returns deterministic Pool-bound product evidence, and performs zero database writes. `#yingdao-module-root` remains empty and independent.

**Tech Stack:** Node.js 22 ESM, vanilla browser DOM/ES modules/CSS, Node test runner, `node:sqlite`, existing HTTP router/controllers, temporary SQLite fixtures.

**Spec:** `docs/superpowers/specs/2026-09-01-catalog-ui-delivery-contract-design.md`

## Global Constraints

- Work only in `/private/tmp/temu-multi-category-safety-v1` on `codex/multi-category-safety-v1`.
- Do not push, write production SQLite, start real Temu capture, start Chrome/Extension, or repair the Motorcycle 2135/1149 blocker.
- Do not implement Random5, YingDao export/import, 1688 capture/pricing/candidates, or any YingDao business state.
- Do not modularize Browser Health, legacy Jobs, Excel, Review, test reset, legacy notices, or legacy `/api/status` polling.
- All Catalog-owned IDs and module-specific classes start with `catalog-`; approved shared classes are `.panel`, `.primary`, and `.eyebrow` only.
- Catalog code may write only descendants of the supplied `#catalog-module-root`.
- Catalog must work when `#yingdao-module-root` is absent, empty, unmounted, or has no JavaScript.
- Catalog loading/error/polling/destroy must not mutate YingDao root, controls, state, `run_id`, or timers.
- Events are optional hints; correctness uses the explicit scoped GET API.
- `ui/app.js` must end as legacy Dashboard shell plus module import/mount, with no duplicate Catalog state, request handler, renderer, timer, QA handler, or activation handler.
- The Pool Products endpoint is GET-only, requires exact Pool/Category/Profile identity, has no latest/global fallback, preserves text goods IDs, orders by `platform ASC, goods_id ASC`, and writes zero rows.
- Existing Initial OPEN_ENDED, Manual Bind, QA STALE, activation mutex/rollback, category isolation, explicit Campaign, and request-idempotency behavior must remain.
- All automated writes use temporary/fixture SQLite only.
- The nine existing CRLF migration diffs (`001`, `002`, `003`, `004`, `009`, `010`, `011`, `012`, `013`) remain unstaged and absent from every commit.
- The approved full-suite baseline remains exactly seven failures matched by file, test name, and reason/error class; `NEW_FAILURES=0`.
- Each Task must complete RED -> minimal implementation -> GREEN -> related regression -> path-scoped `git diff --check` -> exact-path commit before the next Task.
- `SHARED_UI_COMMIT` in the final handoff means the final cumulative Task 9 HEAD. The YingDao window must update/rebase/merge through that commit; cherry-picking only the final manifest commit would omit Tasks 1-8.

## File and Responsibility Map

### New Catalog UI files

- `ui/modules/catalog/panel.js`: Catalog markup, mount lifecycle, controller, event handlers, rendering, polling owner, `mountCatalogPanel`, `refreshCatalogPanel`.
- `ui/modules/catalog/state.js`: `createCatalogState`, state transitions, frozen snapshots.
- `ui/modules/catalog/model.js`: existing pure Campaign/Initial payload builders and view models.
- `ui/modules/catalog/api.js`: fetch wrapper constrained to `/api/catalog/...` and typed Catalog methods.
- `ui/modules/catalog/catalog.css`: only `catalog-*` selectors plus approved shared-class descendants.

### Compatibility/shared UI files

- `ui/operator-campaign.js`: thin re-export from `ui/modules/catalog/model.js`; no behavior copy.
- `ui/index.html`: shared roots and Catalog stylesheet link only; no Catalog form markup after Task 6.
- `ui/app.js`: legacy Dashboard logic plus Catalog module mount only.
- `ui/styles.css`: legacy Dashboard styles; old Catalog-specific selectors removed.

### Read API files

- `src/db/repositories/catalog-pool-read-repository.mjs`: exact Pool scope validation and deterministic read query.
- `src/server/controllers/catalog-controller.mjs`: controller method mapping query identity to the reader.
- `src/server/index.mjs`: instantiate/inject the Pool reader.
- `src/server/router.mjs`: register GET-only scoped route and map explicit errors.

### Tests and delivery

- `test/unit/catalog-module-namespace.test.mjs`: markup/lifecycle namespace and root boundary.
- `test/unit/catalog-state-model-api.test.mjs`: state/model/API extraction and compatibility exports.
- `test/unit/catalog-polling-isolation.test.mjs`: one timer, error/loading isolation, destroy.
- `test/fixtures/catalog-panel-dom-fixture.mjs`: minimal DOM fixture scoped to the Catalog root.
- `test/unit/catalog-panel.test.mjs`: real Catalog render/actions/state/event matrix.
- `test/unit/catalog-shared-shell.test.mjs`: mount roots and shared HTML contract.
- `test/integration/catalog-static-module.test.mjs`: nested Catalog assets served by the existing static server.
- `test/unit/catalog-app-shell.test.mjs`: no Catalog duplicate in `app.js`; legacy code retained.
- `test/unit/catalog-css-isolation.test.mjs`: CSS namespace and extraction proof.
- `test/integration/catalog-pool-products-api.test.mjs`: strict scope, deterministic result, GET-only, zero writes.
- `test/unit/catalog-dual-module-isolation.test.mjs`: Catalog/YingDao root/state/control isolation.
- `test/unit/catalog-ui-delivery-verifier.test.mjs`: temporary-only verifier and required Final Gate contract.
- `scripts/verify-catalog-ui-delivery.mjs`: static and temporary-fixture Final Gate report.
- `docs/superpowers/manifests/2026-09-01-catalog-ui-delivery-manifest.md`: final integration contract.

---

### Task 1: Catalog Module Foundation and DOM Namespace

**Files:**
- Create: `ui/modules/catalog/panel.js`
- Create: `test/unit/catalog-module-namespace.test.mjs`

**Interfaces:**
- Produces: `catalogPanelMarkup() -> string`.
- Produces: `mountCatalogPanel({root,pollIntervalMs,fetchImpl,scheduler}) -> {refresh,destroy,getState}`.
- Produces: `refreshCatalogPanel() -> Promise<object>`.
- Produces: idempotent same-root mount and `CATALOG_PANEL_NOT_MOUNTED` pre-mount error.
- Consumed by: Tasks 3, 4, and 6.

- [ ] **Step 1: Write the RED namespace and lifecycle tests**

Create tests that parse every `id` and `class` from `catalogPanelMarkup`, allow only the three approved shared classes, and exercise mount/destroy with plain root sentinels:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogPanelMarkup,mountCatalogPanel,refreshCatalogPanel
} from '../../ui/modules/catalog/panel.js';

test('Catalog markup uses only catalog-* IDs and approved shared classes',()=>{
  const html=catalogPanelMarkup();
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.ok(ids.length>10);
  assert.equal(ids.every(id=>id.startsWith('catalog-')),true);
  const allowed=new Set(['panel','primary','eyebrow']);
  const classes=[...html.matchAll(/\bclass="([^"]+)"/g)]
    .flatMap(match=>match[1].split(/\s+/));
  assert.equal(classes.every(name=>name.startsWith('catalog-')||allowed.has(name)),true);
  assert.doesNotMatch(html,/yingdao|random5|1688|run_id/i);
});

test('mount is idempotent and destroy changes only the supplied Catalog root',async()=>{
  const root=fakeRoot(),yingdao={marker:'keep'};
  const first=mountCatalogPanel({root,scheduler:fakeScheduler()});
  const second=mountCatalogPanel({root,scheduler:fakeScheduler()});
  assert.equal(second,first);
  first.destroy();
  assert.equal(yingdao.marker,'keep');
});

test('refresh before mount hard fails without fetch or DOM writes',async()=>{
  await assert.rejects(()=>refreshCatalogPanel(),error=>error.code==='CATALOG_PANEL_NOT_MOUNTED');
});
```

Use `fakeRoot()` with only `innerHTML`, `replaceChildren`, and a mutation counter; it must not expose `document` or YingDao.

- [ ] **Step 2: Run RED and verify the missing module is the failure**

```bash
node --test test/unit/catalog-module-namespace.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `ui/modules/catalog/panel.js`.

- [ ] **Step 3: Implement the minimal namespaced markup and lifecycle**

Create markup containing the complete Catalog control surface with `catalog-*` IDs. Implement one module-level mounted controller and a `WeakMap` keyed by root:

```js
const mounts=new WeakMap();
let currentController=null;

export function mountCatalogPanel(options={}) {
  const root=options.root;
  if(!root||typeof root!=='object')throw coded('CATALOG_ROOT_REQUIRED','缺少 Catalog mount root。');
  if(mounts.has(root))return mounts.get(root);
  root.innerHTML=catalogPanelMarkup();
  const controller=createFoundationController(root);
  mounts.set(root,controller);currentController=controller;
  return controller;
}

export async function refreshCatalogPanel() {
  if(!currentController)throw coded('CATALOG_PANEL_NOT_MOUNTED','Catalog panel 尚未挂载。');
  return currentController.refresh();
}
```

The foundation controller returns a frozen `{mounted:true}` snapshot and its async `refresh` returns that same snapshot without network access; it is not wired into `app.js` yet. `destroy` calls only `root.replaceChildren()` and clears its own mount record.

- [ ] **Step 4: Run GREEN**

```bash
node --test test/unit/catalog-module-namespace.test.mjs
```

Expected: all Task 1 tests PASS.

- [ ] **Step 5: Run related regression**

```bash
node --test test/unit/operator-campaign-ui.test.mjs test/unit/initial-pool-ui.test.mjs test/unit/operator-campaign-console.test.mjs
```

Expected: existing UI helpers and current shell remain PASS because Task 1 is not mounted.

- [ ] **Step 6: Check and commit exact paths**

```bash
git diff --check -- ui/modules/catalog/panel.js test/unit/catalog-module-namespace.test.mjs
git add -- ui/modules/catalog/panel.js test/unit/catalog-module-namespace.test.mjs
git diff --cached --name-only
git commit -m "feat: establish Catalog UI module boundary"
```

Cached paths must be exactly the two Task 1 files and contain no migration.

---

### Task 2: Catalog State, Model, and API Extraction

**Files:**
- Create: `ui/modules/catalog/state.js`
- Create: `ui/modules/catalog/model.js`
- Create: `ui/modules/catalog/api.js`
- Modify: `ui/operator-campaign.js`
- Create: `test/unit/catalog-state-model-api.test.mjs`
- Modify: `test/unit/operator-campaign-ui.test.mjs`
- Modify: `test/unit/initial-pool-ui.test.mjs`

**Interfaces:**
- Produces: `createCatalogState()` with the exact Spec state keys.
- Produces: `snapshotCatalogState(state)` returning a detached frozen snapshot.
- Produces: `patchCatalogState(state,patch)` restricted to Catalog keys.
- Produces: `createCatalogApi({fetchImpl})` with `listProfiles`, `currentCampaign`, `createExpansion`, `createInitial`, `runInitialQa`, `activateInitial`.
- Produces: all existing model exports from `ui/modules/catalog/model.js`.
- Preserves: `ui/operator-campaign.js` imports through `export * from './modules/catalog/model.js'`.
- Consumed by: Tasks 3 and 4.

- [ ] **Step 1: Write RED tests for state authority, API namespace, and compatibility exports**

```js
test('Catalog state contains only the approved namespace',()=>{
  const state=createCatalogState();
  assert.deepEqual(Object.keys(state).sort(),[
    'activation','currentCampaign','currentPool','error','initialQa','lastRefreshedAt',
    'loading','mounted','profiles','quantityPolicy','selectedProfile'
  ]);
  assert.equal('yingdaoState' in state,false);
  assert.equal('currentRun' in state,false);
});

test('Catalog API rejects non-catalog URLs and calls exact endpoints',async()=>{
  const calls=[];
  const api=createCatalogApi({fetchImpl:async(url,options)=>{
    calls.push({url,options});return response({ok:true,profiles:[]});
  }});
  await api.listProfiles();
  assert.equal(calls[0].url,'/api/catalog/operator/profiles');
  assert.equal(calls.every(call=>call.url.startsWith('/api/catalog/')),true);
});

test('legacy helper import is a thin compatibility export',async()=>{
  const legacy=await import('../../ui/operator-campaign.js');
  const model=await import('../../ui/modules/catalog/model.js');
  assert.equal(legacy.buildInitialQaPayload,model.buildInitialQaPayload);
});
```

Also preserve the existing OPEN_ENDED and QA state-matrix assertions.

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/catalog-state-model-api.test.mjs test/unit/operator-campaign-ui.test.mjs test/unit/initial-pool-ui.test.mjs
```

Expected: FAIL because the three Catalog module files do not exist.

- [ ] **Step 3: Implement minimal state and API modules**

Use a fixed state-key allowlist. `patchCatalogState` rejects unknown keys with `CATALOG_STATE_KEY_INVALID`. `snapshotCatalogState` uses `structuredClone` followed by recursive freeze so callers cannot mutate live state.

Implement the API client around one private request function:

```js
function assertCatalogPath(path) {
  if(!String(path).startsWith('/api/catalog/'))throw coded('CATALOG_API_NAMESPACE_INVALID','Catalog API越界。');
}

export function createCatalogApi({fetchImpl=globalThis.fetch}={}) {
  const request=async(path,options={})=>{
    assertCatalogPath(path);
    const response=await fetchImpl(path,{
      method:options.method??'GET',
      headers:{'Content-Type':'application/json'},
      body:options.body===undefined?undefined:JSON.stringify(options.body)
    });
    const payload=await response.json();
    if(!response.ok)throw apiError(payload);
    return payload;
  };
  return {
    listProfiles:()=>request('/api/catalog/operator/profiles'),
    currentCampaign:()=>request('/api/catalog/operator-campaign/current'),
    createExpansion:body=>request('/api/catalog/operator-campaigns',{method:'POST',body}),
    createInitial:body=>request('/api/catalog/operator/initial-campaigns',{method:'POST',body}),
    runInitialQa:(id,body)=>request(`/api/catalog/operator/initial-campaigns/${encodeURIComponent(id)}/qa-runs`,{method:'POST',body}),
    activateInitial:(id,body)=>request(`/api/catalog/operator/initial-campaigns/${encodeURIComponent(id)}/activate`,{method:'POST',body})
  };
}
```

Move the current pure helper implementation verbatim into `model.js`; replace `ui/operator-campaign.js` with only the re-export statement.

- [ ] **Step 4: Run GREEN**

```bash
node --test test/unit/catalog-state-model-api.test.mjs test/unit/operator-campaign-ui.test.mjs test/unit/initial-pool-ui.test.mjs
```

Expected: all tests PASS and existing import paths remain valid.

- [ ] **Step 5: Run related regression**

```bash
node --test test/unit/operator-campaign-console.test.mjs test/integration/operator-campaign-api.test.mjs test/integration/initial-pool-api.test.mjs
```

Expected: pure model and server contracts remain PASS.

- [ ] **Step 6: Check and commit exact paths**

```bash
git diff --check -- ui/modules/catalog/state.js ui/modules/catalog/model.js ui/modules/catalog/api.js ui/operator-campaign.js test/unit/catalog-state-model-api.test.mjs test/unit/operator-campaign-ui.test.mjs test/unit/initial-pool-ui.test.mjs
git add -- ui/modules/catalog/state.js ui/modules/catalog/model.js ui/modules/catalog/api.js ui/operator-campaign.js test/unit/catalog-state-model-api.test.mjs test/unit/operator-campaign-ui.test.mjs test/unit/initial-pool-ui.test.mjs
git diff --cached --name-only
git commit -m "refactor: isolate Catalog state model and API"
```

---

### Task 3: Independent Catalog Polling

**Files:**
- Modify: `ui/modules/catalog/panel.js`
- Create: `test/unit/catalog-polling-isolation.test.mjs`

**Interfaces:**
- Consumes: `createCatalogState`, `patchCatalogState`, `snapshotCatalogState`, and `createCatalogApi` from Task 2.
- Produces: one `catalogPollingTimer` per mounted root.
- Produces: refresh coalescing so an interval tick cannot create overlapping Catalog requests.
- Produces: controller `refresh`, `destroy`, and `getState` backed by Catalog state.
- Consumed by: Task 4.

- [ ] **Step 1: Write RED polling-isolation tests with injected scheduler/API**

```js
test('Catalog mount starts one polling timer and same-root remount starts none',async()=>{
  const scheduler=fakeScheduler(),api=fakeCatalogApi();
  const root=fakeRoot(),first=mountCatalogPanel({root,scheduler,api,pollIntervalMs:1500});
  const second=mountCatalogPanel({root,scheduler,api,pollIntervalMs:1500});
  assert.equal(second,first);
  assert.equal(scheduler.intervals.length,1);
});

test('Catalog API error changes only Catalog error and leaves YingDao sentinels untouched',async()=>{
  const yingdao={loading:false,error:null,run_id:'run-7',controlsDisabled:false};
  const controller=mountCatalogPanel({root:fakeRoot(),scheduler:fakeScheduler(),api:failingApi()});
  await controller.refresh();
  assert.match(controller.getState().error.message,/offline/);
  assert.deepEqual(yingdao,{loading:false,error:null,run_id:'run-7',controlsDisabled:false});
});

test('destroy clears only catalogPollingTimer',()=>{
  const scheduler=fakeScheduler(),foreignTimer=scheduler.setInterval(()=>{},5000);
  const controller=mountCatalogPanel({root:fakeRoot(),scheduler,api:fakeCatalogApi()});
  controller.destroy();
  assert.equal(scheduler.isActive(foreignTimer),true);
  assert.equal(scheduler.activeCount(),1);
});
```

The fake API returns `{profiles:[]}` and `{current:null}`; it exposes no YingDao property.

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/catalog-polling-isolation.test.mjs
```

Expected: FAIL because Task 1 controller does not own API/state/timer behavior.

- [ ] **Step 3: Implement the minimal polling controller**

Add optional `api` injection for tests while keeping `fetchImpl` as the public default:

```js
const catalogApi=options.api??createCatalogApi({fetchImpl:options.fetchImpl});
const catalogState=createCatalogState();
let catalogPollingTimer=null,refreshPromise=null;

async function refresh() {
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{
    patchCatalogState(catalogState,{loading:{...catalogState.loading,profiles:true,current:true},error:null});
    try {
      const [profiles,current]=await Promise.all([catalogApi.listProfiles(),catalogApi.currentCampaign()]);
      patchCatalogState(catalogState,{profiles:profiles.profiles??[],currentCampaign:current.current??null,lastRefreshedAt:new Date().toISOString()});
    } catch(error) {
      patchCatalogState(catalogState,{error:{code:error.code??'OPERATION_FAILED',message:error.message}});
    } finally {
      patchCatalogState(catalogState,{loading:{...catalogState.loading,profiles:false,current:false}});
      refreshPromise=null;
    }
    return snapshotCatalogState(catalogState);
  })();
  return refreshPromise;
}
```

Start exactly one interval after mount, call an immediate refresh without blocking the legacy Dashboard, and clear only that timer in `destroy`.

- [ ] **Step 4: Run GREEN**

```bash
node --test test/unit/catalog-polling-isolation.test.mjs test/unit/catalog-module-namespace.test.mjs
```

Expected: all polling and lifecycle tests PASS.

- [ ] **Step 5: Run related regression**

```bash
node --test test/unit/operator-campaign-ui.test.mjs test/unit/initial-pool-ui.test.mjs test/integration/operator-campaign-api.test.mjs
```

- [ ] **Step 6: Check and commit exact paths**

```bash
git diff --check -- ui/modules/catalog/panel.js test/unit/catalog-polling-isolation.test.mjs
git add -- ui/modules/catalog/panel.js test/unit/catalog-polling-isolation.test.mjs
git diff --cached --name-only
git commit -m "feat: isolate Catalog polling lifecycle"
```

---

### Task 4: Root-rendered Catalog Panel and Operator Actions

**Files:**
- Modify: `ui/modules/catalog/panel.js`
- Create: `test/fixtures/catalog-panel-dom-fixture.mjs`
- Create: `test/unit/catalog-panel.test.mjs`

**Interfaces:**
- Consumes: Task 2 model builders/API/state and Task 3 polling controller.
- Produces: namespaced profile selection, Initial/Expansion create, current Campaign render, QA, activation, Active Pool result, and capability refresh.
- Emits: optional bubbling `catalog:context-changed` and `catalog:pool-activated` events with frozen copied identity.
- Does not consume: any YingDao event/state/root.

- [ ] **Step 1: Build the minimal DOM fixture and write RED panel tests**

The fixture provides only Catalog-root operations used by production code: `innerHTML`, `querySelector`, `replaceChildren`, `ownerDocument.createElement`, button/input fields, listener registration, and `dispatchEvent`. It separately exposes an unreferenced YingDao sentinel.

Write table-driven tests:

```js
test('Initial state renders OPEN_ENDED and exact QA button matrix',async()=>{
  for(const [qaStatus,qaEnabled,activationEnabled] of [
    ['NOT_RUN',true,false],['RUNNING',false,false],['FAILED',true,false],
    ['PASSED_CURRENT',true,true],['STALE',true,false]
  ]) {
    const fixture=catalogDomFixture();
    const api=fakeApi({current:initialCurrent({qaStatus,currentUnique:10})});
    const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler});
    await panel.refresh();
    assert.equal(fixture.byId('catalog-run-initial-qa').disabled,!qaEnabled);
    assert.equal(fixture.byId('catalog-activate-initial-pool').disabled,!activationEnabled);
    assert.doesNotMatch(fixture.catalogRoot.textContent,/2147483647/);
    panel.destroy();
  }
});

test('create chooses Initial or Expansion from exact Profile capability',async()=>{
  const fixture=catalogDomFixture(),api=recordingApi();
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler});
  await selectAndSubmit(fixture,{initial_pool_available:true,expansion_available:false});
  assert.equal(api.calls.createInitial.length,1);
  assert.equal(api.calls.createExpansion.length,0);
  panel.destroy();
});

test('QA and activation use explicit identity and events are optional',async()=>{
  const fixture=catalogDomFixture({customEventAvailable:false}),api=recordingApi();
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler});
  await clickQaAndActivation(fixture);
  assert.deepEqual(api.calls.activateInitial[0].body,{
    campaign_id:'campaign-1',category_key:'category-b',
    category_profile_version:'category-b-v1',request_id:'uuid-activation'
  });
  assert.equal(api.calls.activateInitial.length,1);
  panel.destroy();
});
```

Also test Profile refresh after activation changes Initial capability to Expansion and renders `pool_version_id`.

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/catalog-panel.test.mjs
```

Expected: FAIL because the foundation panel has no real render/action bindings.

- [ ] **Step 3: Implement minimal root-local element collection and rendering**

Use only `root.querySelector` through a helper that requires `#catalog-*` descendants. Do not call `document.querySelector` in the Catalog module.

Implement handlers:

```text
submit create form -> selected Profile capability -> createInitial/createExpansion
run QA -> buildInitialQaPayload -> server -> refresh
activate -> buildInitialActivationPayload -> server -> refresh Profiles/current
Profile/category/input change -> reset only Catalog request identity/state
```

Use `crypto.randomUUID` through an injectable `randomUUID` option defaulting to `globalThis.crypto.randomUUID.bind(globalThis.crypto)`.

Event helper:

```js
function emitCatalogIdentity(root,type,value) {
  const CustomEventCtor=root.ownerDocument?.defaultView?.CustomEvent;
  if(typeof CustomEventCtor!=='function')return;
  const detail=Object.freeze({
    category_key:value.category_key??null,
    category_profile_version:value.category_profile_version??null,
    campaign_id:value.campaign_id??null,
    pool_version_id:value.pool_version_id??null
  });
  root.dispatchEvent(new CustomEventCtor(type,{detail,bubbles:true}));
}
```

No action waits for an event consumer or treats dispatch failure as operation failure.

- [ ] **Step 4: Run GREEN**

```bash
node --test test/unit/catalog-panel.test.mjs test/unit/catalog-polling-isolation.test.mjs test/unit/catalog-module-namespace.test.mjs
```

Expected: panel, lifecycle, namespace, OPEN_ENDED, QA, activation, and capability transition PASS.

- [ ] **Step 5: Run related regression**

```bash
node --test test/unit/operator-campaign-ui.test.mjs test/unit/initial-pool-ui.test.mjs test/integration/operator-campaign-api.test.mjs test/integration/initial-pool-api.test.mjs test/integration/initial-pool-activation.test.mjs
```

- [ ] **Step 6: Check and commit exact paths**

```bash
git diff --check -- ui/modules/catalog/panel.js test/fixtures/catalog-panel-dom-fixture.mjs test/unit/catalog-panel.test.mjs
git add -- ui/modules/catalog/panel.js test/fixtures/catalog-panel-dom-fixture.mjs test/unit/catalog-panel.test.mjs
git diff --cached --name-only
git commit -m "feat: render Catalog operator panel in its root"
```

---

### Task 5: Shared Mount Roots Without Breaking the Legacy Page

**Files:**
- Modify: `ui/index.html`
- Create: `test/unit/catalog-shared-shell.test.mjs`
- Create: `test/integration/catalog-static-module.test.mjs`

**Interfaces:**
- Produces: stable `#catalog-module-root` and empty `#yingdao-module-root` siblings.
- Preserves temporarily: the existing inline Catalog panel inside `#catalog-module-root` until Task 6 atomically switches `app.js` and empties the root.
- Proves: nested `/modules/catalog/*.js` static delivery.
- Consumed by: Task 6.

- [ ] **Step 1: Write RED shared-root and static-delivery tests**

```js
test('shared shell exposes distinct Catalog and empty YingDao roots',()=>{
  assert.match(html,/id="catalog-module-root"/);
  assert.match(html,/id="yingdao-module-root"[^>]*><\/section>/);
  assert.ok(html.indexOf('catalog-module-root')<html.indexOf('yingdao-module-root'));
});

test('nested Catalog module is served as JavaScript',async t=>{
  const response=await requestStatic('/modules/catalog/panel.js');
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/javascript/);
  assert.match(await response.text(),/mountCatalogPanel/);
});
```

The static test starts only the static handler/server against the repository `ui` directory; it does not start Dashboard recovery or open a database.

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/catalog-shared-shell.test.mjs test/integration/catalog-static-module.test.mjs
```

Expected: shared-root test FAIL because neither mount root exists; nested module serving may already PASS and is retained as regression evidence.

- [ ] **Step 3: Add the roots with an intermediate compatibility wrapper**

Wrap the existing inline Catalog panel in:

```html
<section id="catalog-module-root" aria-label="Temu 商品采集">
  <!-- existing operator panel remains here until Task 6 -->
</section>
<section id="yingdao-module-root" aria-label="1688 / 影刀寻源"></section>
```

Do not move or rename legacy Browser Health/Jobs/Excel/Review markup.

- [ ] **Step 4: Run GREEN**

```bash
node --test test/unit/catalog-shared-shell.test.mjs test/integration/catalog-static-module.test.mjs test/unit/operator-campaign-console.test.mjs
```

Expected: roots/static serving PASS and the still-unmigrated legacy panel remains functional for this intermediate commit.

- [ ] **Step 5: Run related regression**

```bash
node --test test/integration/operator-launcher-health.test.mjs test/unit/operator-campaign-console.test.mjs
```

- [ ] **Step 6: Check and commit exact paths**

```bash
git diff --check -- ui/index.html test/unit/catalog-shared-shell.test.mjs test/integration/catalog-static-module.test.mjs
git add -- ui/index.html test/unit/catalog-shared-shell.test.mjs test/integration/catalog-static-module.test.mjs
git diff --cached --name-only
git commit -m "feat: add shared Catalog and YingDao mount roots"
```

---

### Task 6: Reduce `ui/app.js` to Legacy Shell Plus Catalog Mount

**Files:**
- Modify: `ui/app.js`
- Modify: `ui/index.html`
- Modify: `test/unit/operator-campaign-console.test.mjs`
- Create: `test/unit/catalog-app-shell.test.mjs`

**Interfaces:**
- Consumes: `mountCatalogPanel` and the roots from Tasks 1-5.
- Produces: one Catalog mount and no legacy Catalog implementation in `app.js`.
- Preserves: legacy `render`, Browser Health, Jobs, Excel, Review, reset, notice/toast, and `/api/status` timer.

- [ ] **Step 1: Write RED source-contract tests before deleting old code**

```js
test('app.js is legacy shell plus one Catalog mount',()=>{
  assert.match(app,/import\s*\{\s*mountCatalogPanel\s*\}\s*from\s*['"]\.\/modules\/catalog\/panel\.js['"]/);
  assert.match(app,/mountCatalogPanel\(\{root:catalogRoot\}\)/);
  for(const forbidden of [
    'operatorProfiles','selectedOperatorProfile','currentOperatorCampaign','operatorRequestId',
    'loadOperatorProfiles','refreshOperatorCurrent','renderOperatorCurrent',
    'createOperatorCampaign','runInitialQa','activateInitial'
  ])assert.doesNotMatch(app,new RegExp(`\\b${forbidden}\\b`));
});

test('legacy Dashboard ownership remains in app.js',()=>{
  for(const retained of [
    'renderBrowserHealth','renderHistory','renderEvents','renderControls','renderNotice',
    '/api/status','/api/export','/api/clear/excel','/api/reviews/'
  ])assert.match(app,new RegExp(escapeRegex(retained)));
});

test('legacy timer no longer refreshes Catalog',()=>{
  assert.match(app,/setInterval\(\(\)=>\s*\{?\s*refresh\(\)/);
  assert.doesNotMatch(app,/setInterval[\s\S]{0,120}refreshOperatorCurrent/);
});
```

Update console tests to assert `catalog-*` markup is supplied by `panel.js`, not inline HTML.

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/catalog-app-shell.test.mjs test/unit/operator-campaign-console.test.mjs
```

Expected: FAIL because `app.js` still contains all old Catalog globals/functions/handlers and does not mount the module.

- [ ] **Step 3: Perform the atomic shared-shell cutover**

In `ui/app.js`:

1. Replace the old helper import with `mountCatalogPanel`.
2. Remove Catalog entries from the global `elements` object.
3. Delete Catalog state globals and every Catalog function/handler.
4. Delete Catalog event listener registration.
5. Mount once using only `#catalog-module-root`.
6. Change startup to `await refresh();` plus non-blocking Catalog mount.
7. Change legacy interval to call only `refresh()`.

In `ui/index.html`, replace the compatibility-wrapped old Catalog markup with the empty root:

```html
<section id="catalog-module-root" aria-label="Temu 商品采集"></section>
<section id="yingdao-module-root" aria-label="1688 / 影刀寻源"></section>
```

Do not alter any legacy section below these roots.

- [ ] **Step 4: Run GREEN**

```bash
node --test test/unit/catalog-app-shell.test.mjs test/unit/operator-campaign-console.test.mjs test/unit/catalog-shared-shell.test.mjs test/unit/catalog-panel.test.mjs
```

Expected: no Catalog duplicate remains; the module owns all Catalog behavior.

- [ ] **Step 5: Run related regression and syntax check**

```bash
node --check ui/app.js
node --check ui/modules/catalog/panel.js
node --test test/unit/operator-campaign-ui.test.mjs test/unit/initial-pool-ui.test.mjs test/integration/operator-campaign-api.test.mjs test/integration/initial-pool-api.test.mjs test/integration/operator-launcher-health.test.mjs
```

- [ ] **Step 6: Check and commit exact paths**

```bash
git diff --check -- ui/app.js ui/index.html test/unit/operator-campaign-console.test.mjs test/unit/catalog-app-shell.test.mjs
git add -- ui/app.js ui/index.html test/unit/operator-campaign-console.test.mjs test/unit/catalog-app-shell.test.mjs
git diff --cached --name-only
git commit -m "refactor: mount Catalog from the shared dashboard shell"
```

---

### Task 7: Extract Catalog CSS

**Files:**
- Create: `ui/modules/catalog/catalog.css`
- Modify: `ui/styles.css`
- Modify: `ui/index.html`
- Create: `test/unit/catalog-css-isolation.test.mjs`

**Interfaces:**
- Produces: Catalog styling under `catalog-*` selectors.
- Preserves: `.panel`, `.primary`, and `.eyebrow` as shared shell primitives without redefining them.
- Produces: one stylesheet link `/modules/catalog/catalog.css` in shared HTML.

- [ ] **Step 1: Write RED CSS namespace tests**

```js
test('Catalog stylesheet uses only catalog selectors and approved shared descendants',()=>{
  const selectors=css.match(/[^{}]+(?=\{)/g).map(value=>value.trim());
  for(const selector of selectors) {
    assert.match(selector,/\.catalog-|@media/);
    assert.doesNotMatch(selector,/(^|,)\s*\.(operator|initial)-/);
  }
});

test('shared stylesheet no longer owns Catalog-specific selectors',()=>{
  assert.doesNotMatch(sharedCss,/\.(operator-campaign|operator-form|operator-error|operator-current|initial-pool)-/);
  assert.match(html,/href="\/modules\/catalog\/catalog\.css"/);
});
```

Also assert that Browser Health, controls, metrics, workspace, history, events, and toast rules remain in `ui/styles.css`.

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/catalog-css-isolation.test.mjs
```

Expected: FAIL because `catalog.css` does not exist and old Catalog selectors remain shared.

- [ ] **Step 3: Move and rename only Catalog styles**

Translate the old visual rules to the new markup:

```text
.operator-campaign-panel -> .catalog-panel
.operator-form -> .catalog-form
.operator-error -> .catalog-error
.operator-current -> .catalog-current
.operator-current-grid -> .catalog-current-grid
.initial-pool-actions -> .catalog-initial-actions
.initial-pool-result -> .catalog-activation-result
```

Move corresponding responsive rules. Add the stylesheet link after `/styles.css`. Do not modify legacy visual rules.

- [ ] **Step 4: Run GREEN**

```bash
node --test test/unit/catalog-css-isolation.test.mjs test/unit/catalog-shared-shell.test.mjs
```

- [ ] **Step 5: Run related regression and static serving**

```bash
node --test test/integration/catalog-static-module.test.mjs test/unit/catalog-panel.test.mjs test/integration/operator-launcher-health.test.mjs
```

- [ ] **Step 6: Check and commit exact paths**

```bash
git diff --check -- ui/modules/catalog/catalog.css ui/styles.css ui/index.html test/unit/catalog-css-isolation.test.mjs
git add -- ui/modules/catalog/catalog.css ui/styles.css ui/index.html test/unit/catalog-css-isolation.test.mjs
git diff --cached --name-only
git commit -m "style: isolate Catalog module presentation"
```

---

### Task 8: Strict Scoped Pool Products GET API

**Files:**
- Create: `src/db/repositories/catalog-pool-read-repository.mjs`
- Modify: `src/server/controllers/catalog-controller.mjs`
- Modify: `src/server/index.mjs`
- Modify: `src/server/router.mjs`
- Modify: `ui/modules/catalog/api.js`
- Create: `test/integration/catalog-pool-products-api.test.mjs`

**Interfaces:**
- Produces: `createCatalogPoolReadRepository(db)`.
- Produces: `listPoolProducts({poolVersionId,categoryKey,categoryProfileVersion})`.
- Produces: `catalogController.poolProducts(poolVersionId,searchParams)`.
- Produces: `GET /api/catalog/pools/:pool_version_id/products?category_key=...&category_profile_version=...`.
- Produces: `catalogApi.listPoolProducts({poolVersionId,categoryKey,categoryProfileVersion})`.

- [ ] **Step 1: Write RED integration tests using temporary SQLite**

Seed one Category B Pool with goods IDs `0002`, `10`, and `2`, Pool-bound staging title/image URLs, and image-cache evidence only for `0002`.

```js
test('Pool Products GET returns exact deterministic Pool-bound evidence with zero writes',async t=>{
  const fixture=await poolApiFixture(t),before=databaseFingerprint(fixture.app.db);
  const response=await fixture.get(`/api/catalog/pools/${fixture.pool.id}/products?category_key=${fixture.categoryKey}&category_profile_version=${fixture.profileVersion}`);
  const body=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(body.scope,{
    pool_version_id:fixture.pool.id,category_key:fixture.categoryKey,
    category_profile_version:fixture.profileVersion
  });
  assert.deepEqual(body.products.map(row=>row.goods_id),['0002','10','2']);
  assert.deepEqual(body.products.map(row=>row.image_status),['OK','MISS','MISS']);
  assert.deepEqual(databaseFingerprint(fixture.app.db),before);
});

test('missing or mismatched scope hard fails with zero writes and no fallback',async t=>{
  const fixture=await poolApiFixture(t);
  for(const [path,status,code] of [
    [`/api/catalog/pools/${fixture.pool.id}/products`,400,'CATALOG_POOL_SCOPE_REQUIRED'],
    [`/api/catalog/pools/${fixture.pool.id}/products?category_key=other&category_profile_version=${fixture.profileVersion}`,409,'CATALOG_POOL_SCOPE_MISMATCH'],
    [`/api/catalog/pools/missing/products?category_key=${fixture.categoryKey}&category_profile_version=${fixture.profileVersion}`,404,'CATALOG_POOL_NOT_FOUND']
  ])await assertReadZeroWrite(fixture,path,status,code);
});

test('Pool Products route is GET only',async t=>{
  const fixture=await poolApiFixture(t),before=databaseFingerprint(fixture.app.db);
  const response=await fixture.post(`/api/catalog/pools/${fixture.pool.id}/products`,{});
  assert.equal(response.status,404);
  assert.deepEqual(databaseFingerprint(fixture.app.db),before);
});
```

`databaseFingerprint` serializes ordered rows from every non-SQLite table, excluding `schema_migrations` timing only if the fixture has already completed migration before the before-snapshot. It must compare row values, not only counts.

- [ ] **Step 2: Run RED**

```bash
node --test test/integration/catalog-pool-products-api.test.mjs
```

Expected: FAIL with 404 for the missing GET route.

- [ ] **Step 3: Implement exact read repository**

Validate non-empty strings, load the Pool by ID only, then compare exact scope. Query:

```sql
SELECT i.platform,i.goods_id,s.latest_title AS title,s.image_url,
  CASE WHEN EXISTS(
    SELECT 1 FROM products p JOIN product_images pi ON pi.product_id=p.id
    WHERE p.platform=i.platform AND p.external_product_id=i.goods_id
      AND pi.source_url=s.image_url
      AND pi.download_status='completed'
      AND pi.local_path IS NOT NULL AND TRIM(pi.local_path)<>''
  ) THEN 'OK' ELSE 'MISS' END AS image_status
FROM catalog_pool_version_items i
JOIN catalog_staging_products s ON s.id=i.staging_product_id
WHERE i.pool_version_id=? AND i.category_key=?
ORDER BY i.platform COLLATE BINARY ASC,i.goods_id COLLATE BINARY ASC
```

Return every identity as a string. Do not start a transaction, update timestamps, write audit events, or invoke Campaign/QA/Activation services.

- [ ] **Step 4: Register only the GET route and inject the reader**

Instantiate `createCatalogPoolReadRepository(db)` in `createOperationsServer` and inject it into `createCatalogController`. Add:

```js
const poolProducts=url.pathname.match(/^\/api\/catalog\/pools\/([^/]+)\/products$/);
if(request.method==='GET'&&poolProducts){
  const result=catalogController.poolProducts(decodeURIComponent(poolProducts[1]),url.searchParams);
  return json(response,200,{ok:true,...result},CATALOG_HEADERS);
}
```

Map `CATALOG_POOL_NOT_FOUND` to 404 and `CATALOG_POOL_SCOPE_MISMATCH` to 409; missing scope remains 400. Do not register POST/PUT/PATCH/DELETE.

- [ ] **Step 5: Run GREEN**

```bash
node --test test/integration/catalog-pool-products-api.test.mjs
```

Expected: exact scope/order/image status PASS and `CATALOG_POOL_READ_DB_WRITES=0` by row fingerprint.

- [ ] **Step 6: Run related regression and syntax checks**

```bash
node --check src/db/repositories/catalog-pool-read-repository.mjs
node --check src/server/controllers/catalog-controller.mjs
node --check src/server/index.mjs
node --check src/server/router.mjs
node --check ui/modules/catalog/api.js
node --test test/integration/operator-campaign-api.test.mjs test/integration/initial-pool-api.test.mjs test/integration/multi-category-isolation.test.mjs test/integration/export-multi-category.test.mjs test/integration/operator-launcher-health.test.mjs
```

- [ ] **Step 7: Check and commit exact paths**

```bash
git diff --check -- src/db/repositories/catalog-pool-read-repository.mjs src/server/controllers/catalog-controller.mjs src/server/index.mjs src/server/router.mjs ui/modules/catalog/api.js test/integration/catalog-pool-products-api.test.mjs
git add -- src/db/repositories/catalog-pool-read-repository.mjs src/server/controllers/catalog-controller.mjs src/server/index.mjs src/server/router.mjs ui/modules/catalog/api.js test/integration/catalog-pool-products-api.test.mjs
git diff --cached --name-only
git commit -m "feat: expose scoped Catalog Pool products read API"
```

---

### Task 9: Dual-module Isolation Regression and Final Delivery Manifest

**Files:**
- Create: `test/unit/catalog-dual-module-isolation.test.mjs`
- Create: `test/unit/catalog-ui-delivery-verifier.test.mjs`
- Create: `scripts/verify-catalog-ui-delivery.mjs`
- Modify: `package.json`
- Create: `docs/superpowers/manifests/2026-09-01-catalog-ui-delivery-manifest.md`

**Interfaces:**
- Produces: `npm run qa:catalog-ui-delivery`.
- Produces: final JSON Gate report without production config/database/browser use.
- Produces: complete `Catalog UI Delivery Manifest` for the YingDao window.
- Produces: final cumulative `SHARED_UI_COMMIT` at Task 9 HEAD.

- [ ] **Step 1: Write RED dual-module isolation tests**

Use the Task 4 DOM fixture with a separate YingDao root/state/control sentinel:

```js
test('Catalog refresh loading error rerender and destroy leave YingDao untouched',async()=>{
  const fixture=catalogDomFixture({withYingdao:true});
  fixture.yingdaoRoot.innerHTML='<button id="yingdao-run">运行</button>';
  const before={html:fixture.yingdaoRoot.innerHTML,state:structuredClone(fixture.yingdaoState)};
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api:sequenceApi([
    successContext('catalog-campaign-1'),new Error('catalog offline')
  ]),scheduler:fixture.scheduler});
  await panel.refresh();await panel.refresh();panel.destroy();
  assert.equal(fixture.yingdaoRoot.innerHTML,before.html);
  assert.deepEqual(fixture.yingdaoState,before.state);
  assert.equal(fixture.yingdaoState.run_id,'yingdao-run-1');
});

test('Catalog works with no YingDao root and events are not required',async()=>{
  const fixture=catalogDomFixture({withYingdao:false,customEventAvailable:false});
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api:successApi(),scheduler:fixture.scheduler});
  await panel.refresh();panel.destroy();
});
```

Add source assertions that Catalog code never queries `yingdao-module-root`, `yingdaoState`, `random5State`, or `currentRun`, and never assigns `document.body.innerHTML`.

Create a separate verifier contract test before the verifier exists:

```js
import { runCatalogUiDeliveryVerification } from '../../scripts/verify-catalog-ui-delivery.mjs';

test('Catalog UI verifier uses temporary state and reports every required Gate',async()=>{
  const result=await runCatalogUiDeliveryVerification();
  assert.equal(result.productionDatabaseWrites,0);
  assert.equal(result.realTemuCaptureStarted,false);
  assert.equal(result.yingdaoBusinessImplemented,false);
  assert.equal(result.gates.CATALOG_UI_NAMESPACE_ISOLATED,'YES');
  assert.equal(result.gates.YINGDAO_UI_ROOT_PRESERVED,'YES');
  assert.equal(result.gates.CATALOG_POOL_READ_DB_WRITES,0);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/catalog-dual-module-isolation.test.mjs test/unit/catalog-ui-delivery-verifier.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/verify-catalog-ui-delivery.mjs`. If an isolation assertion also fails, correct only the violating Catalog root/state/polling behavior in files already owned by Tasks 1-8; do not change YingDao or legacy Dashboard code.

- [ ] **Step 3: Make the minimum isolation corrections and implement verifier**

The verifier must reject `TEMU_CONFIG_PATH`, `--config`, and arbitrary database paths. It performs static scans plus temporary server/SQLite Pool-read verification, then prints:

```json
{
  "productionDatabaseWrites": 0,
  "realTemuCaptureStarted": false,
  "yingdaoBusinessImplemented": false,
  "gates": {
    "CATALOG_UI_NAMESPACE_ISOLATED": "YES",
    "CATALOG_API_NAMESPACE_ISOLATED": "YES",
    "CATALOG_STATE_ISOLATED": "YES",
    "CATALOG_POLLING_ISOLATED": "YES",
    "YINGDAO_UI_ROOT_PRESERVED": "YES",
    "YINGDAO_ROOT_REQUIRED_BY_CATALOG": "NO",
    "CATALOG_EVENTS_REQUIRED_FOR_YINGDAO_CORRECTNESS": "NO",
    "APP_JS_CATALOG_DUPLICATE_IMPLEMENTATION": "NO",
    "CATALOG_POOL_READ_DB_WRITES": 0,
    "CATALOG_POOL_READ_GLOBAL_FALLBACK": "NO"
  }
}
```

Add to `package.json`:

```json
"qa:catalog-ui-delivery": "node scripts/verify-catalog-ui-delivery.mjs"
```

- [ ] **Step 4: Run GREEN focused feature suite**

```bash
node --test test/unit/catalog-module-namespace.test.mjs test/unit/catalog-state-model-api.test.mjs test/unit/catalog-polling-isolation.test.mjs test/unit/catalog-panel.test.mjs test/unit/catalog-shared-shell.test.mjs test/unit/catalog-app-shell.test.mjs test/unit/catalog-css-isolation.test.mjs test/unit/catalog-dual-module-isolation.test.mjs test/unit/catalog-ui-delivery-verifier.test.mjs test/integration/catalog-static-module.test.mjs test/integration/catalog-pool-products-api.test.mjs
npm run qa:catalog-ui-delivery
```

Expected: every new Catalog UI Delivery test PASS.

- [ ] **Step 5: Run all related regressions**

```bash
node --test test/unit/operator-campaign-ui.test.mjs test/unit/operator-campaign-console.test.mjs test/unit/initial-pool-ui.test.mjs test/unit/catalog-manual-passive-runner.test.mjs test/integration/operator-campaign-create.test.mjs test/integration/operator-campaign-api.test.mjs test/integration/initial-campaign-create.test.mjs test/integration/initial-manual-capture.test.mjs test/integration/initial-pool-qa.test.mjs test/integration/initial-pool-activation.test.mjs test/integration/initial-pool-api.test.mjs test/integration/catalog-manual-binding.test.mjs test/integration/multi-category-isolation.test.mjs test/integration/classification-multi-category.test.mjs test/integration/export-multi-category.test.mjs test/integration/operator-launcher-health.test.mjs
npm run check
```

Expected: `RELATED_REGRESSION_TESTS=PASS` with no failure in touched safety paths.

- [ ] **Step 6: Run full suite and compare exact baseline identities**

```bash
npm test
```

Record file, test name, assertion/error class, actual, and expected for every failure. Accept only:

```text
KNOWN_BASELINE_FAILURES = exact same 7
NEW_FAILURES = 0
```

Seven failures with any identity substitution is a failure.

- [ ] **Step 7: Perform static shared-file and forbidden-scope audit**

```bash
rg -n "operatorProfiles|selectedOperatorProfile|currentOperatorCampaign|refreshOperatorCurrent|renderOperatorCurrent|createOperatorCampaign|runInitialQa|activateInitial" ui/app.js
rg -n "yingdao-module-root|yingdaoState|random5State|currentRun|document\.body\.innerHTML" ui/modules/catalog
rg -n "latest|global active|UPDATE|INSERT|DELETE" src/db/repositories/catalog-pool-read-repository.mjs
git diff --name-only 694d449..HEAD -- db/migrations
git status --short
```

Expected:

```text
app.js forbidden Catalog duplicate hits = 0
Catalog dependency/mutation hits on YingDao/body = 0
Pool reader write SQL hits = 0
feature migration diffs = 0
working tree CRLF diffs = exact approved 9 only before Task 9 files are staged
```

- [ ] **Step 8: Write the complete Delivery Manifest**

Create `docs/superpowers/manifests/2026-09-01-catalog-ui-delivery-manifest.md` with exact headings:

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

The manifest must state:

- Catalog owns `#catalog-module-root`; YingDao owns `#yingdao-module-root`.
- `ui/app.js` safe YingDao edits are limited to import, resolving its own root, and mounting alongside Catalog.
- YingDao must not rewrite Catalog mount/controller, legacy refresh, or `/api/catalog/` write contracts.
- The Pool read identity is all three exact fields; events are optional.
- Localhost ownership is an integration contract, not enforced module authentication.
- `SHARED_UI_COMMIT` is cumulative final HEAD and must be used as the YingDao baseline, not cherry-picked alone.

- [ ] **Step 9: Check and commit exact Task 9 paths**

```bash
git diff --check -- test/unit/catalog-dual-module-isolation.test.mjs test/unit/catalog-ui-delivery-verifier.test.mjs scripts/verify-catalog-ui-delivery.mjs package.json docs/superpowers/manifests/2026-09-01-catalog-ui-delivery-manifest.md
git add -- test/unit/catalog-dual-module-isolation.test.mjs test/unit/catalog-ui-delivery-verifier.test.mjs scripts/verify-catalog-ui-delivery.mjs package.json docs/superpowers/manifests/2026-09-01-catalog-ui-delivery-manifest.md
git diff --cached --name-only
git commit -m "docs: publish Catalog UI delivery contract"
```

Cached paths must be exactly these five and contain no migration or YingDao business file.

## Design-to-Plan Coverage

| Design requirement | Implementation Task | Verification |
|---|---:|---|
| Root-rendered Catalog module and lifecycle | 1, 4 | Namespace/lifecycle/panel tests |
| Catalog-only state/model/API | 2 | State allowlist, endpoint, compatibility tests |
| Independent Catalog polling and destroy | 3 | Scheduler and foreign-timer tests |
| Initial/Expansion/QA/Activation UI | 4 | Action and QA matrix tests |
| Stable Catalog/YingDao mount roots | 5, 6 | Shell/static tests |
| `app.js` legacy shell with no duplicate Catalog | 6 | Source-contract and legacy-retention tests |
| Catalog CSS ownership | 7 | Selector/link/shared-style tests |
| Strict GET-only Pool Products API | 8 | Scope/method/order/image evidence tests |
| Pool read 0 database writes | 8, 9 | Full-row fingerprint and verifier |
| YingDao absence/untouched isolation | 1, 3, 4, 9 | Root/state/control/destroy tests |
| Events optional, scoped GET authoritative | 4, 9 | No-CustomEvent and manifest tests |
| Existing Initial safety preserved | 4, 9 | Initial related regression suite |
| No YingDao business implementation | All, 9 | Static audit and manifest |
| Exact seven baseline failures / no new failures | 9 | Full-suite identity comparison |
| Shared integration instructions | 9 | Committed Delivery Manifest |

Self-review result:

```text
SPEC_REQUIREMENTS_WITHOUT_TASK = 0
PLAN_PLACEHOLDERS = 0
INTERFACE_NAME_CONFLICTS = 0
SHARED_FILE_ATOMIC_CUTOVER = Task 6
YINGDAO_BUSINESS_TASKS = 0
DESIGN_TO_PLAN_COVERAGE = PASS
```

## Final Handoff Format

After Task 9, return:

```text
WORKTREE
BRANCH
TASK COMMITS 1-9
SHARED_UI_COMMIT = final cumulative Task 9 HEAD
CATALOG_UI_FILES_COMMITTED
SHARED_UI_FILES_TOUCHED
NEW_FEATURE_TESTS
RELATED_REGRESSION_TESTS
FULL_SUITE
KNOWN_BASELINE_FAILURES
NEW_FAILURES
GIT STATUS

CATALOG_UI_NAMESPACE_ISOLATED = YES / NO
CATALOG_API_NAMESPACE_ISOLATED = YES / NO
CATALOG_STATE_ISOLATED = YES / NO
CATALOG_POLLING_ISOLATED = YES / NO
YINGDAO_UI_ROOT_PRESERVED = YES / NO
YINGDAO_ROOT_REQUIRED_BY_CATALOG = YES / NO
CATALOG_EVENTS_REQUIRED_FOR_YINGDAO_CORRECTNESS = YES / NO
APP_JS_CATALOG_DUPLICATE_IMPLEMENTATION = YES / NO
CATALOG_POOL_READ_DB_WRITES = 0 / NONZERO
CATALOG_POOL_READ_GLOBAL_FALLBACK = YES / NO
INITIAL_OPEN_ENDED_CAPTURE_PRESERVED = YES / NO
QA_STALE_PRESERVED = YES / NO
ACTIVATION_MUTEX_PRESERVED = YES / NO
CATEGORY_ISOLATION_PRESERVED = YES / NO
EXPLICIT_CAMPAIGN_PRESERVED = YES / NO
YINGDAO_BUSINESS_IMPLEMENTED = YES / NO
SHARED_FILE_WORKTREE_CLEAN = YES / NO
DO_NOT_PUSH = OBSERVED / VIOLATED
```

`SHARED_FILE_WORKTREE_CLEAN` evaluates only shared files owned/touched by this plan. The pre-existing nine CRLF migration diffs may remain dirty and must be reported separately.
