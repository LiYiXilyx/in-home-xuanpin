# Operator Campaign Create UI V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator create and select a new explicitly scoped `MANUAL_BIND_PASSIVE_CAPTURE` Campaign from the localhost console by entering only a Category Profile, task name, and requested-new count.

**Architecture:** A filesystem-backed validated Category Profile Registry feeds three explicit Catalog operator endpoints. A single Catalog Campaign Service transaction resolves the selected Profile and Active Pool, computes the target, creates and baselines a new Campaign, creates and claims its queue, writes an `UNBOUND` checkpoint, and returns the exact context. The localhost UI is a client of that API; the Temu-page extension remains the only detection/binding/capture surface.

**Tech Stack:** Node.js ESM, `node:sqlite` synchronous SQLite, existing HTTP router/controllers, vanilla HTML/CSS/ES modules, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-31-operator-campaign-create-ui-v1-design.md`

## Global Constraints

- Work only in `/private/tmp/temu-multi-category-safety-v1` on `codex/multi-category-safety-v1`.
- Do not push, start real Temu capture, write production SQLite, or modify the dirty source worktree.
- All write tests use temporary SQLite databases and temporary Profile directories.
- Preserve product identity as `platform + goods_id`.
- No implicit Campaign resume, latest-Campaign selection, queue cancellation/deletion, or cross-category fallback.
- Active Pool must exist, be unique, be positive, and reconcile with the selected Profile's complete membership scope.
- Target is always calculated by the server as `baseline_count + requested_new_count`.
- Successful creation stops at `UNBOUND`; automatic scroll/navigation/pagination/See more/category switching/CAPTCHA/capture remain off.
- Keep the existing CLI available for development/diagnostics.
- The approved full-suite baseline is exactly seven failures by file, test name, and reason; new failures are forbidden.

---

### Task 1: Validated Category Profile Registry

**Files:**
- Create: `src/modules/catalog-scale/category-profile-registry.mjs`
- Create: `test/unit/category-profile-registry.test.mjs`

**Interfaces:**
- Produces: `createCategoryProfileRegistry({ directory })`.
- Produces: `registry.list()` returning `{ profiles,invalid }`.
- Produces: `registry.resolve({ categoryKey,categoryProfileVersion })` returning one validated frozen Profile or throwing `CATEGORY_PROFILE_NOT_FOUND` / `CATEGORY_PROFILE_VERSION_MISMATCH`.
- Depends on: existing `loadCategoryProfile()` / `validateCategoryProfile()` and `AppError`.

- [ ] **Step 1: Write failing Registry tests**

Create temporary Profile files and assert real filesystem behavior:

```js
test('registry discovers valid profiles and resolves only exact key plus version',async t => {
  const directory=temporaryProfiles(t);
  writeProfile(directory,'motorcycle.json',motorcycleProfile());
  const registry=createCategoryProfileRegistry({ directory });
  const listed=await registry.list();
  assert.deepEqual(listed.profiles.map(x=>[x.category_key,x.category_profile_version]),[
    ['motorcycle-accessories','motorcycle-accessories-v1']
  ]);
  assert.equal((await registry.resolve({categoryKey:'motorcycle-accessories',categoryProfileVersion:'motorcycle-accessories-v1'})).display_name,'Motorcycle Accessories');
  await assert.rejects(()=>registry.resolve({categoryKey:'motorcycle-accessories',categoryProfileVersion:'wrong-v2'}),error=>error.code==='CATEGORY_PROFILE_VERSION_MISMATCH');
});

test('invalid and duplicate profiles cannot enter the selectable registry',async t => {
  const directory=temporaryProfiles(t);
  writeProfile(directory,'invalid.json',{category_key:'invalid'});
  writeProfile(directory,'a.json',motorcycleProfile());
  writeProfile(directory,'b.json',motorcycleProfile());
  await assert.rejects(()=>createCategoryProfileRegistry({directory}).list(),error=>error.code==='CATEGORY_PROFILE_DUPLICATE');
});
```

- [ ] **Step 2: Run the Registry tests and verify RED**

Run:

```bash
node --test test/unit/category-profile-registry.test.mjs
```

Expected: FAIL because `category-profile-registry.mjs` does not exist.

- [ ] **Step 3: Implement the Registry**

Implement a fresh scan on every `list()` / `resolve()` so new configuration appears without server restart while Campaign history remains frozen:

```js
export function createCategoryProfileRegistry({directory}) {
  const root=path.resolve(requiredDirectory(directory));
  async function scan() {
    const names=(await fs.readdir(root,{withFileTypes:true}))
      .filter(entry=>entry.isFile()&&entry.name.endsWith('.json')).map(entry=>entry.name).sort();
    const profiles=[],invalid=[],identities=new Map();
    for(const name of names){
      try {
        const profile=await loadCategoryProfile(path.join(root,name));
        const identity=`${profile.category_key}\u001f${profile.category_profile_version}`;
        if(identities.has(identity)) throw appError('CATEGORY_PROFILE_DUPLICATE',{identity,sourceNames:[identities.get(identity),name]});
        identities.set(identity,name);profiles.push(profile);
      } catch(error) {
        if(error.code==='CATEGORY_PROFILE_DUPLICATE')throw error;
        invalid.push({source_name:name,error_code:error.code??'CATEGORY_PROFILE_INVALID',message:error.message});
      }
    }
    return {profiles,invalid};
  }
  return {list:scan,resolve:async input=>resolveExact(await scan(),input)};
}
```

Do not expose the absolute Profile directory or accept a directory via HTTP.

- [ ] **Step 4: Run Registry tests and static check**

```bash
node --test test/unit/category-profile-registry.test.mjs
node --check src/modules/catalog-scale/category-profile-registry.mjs
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/modules/catalog-scale/category-profile-registry.mjs test/unit/category-profile-registry.test.mjs
git commit -m "feat: discover validated category profiles"
```

---

### Task 2: Atomic Operator Campaign Creation Service

**Files:**
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`
- Modify: `src/db/repositories/catalog-campaign-repository.mjs`
- Create: `test/integration/operator-campaign-create.test.mjs`

**Interfaces:**
- Produces: `catalogService.describeOperatorProfile(profile)`.
- Produces: `catalogService.createOperatorManualCampaign({profile,requestedNewCount,campaignName,requestId})`.
- Produces: `catalogService.currentOperatorManualContext()` returning `null` or one explicit Manual Bind context.
- Produces repository helpers `findCampaignByName(name)` and `findOperatorCampaignByRequestId(requestId)`.
- Preserves existing public `createCampaign()` semantics.

- [ ] **Step 1: Write the happy-path failing integration test**

Use a temporary migrated SQLite database. Build an Active Pool of two Motorcycle products through the existing service, then create the operator Campaign:

```js
test('operator create computes target from exact Active Pool and claims an UNBOUND manual context',async t => {
  const {db,service,profile}=await fixtureWithActivePool(t,['9001','9002']);
  const result=service.createOperatorManualCampaign({
    profile,requestedNewCount:10,campaignName:'operator-manual-10',requestId:'operator-request-1'
  });
  assert.equal(result.baselineCount,2);
  assert.equal(result.requestedNewCount,10);
  assert.equal(result.targetCount,12);
  assert.equal(result.captureMode,'MANUAL_BIND_PASSIVE_CAPTURE');
  assert.equal(result.currentUnique,2);
  assert.equal(result.remaining,10);
  const stored=db.prepare('SELECT * FROM catalog_campaigns WHERE id=?').get(result.campaignId);
  assert.equal(stored.category_key,profile.category_key);
  assert.equal(stored.category_profile_version,profile.category_profile_version);
  assert.equal(stored.baseline_pool_count,2);
  assert.equal(stored.target_count,12);
  assert.equal(stored.status,'running');
  assert.equal(JSON.parse(stored.config_json).categoryProfile.taxonomy_bindings.opportunity.taxonomy_version,'motorcycle-opportunity-v2');
  const context=service.currentOperatorManualContext();
  assert.equal(context.campaign.id,result.campaignId);
  assert.equal(context.queue.checkpoint.runner_state,'UNBOUND');
  assert.equal(context.queue.checkpoint.automatic_scroll,false);
  assert.equal(context.queue.checkpoint.automatic_navigation,false);
  assert.equal(context.queue.checkpoint.automatic_see_more,false);
});
```

- [ ] **Step 2: Run the happy-path test and verify RED**

```bash
node --test --test-name-pattern="operator create computes" test/integration/operator-campaign-create.test.mjs
```

Expected: FAIL because `createOperatorManualCampaign` is missing.

- [ ] **Step 3: Add transaction-neutral internal creation and repository lookups**

Refactor without changing public behavior:

```js
function createCampaignRecord({id=null,name,campaignType='expansion',profile,baselinePoolCount=0,targetCount=null,browserContext=null,configExtras={}}){
  const validated=validateCategoryProfile(profile);
  assertExpansionBaselineRequest(validated,campaignType,baselinePoolCount);
  let campaign=repository.createCampaign({id:id||undefined,name,campaignType,
    categoryKey:validated.category_key,categoryProfileVersion:validated.category_profile_version,
    targetGate:validated.business_rules.default_gate,targetCount:targetCount??validated.target_count,
    baselinePoolCount,config:{categoryProfile:validated,...configExtras}});
  if(browserContext)campaign=repository.setCampaignBrowserContext(campaign.id,browserContext);
  if(campaignType==='refresh'||campaignType==='expansion'){
    repository.captureCampaignBaseline(campaign.id);campaign=repository.getCampaign(campaign.id);
  }
  return campaign;
}

function createCampaign(input){return transaction(db,()=>createCampaignRecord(input));}
```

Repository lookup must use exact JSON extraction and exact name equality:

```js
function findOperatorCampaignByRequestId(requestId){
  return mapCampaign(db.prepare(`SELECT * FROM catalog_campaigns
    WHERE json_extract(config_json,'$.operatorCreate.requestId')=? ORDER BY created_at,id`).get(requestId));
}
function findCampaignByName(name){return mapCampaign(db.prepare('SELECT * FROM catalog_campaigns WHERE name=?').get(name));}
```

- [ ] **Step 4: Implement atomic operator creation**

Inside one `transaction(db, ...)`:

```js
function createOperatorManualCampaign(input){
  const profile=validateCategoryProfile(input.profile);
  const requestedNewCount=positiveInteger(input.requestedNewCount,'requestedNewCount');
  const campaignName=requiredString(input.campaignName,'campaignName',200);
  const requestId=requiredString(input.requestId,'requestId',128);
  return transaction(db,()=>{
    const replay=repository.findOperatorCampaignByRequestId(requestId);
    if(replay)return exactOperatorReplay(replay,{profile,requestedNewCount,campaignName,requestId});
    if(repository.listActiveRpaQueues().length)throw coded('CATALOG_RPA_CLAIM_CONFLICT');
    if(repository.findCampaignByName(campaignName))throw coded('CAMPAIGN_NAME_CONFLICT');
    const baseline=requiredOperatorBaseline(repository.getBaselineConsistency(profile));
    const targetCount=baseline.activePoolVersionCount+requestedNewCount;
    if(targetCount>profile.target_count)throw coded('CATALOG_TARGET_INVALID');
    let campaign=createCampaignRecord({name:campaignName,campaignType:'expansion',profile,
      baselinePoolCount:baseline.activePoolVersionCount,targetCount,
      browserContext:{profileName:'Temu1店',profileDirectory:'Profile 10',controlMode:'MANUAL_BIND_PASSIVE_CAPTURE'},
      configExtras:{operatorCreate:{requestId,requestedNewCount,captureMode:'MANUAL_BIND_PASSIVE_CAPTURE'}}});
    assertFrozenBaseline(campaign,baseline);
    const source=repository.createSource(campaign,{sourceKey:'manual-bind-passive',sourceType:'category',
      sortOrder:profile.sort_order,priority:1,targetQuota:requestedNewCount,
      navigationHint:{entryMethod:'human_navigation_only',automaticNavigation:false,automaticScroll:false,
        automaticPagination:false,automaticSeeMore:false,automaticCategorySwitching:false,automaticSortSwitching:false,
        automaticCaptchaHandling:false,directApi:false}});
    campaign=repository.transitionCampaign(campaign.id,'running');
    const pending=repository.getNextRpaQueue(campaign.id);
    const queue=repository.claimRpaQueue(pending.id,createId('catalog_claim'));
    repository.createSourceRun(source.id,queue.attemptCount);
    repository.transitionSource(source.id,'capturing');
    const checkpoint={runner_state:'UNBOUND',capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',capture_paused:true,
      automatic_scroll:false,automatic_navigation:false,automatic_pagination:false,automatic_see_more:false,
      automatic_category_switching:false,automatic_sort_switching:false,automatic_captcha_handling:false,direct_api:false,
      capture_origin_unique:baseline.activePoolVersionCount,session_target:targetCount,last_action:'operator_campaign_created'};
    repository.transitionRpaQueue(queue.id,'capturing',{checkpoint,clearError:true});
    return operatorSummary(repository.getCampaign(campaign.id),repository.getRpaQueue(queue.id),false);
  });
}
```

`requiredOperatorBaseline()` must require exactly one Active Pool record, positive identity count, `consistent=true`, declared/row/identity/goods counts equal, and exact membership intersection. Missing Pool throws `INITIAL_ACTIVE_POOL_REQUIRED`; all other mismatches throw `CATALOG_BASELINE_INCONSISTENT`.

- [ ] **Step 5: Run the happy-path test and existing Campaign tests**

```bash
node --test --test-name-pattern="operator create computes" test/integration/operator-campaign-create.test.mjs
node --test test/integration/catalog-campaign.test.mjs test/integration/catalog-rpa.test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Write failing hard-fail, rollback, old-Campaign, and idempotency tests**

Add separate tests that snapshot row counts and protected Campaign fields before each operation:

```js
test('active queue conflict causes zero writes and never resumes paused Full Refresh',async t => {
  const fixture=await fixtureWithProtectedPausedCampaignAndActiveQueue(t);
  const before=databaseFingerprint(fixture.db);
  assert.throws(()=>fixture.service.createOperatorManualCampaign(request(fixture.profile)),error=>error.code==='CATALOG_RPA_CLAIM_CONFLICT');
  assert.deepEqual(databaseFingerprint(fixture.db),before);
  assert.deepEqual(protectedCampaign(fixture.db),fixture.protectedBefore);
});

test('missing or inconsistent Active Pool hard fails with zero writes',async t => {
  const fixture=await fixtureWithoutActivePool(t);const before=databaseFingerprint(fixture.db);
  assert.throws(()=>fixture.service.createOperatorManualCampaign(request(fixture.profile)),error=>error.code==='INITIAL_ACTIVE_POOL_REQUIRED');
  assert.deepEqual(databaseFingerprint(fixture.db),before);
});

test('same request is idempotent but changed fields or a different request cannot reuse Campaign',async t => {
  const fixture=await fixtureWithActivePool(t,['9001']);const input=request(fixture.profile);
  const first=fixture.service.createOperatorManualCampaign(input);
  const replay=fixture.service.createOperatorManualCampaign(input);
  assert.equal(replay.campaignId,first.campaignId);assert.equal(replay.idempotentReplay,true);
  assert.throws(()=>fixture.service.createOperatorManualCampaign({...input,requestedNewCount:2}),error=>error.code==='OPERATOR_CREATE_IDEMPOTENCY_CONFLICT');
  assert.throws(()=>fixture.service.createOperatorManualCampaign({...input,requestId:'different-request'}),error=>error.code==='CATALOG_RPA_CLAIM_CONFLICT');
});
```

Install a temporary SQLite trigger that aborts the later source insert, then prove the preceding Campaign and baseline writes roll back:

```js
db.exec(`CREATE TRIGGER fixture_fail_manual_source BEFORE INSERT ON catalog_sources
  WHEN NEW.source_key='manual-bind-passive'
  BEGIN SELECT RAISE(ABORT,'fixture source failure'); END`);
const before=databaseFingerprint(db);
assert.throws(()=>service.createOperatorManualCampaign(request(profile)),/fixture source failure/);
assert.deepEqual(databaseFingerprint(db),before);
```

- [ ] **Step 7: Run new service tests and verify RED, then GREEN**

First run after adding each test and confirm the expected missing guard fails. Implement the minimal guard, then run:

```bash
node --test test/integration/operator-campaign-create.test.mjs
```

Expected final result: all PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/modules/catalog-scale/catalog-campaign-service.mjs src/db/repositories/catalog-campaign-repository.mjs test/integration/operator-campaign-create.test.mjs
git commit -m "feat: create operator campaigns atomically"
```

---

### Task 3: Explicit Operator Catalog HTTP API

**Files:**
- Modify: `src/server/index.mjs`
- Modify: `src/server/router.mjs`
- Modify: `src/server/controllers/catalog-controller.mjs`
- Create: `test/integration/operator-campaign-api.test.mjs`

**Interfaces:**
- Consumes: Profile Registry and Task 2 service methods.
- Produces: `GET /api/catalog/operator/profiles`.
- Produces: `GET /api/catalog/operator-campaign/current`.
- Produces: `POST /api/catalog/operator-campaigns`.

- [ ] **Step 1: Write failing endpoint tests**

Create the operations server with `categoryProfileDirectory` pointing to a temporary directory and an Active Pool fixture. Assert:

```js
let response=await get('/api/catalog/operator/profiles');let body=await response.json();
assert.equal(response.status,200);
assert.equal(body.profiles[0].active_pool_count,2);
assert.equal(body.profiles[0].capture_mode,'MANUAL_BIND_PASSIVE_CAPTURE');

response=await post('/api/catalog/operator-campaigns',{
  category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',
  requested_new_count:10,campaign_name:'operator-api-10',request_id:'operator-api-request-1',target_count:999999
});body=await response.json();const created=body.result;
assert.equal(response.status,201);
assert.equal(body.result.target_count,12);
assert.equal(body.result.campaign_id.startsWith('catalog_campaign_'),true);

response=await get('/api/catalog/operator-campaign/current');body=await response.json();
assert.equal(body.current.campaign_id,created.campaign_id);
assert.equal(body.current.binding_status,'UNBOUND');
```

Also submit an arbitrary `profile_path` field and assert it is ignored: the resolved Profile still comes only from the exact Registry key/version and no filesystem path from HTTP is opened.

- [ ] **Step 2: Run endpoint tests and verify RED**

```bash
node --test test/integration/operator-campaign-api.test.mjs
```

Expected: 404 for the missing routes.

- [ ] **Step 3: Inject Registry and implement controller methods**

In `createOperationsServer()`:

```js
const categoryProfileDirectory=path.resolve(options.categoryProfileDirectory??path.join(projectDir,'config/categories'));
const categoryProfileRegistry=options.categoryProfileRegistry??createCategoryProfileRegistry({directory:categoryProfileDirectory});
const catalogController=createCatalogController({catalogService,categoryProfileRegistry});
```

Controller methods:

```js
async operatorProfiles(){
  const {profiles,invalid}=await categoryProfileRegistry.list();
  return {profiles:profiles.map(profile=>catalogService.describeOperatorProfile(profile)),invalid};
}
async createOperatorCampaign(body){
  const profile=await categoryProfileRegistry.resolve({categoryKey:body?.category_key,categoryProfileVersion:body?.category_profile_version});
  return catalogService.createOperatorManualCampaign({profile,requestedNewCount:body?.requested_new_count,
    campaignName:body?.campaign_name,requestId:body?.request_id});
}
operatorCurrent(){return catalogService.currentOperatorManualContext();}
```

- [ ] **Step 4: Add routes and stable HTTP statuses**

Add the three explicit routes before generic catalog routes. Return `201` for new creation and `200` for idempotent replay. Extend `statusFor()` so conflicts (`CAMPAIGN_NAME_CONFLICT`, `OPERATOR_CREATE_IDEMPOTENCY_CONFLICT`, ambiguity) return `409`; validation and missing Active Pool remain `400`.

- [ ] **Step 5: Add API hard-fail assertions**

Test exact response codes and unchanged database fingerprints for:

```text
CATALOG_RPA_CLAIM_CONFLICT
INITIAL_ACTIVE_POOL_REQUIRED
CATEGORY_PROFILE_NOT_FOUND
CATEGORY_PROFILE_VERSION_MISMATCH
CATALOG_TARGET_INVALID
CAMPAIGN_NAME_CONFLICT
OPERATOR_CREATE_IDEMPOTENCY_CONFLICT
```

Confirm the API never calls `/resume`, `/cancel`, `/capture`, or job-start handlers.

- [ ] **Step 6: Run API and routing regressions**

```bash
node --test test/integration/operator-campaign-api.test.mjs test/integration/catalog-api.test.mjs test/integration/catalog-rpa.test.mjs test/integration/catalog-manual-binding.test.mjs
npm run check
```

Expected: all listed tests and checks PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/server/index.mjs src/server/router.mjs src/server/controllers/catalog-controller.mjs test/integration/operator-campaign-api.test.mjs
git commit -m "feat: expose operator campaign API"
```

---

### Task 4: Pure Operator Campaign UI Model

**Files:**
- Create: `ui/operator-campaign.js`
- Create: `test/unit/operator-campaign-ui.test.mjs`

**Interfaces:**
- Produces: `calculateTarget(profile,requestedNewCount)`.
- Produces: `buildCreatePayload({profile,requestedNewCount,campaignName,requestId})` with no target/Profile body.
- Produces: `operatorErrorMessage(error)`.
- Produces: `createRequestIdentity({randomUUID})`.

- [ ] **Step 1: Write failing pure UI tests**

```js
test('UI computes display target but omits target and Profile body from create payload',()=>{
  const profile={category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',active_pool_count:2135};
  assert.equal(calculateTarget(profile,10),2145);
  assert.deepEqual(buildCreatePayload({profile,requestedNewCount:10,campaignName:'Manual 10',requestId:'request-1'}),{
    category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',
    requested_new_count:10,campaign_name:'Manual 10',request_id:'request-1'
  });
});

test('claim conflict message tells operator to stop without repair actions',()=>{
  const message=operatorErrorMessage({code:'CATALOG_RPA_CLAIM_CONFLICT',message:'conflict'});
  assert.match(message,/停止/);assert.doesNotMatch(message,/自动取消|自动恢复|删除/);
});
```

- [ ] **Step 2: Run UI-model tests and verify RED**

```bash
node --test test/unit/operator-campaign-ui.test.mjs
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement minimal pure functions**

Use strict positive-integer parsing for requested count. Return `null` for a display target when no available Profile or invalid input exists. Map every error code listed in the spec to a Chinese operator message. `buildCreatePayload()` must construct an allowlist object and never spread form or server Profile objects.

- [ ] **Step 4: Run UI-model tests**

```bash
node --test test/unit/operator-campaign-ui.test.mjs
node --check ui/operator-campaign.js
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add ui/operator-campaign.js test/unit/operator-campaign-ui.test.mjs
git commit -m "feat: model operator campaign form"
```

---

### Task 5: Localhost Creation Form and Current Task Card

**Files:**
- Modify: `ui/index.html`
- Modify: `ui/app.js`
- Modify: `ui/styles.css`
- Create: `test/unit/operator-campaign-console.test.mjs`

**Interfaces:**
- Consumes: Task 3 endpoints and Task 4 pure UI module.
- Produces: visible creation form and current-task card at `http://127.0.0.1:37821/`.
- Does not invoke extension capture methods or legacy job-start/resume controls.

- [ ] **Step 1: Write failing console-source contract tests**

Read the real HTML/JS sources and assert required controls and forbidden actions:

```js
test('localhost console exposes operator Campaign creation without Campaign ID input',()=>{
  assert.match(html,/id="operatorCategory"/);
  assert.match(html,/id="operatorProfile"/);
  assert.match(html,/id="operatorRequestedNew"/);
  assert.match(html,/id="operatorCalculatedTarget"/);
  assert.match(html,/id="createOperatorCampaign"/);
  assert.doesNotMatch(html,/input[^>]+campaign[_-]?id/i);
});

test('operator create handler calls only the explicit create API',()=>{
  assert.match(appSource,/\/api\/catalog\/operator-campaigns/);
  const moduleSection=appSource.slice(appSource.indexOf('async function createOperatorCampaign'));
  assert.doesNotMatch(moduleSection,/\/resume|\/cancel|\/capture|scroll|See more|\/api\/jobs\/start/);
});
```

- [ ] **Step 2: Run console tests and verify RED**

```bash
node --test test/unit/operator-campaign-console.test.mjs
```

Expected: FAIL because controls are absent.

- [ ] **Step 3: Add semantic HTML and dynamic header**

Add above legacy controls:

```html
<section class="panel operator-campaign-panel" aria-labelledby="operatorCampaignTitle">
  <div class="section-title"><div><p class="eyebrow">MANUAL BIND</p><h2 id="operatorCampaignTitle">新建采集任务</h2></div></div>
  <form id="operatorCampaignForm">
    <label>Category<select id="operatorCategory" required></select></label>
    <label>Category Profile<select id="operatorProfile" required></select></label>
    <label>采集模式<input id="operatorMode" value="MANUAL_BIND_PASSIVE_CAPTURE" readonly></label>
    <label>当前 Active Pool 数量<output id="operatorActivePool">0</output></label>
    <label>本次新增目标数量<input id="operatorRequestedNew" type="number" min="1" step="1" required></label>
    <label>Campaign Target<output id="operatorCalculatedTarget">—</output></label>
    <label>任务名称<input id="operatorCampaignName" maxlength="200" required></label>
    <button id="createOperatorCampaign" class="primary" type="submit">创建采集任务</button>
  </form>
  <p id="operatorCampaignError" role="alert"></p>
  <section id="operatorCurrentCampaign" hidden>
    <h3>当前采集任务</h3>
    <dl>
      <div><dt>Category</dt><dd id="operatorCurrentCategory">—</dd></div>
      <div><dt>Campaign Name</dt><dd id="operatorCurrentName">—</dd></div>
      <div><dt>Campaign ID</dt><dd id="operatorCurrentId">—</dd></div>
      <div><dt>Baseline</dt><dd id="operatorCurrentBaseline">0</dd></div>
      <div><dt>Target</dt><dd id="operatorCurrentTarget">0</dd></div>
      <div><dt>Current Unique</dt><dd id="operatorCurrentUnique">0</dd></div>
      <div><dt>Remaining</dt><dd id="operatorCurrentRemaining">0</dd></div>
      <div><dt>Status</dt><dd id="operatorCurrentStatus">—</dd></div>
      <div><dt>Bind</dt><dd id="operatorCurrentBinding">等待页面绑定</dd></div>
    </dl>
  </section>
</section>
```

Give the existing header eyebrow an ID and render it from selected/current Profile. With no selection render `Germany / English / EUR · Multi-Category`.

- [ ] **Step 4: Wire Profile loading, target calculation, submit, and current context**

Import Task 4 functions. On initial load fetch Profile list and current context. On form changes clear the pending request ID and recalculate the display target. On submit:

```js
async function createOperatorCampaign(event){
  event.preventDefault();
  operatorCreateButton.disabled=true;
  operatorRequestId??=createRequestIdentity({randomUUID:()=>crypto.randomUUID()});
  try{
    const body=buildCreatePayload({profile:selectedProfile,requestedNewCount:Number(operatorRequestedNew.value),
      campaignName:operatorCampaignName.value,requestId:operatorRequestId});
    const result=await api('/api/catalog/operator-campaigns',{method:'POST',body});
    renderOperatorCurrent(result.result);operatorRequestId=null;
  }catch(error){renderOperatorError(error);}
  finally{operatorCreateButton.disabled=false;}
}
```

Modify `api()` to preserve `payload.error.code` on thrown errors. Periodic refresh may update current progress, but it must not resubmit creation.

- [ ] **Step 5: Render successful current task state**

Display exact values returned by the server:

```text
Category
Campaign Name
Campaign ID (diagnostic text only)
Baseline
Target
Current Unique
Remaining
Status
等待页面绑定 / binding status
```

Do not add Campaign ID inputs or a resume selector.

- [ ] **Step 6: Add focused responsive styling**

Use existing CSS variables and panel conventions. Add a responsive grid for form fields, `.operator-current-grid`, unavailable/error styles, and clear disabled-button state. Do not redesign unrelated legacy controls.

- [ ] **Step 7: Run UI tests and static checks**

```bash
node --test test/unit/operator-campaign-ui.test.mjs test/unit/operator-campaign-console.test.mjs
node --check ui/operator-campaign.js
node --check ui/app.js
```

Expected: all PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add ui/index.html ui/app.js ui/styles.css test/unit/operator-campaign-console.test.mjs
git commit -m "feat: add operator campaign creation panel"
```

---

### Task 6: CLI Compatibility and Cross-Surface Safety Regression

**Files:**
- Modify: `tools/catalog-manual-passive-admin.mjs`
- Modify: `test/unit/catalog-manual-passive-runner.test.mjs`
- Modify: `test/integration/operator-campaign-create.test.mjs`

**Interfaces:**
- Preserves: `npm run catalog:manual-passive -- create ...` for diagnostics.
- Reuses: `createOperatorManualCampaign()` where CLI semantics match the operator create flow.

- [ ] **Step 1: Add failing CLI compatibility assertions**

Assert the CLI remains present, uses the canonical mode, requires explicit `--resume-campaign` for resume, and contains no latest-Campaign selection. Add a test proving a normal create delegates to the atomic service and returns `campaignId`, while an explicit diagnostic resume still goes through `validateResumeCampaign()`.

- [ ] **Step 2: Run and verify RED**

```bash
node --test test/unit/catalog-manual-passive-runner.test.mjs test/integration/operator-campaign-create.test.mjs
```

Expected: the delegation assertion fails before the CLI change.

- [ ] **Step 3: Replace duplicate CLI orchestration with service call**

Keep CLI option parsing and output, but call:

```js
service.createOperatorManualCampaign({profile,requestedNewCount:target-baseline.activePoolVersionCount,
  campaignName:options.name??generatedName,requestId:options['request-id']??createId('operator_cli_request')})
```

Do not change explicit `--resume-campaign` validation. Do not add a fallback from create to resume.

- [ ] **Step 4: Run CLI/Manual Bind regressions**

```bash
node --test test/unit/catalog-manual-passive-runner.test.mjs test/unit/catalog-manual-binding.test.mjs test/integration/catalog-manual-binding.test.mjs test/integration/operator-campaign-create.test.mjs
npm run check:network-capture
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add tools/catalog-manual-passive-admin.mjs test/unit/catalog-manual-passive-runner.test.mjs test/integration/operator-campaign-create.test.mjs
git commit -m "refactor: share operator campaign creation path"
```

---

### Task 7: Final Verification and Operator Runbook

**Files:**
- Create: `docs/OPERATOR_CAMPAIGN_CREATE_UI_V1.md`
- Create: `docs/superpowers/verification/2026-08-31-operator-campaign-create-ui-v1.md`

**Interfaces:**
- Documents localhost-only Campaign creation followed by Temu-page extension detection/binding/manual capture.
- Records exact test evidence and baseline-failure comparison.

- [ ] **Step 1: Write the focused operator runbook**

Document this exact normal flow:

```text
start localhost server
open http://127.0.0.1:37821/
select validated Category/Profile
enter requested-new count and task name
click 创建采集任务
verify current task shows UNBOUND
open healthy Temu page manually
click 检测当前页面
click 绑定当前页面
click 采集当前页面
```

Explicitly state that the localhost create button does not navigate, bind, capture, resume, cancel, or repair queues.

- [ ] **Step 2: Run NEW_FEATURE_TESTS**

```bash
node --test test/unit/category-profile-registry.test.mjs test/unit/operator-campaign-ui.test.mjs test/unit/operator-campaign-console.test.mjs test/unit/catalog-manual-binding.test.mjs test/unit/catalog-manual-passive-runner.test.mjs test/integration/operator-campaign-create.test.mjs test/integration/operator-campaign-api.test.mjs test/integration/catalog-manual-binding.test.mjs
```

Expected: 100% PASS.

- [ ] **Step 3: Run RELATED_REGRESSION_TESTS**

```bash
node --test test/integration/catalog-api.test.mjs test/integration/catalog-campaign.test.mjs test/integration/catalog-rpa.test.mjs test/integration/catalog-expansion.test.mjs test/integration/catalog-refresh.test.mjs test/integration/catalog-resume.test.mjs test/integration/multi-category-isolation.test.mjs test/unit/category-profile.test.mjs test/unit/category-scope.test.mjs test/unit/campaign-selection.test.mjs test/unit/browser-extension.test.mjs
```

Expected: 100% PASS.

- [ ] **Step 4: Run static checks**

```bash
npm run check
npm run check:opportunity
git diff --check
rg -n "UPDATE\s+catalog_memberships\s+SET\s+active\s*=\s*0\s+WHERE\s+active\s*=\s*1|findLatest.*Campaign|latest campaign" src tools ui browser-extension
```

Expected: checks exit 0; forbidden global mutation/resume scan has no production-code match.

- [ ] **Step 5: Run FULL_SUITE and compare failure identities**

```bash
npm test
```

Expected:

```text
KNOWN_BASELINE_FAILURES = exactly 7
NEW_FAILURES = 0
```

Compare by file, exact test name, and assertion/error reason, not only count. The approved failures are the two `server-jobs.test.mjs` Excel cleanup/reset `400 !== 200` assertions and the five approved Catalog/image-cache assertion mismatches recorded in the Multi-Category Safety verification report.

- [ ] **Step 6: Record acceptance gates**

Write fresh outputs to the verification document and set each gate only from evidence:

```text
OPERATOR_CAN_CREATE_WITHOUT_CLI = YES / NO
OPERATOR_NEVER_ENTERS_CAMPAIGN_ID = YES / NO
TARGET_IS_SERVER_CALCULATED = YES / NO
CREATE_AND_CLAIM_IS_ATOMIC = YES / NO
CONFLICT_ZERO_WRITES = YES / NO
NO_IMPLICIT_RESUME = YES / NO
MANUAL_BIND_GATE_PRESERVED = YES / NO
NEW_FEATURE_TESTS = PASS / FAIL
RELATED_REGRESSION_TESTS = PASS / FAIL
NEW_FAILURES = 0 / <count>
```

- [ ] **Step 7: Commit verification artifacts**

```bash
git add docs/OPERATOR_CAMPAIGN_CREATE_UI_V1.md docs/superpowers/verification/2026-08-31-operator-campaign-create-ui-v1.md
git commit -m "docs: verify operator campaign create UI"
```

- [ ] **Step 8: Confirm final repository state**

```bash
git status --short --branch
git log --oneline 9140d61..HEAD
```

Expected: clean `codex/multi-category-safety-v1`; no push performed.
