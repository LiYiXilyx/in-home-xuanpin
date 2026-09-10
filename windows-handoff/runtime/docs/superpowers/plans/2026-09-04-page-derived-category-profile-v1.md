# Page-Derived Category Profile V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, task-by-task. No routine approval pauses (operator authorization).

**Goal:** Recognize a loaded category page passively, explicitly register/select its Profile, then reuse Entry V1.

**Architecture:** Shared browser-safe descriptor contract; server resolver and ephemeral probe service; existing Profile store atomic boundary. Catalog UI and extension remain separate from evidence and Campaign writes.

**Tech Stack:** Node >=22, native test runner, existing browser extension, filesystem Profile registry, fixture SQLite.

**Spec:** `docs/superpowers/specs/2026-09-04-page-derived-category-profile-v1-design.md`

## Global constraints

- Base e7f04e6; isolated worktree only. No migration or frozen Snapshot implementation.
- No production Profile/Campaign writes, selection, detection or capture during development.
- Recognition has no persistence. Registration writes only Profile. Entry remains a separate action.
- No Temu fetch/XHR, image download, automatic navigation, scroll, See more or CAPTCHA work.
- Every task: RED → minimal implementation → GREEN → related regression → diff check → own commit.
- Final full-suite failures must be EXACT_SAME_7; environment/new failures zero. Never call 7 failures “all green”.

## Task 1 — Shared canonical descriptor contract

Files: create `browser-extension/category-page-descriptor.js`, `test/unit/category-page-descriptor.test.mjs`, `test/fixtures/category-pages/`.
Interface: browser global `TemuCategoryPageDescriptor` with `canonicalizeTemuCategoryListingUrl(url)`, `validateDescriptor(input)`, `parseCategoryPage(doc,url,now)`; server imports the same pure contract, no duplicate canonicalizer.

- [ ] RED: vm-load contract and assert canonical tracking variants equal; ten fixtures cover five unrelated listings, search/detail/home/security/empty. Assert missing DOM market proof blocks; credential URLs and unknown identity params reject.
  ```js
  assert.equal(api.canonicalizeTemuCategoryListingUrl(base+'?refer_page=1'),base);
  assert.throws(()=>api.validateDescriptor({...valid,currency:'USD'}),{code:'CATEGORY_MARKET_MISMATCH'});
  ```
- [ ] Run `node --test test/unit/category-page-descriptor.test.mjs`, observe missing contract/assertion failure.
- [ ] Minimal code: category path grammar + allowlisted tracking stripper, explicit DOM proof/health checks, descriptor allowlist. Strip nonbusiness URL data before transmission. Exclude overlay text from market/health proof.
- [ ] GREEN same command; run existing breadcrumb and capture parser unit tests. `git diff --check`; commit `feat: add passive category descriptor contract`.

## Task 2 — Existing Profile resolution and deterministic draft

Files: create `src/modules/catalog-scale/page-derived-category-profile.mjs`, `test/unit/page-derived-category-profile.test.mjs`; bounded modify `operator-category-profile.mjs` only if internal identity composition requires it.
Interface: `resolvePageDerivedCategory(descriptor,profiles)` returns `{resolution,profile?,draft?,code?}`; normalize the draft through existing Profile contract. Consume Task1 validation.

- [ ] RED: exact manually created Girls' Sets identity retained for tracking variants, tier ambiguity rejected, incompatible scope rejected, different canonical identities sharing names not reused; stable collision key/version.
  ```js
  assert.equal(resolvePageDerivedCategory(d,[girls]).profile.category_profile_version,girls.category_profile_version);
  assert.equal(resolvePageDerivedCategory(d,[girls,{...girls,category_profile_version:'other'}]).code,'CATEGORY_PROFILE_AMBIGUOUS');
  ```
- [ ] Run `node --test test/unit/page-derived-category-profile.test.mjs` RED.
- [ ] Implement precedence and veto conflicting canonical identity before weak matches; derive aliases automatically, stable collision suffix, reuse validator, no taxonomy.
- [ ] GREEN; regress `test/unit/operator-category-profile.test.mjs` and registry tests; diff check; commit `feat: resolve page categories against existing profiles`.

## Task 3 — Atomic Profile registration boundary

Files: modify `src/modules/catalog-scale/operator-category-profile-store.mjs`; extend `test/unit/operator-category-profile-store.test.mjs`; add `test/integration/page-derived-profile-race.test.mjs` and `test/fixtures/profile-register-worker.mjs`.
Interface: existing `register` preserved; internal store-exclusive callback encloses re-resolution + registration and also protects advanced register. No arbitrary profile override exposed to HTTP.

- [ ] RED: two independent workers with temp store race; final JSON count exactly one, no partial files, no lost winner. Same request/different content conflicts.
  ```js
  assert.equal(profileFiles(root).length,1);
  assert.equal(results.filter(r=>r.created).length,1);
  ```
- [ ] Execute race and store tests; observe missing boundary failure.
- [ ] Use atomic mkdir store lock, fsync/temp/rename existing write primitive; never overwrite winner or remove unknown lock. Return explicit in-progress/reuse; include advanced path in shared lock. Validate before creating storage on invalid input.
- [ ] GREEN race/store/registry regressions; diff check; commit `fix: serialize profile identity registration`.

## Task 4 — Ephemeral probes and scoped API

Files: create `src/modules/catalog-scale/page-derived-category-probes.mjs`, `test/integration/category-probe-api.test.mjs`; modify server index composition, controller, router.
Interface: `createCategoryProbeService({registry,store,clock,ttlMs=300000,maxProbes=100})` → `create(descriptor)`, `current()`, `register({probe_id,descriptor_fingerprint,request_id})`. Routes are exactly the three Spec paths.

- [ ] RED: temp-store + temp-DB fingerprint before/after recognition identical; expiry/mismatch unknown probe zero writes; registration +1 Profile, zero Campaign/source/queue/run/claim. Same request replay and conflicting request test.
  ```js
  assert.deepEqual(afterRecognition,before);
  assert.equal((await service.register(exact)).profile.category_key,expectedKey);
  ```
- [ ] Run `node --test test/integration/category-probe-api.test.mjs` RED (local port permission if necessary).
- [ ] Implement bounded memory registry, UUID probe, deterministic hash, immutable captured ownership and TTL; revalidation/re-resolution under Task3 boundary; HTTP errors explicit. No Catalog repository dependency.
- [ ] GREEN; regress existing operator Profile API + Entry API; diff check; commit `feat: expose ephemeral category probe API`.

## Task 5 — Passive extension recognition action

Files: modify manifest/background/content-script and existing `catalog-operator-overlay.js`; create `test/unit/category-probe-extension.test.mjs`.
Interface: explicit button calls Task1 parser then background's fixed localhost probe endpoint. No default detection/polling of Temu DOM; success display uses returned descriptor/resolution.

- [ ] RED: fixture button action reaches localhost exactly once; loading document/overlay does not create probe; navigate/scroll/Temu fetch spies remain zero; unknown page can recognize without an existing Campaign.
  ```js
  assert.equal(probes.length,0); await recognitionClick(); assert.equal(probes.length,1);
  assert.equal(temuRequests.length,0);
  ```
- [ ] Run extension fixture tests RED.
- [ ] Add compact current-category section within existing overlay, escaped summaries, busy/error feedback; inject contract before dependent script, preserve evidence actions.
- [ ] GREEN; regress overlay/manual-bind/evidence tests, diff check; commit `feat: recognize categories from explicit extension action`.

## Task 6 — Catalog quick selection UI

Files: `ui/modules/catalog/api.js`, `state.js`, `model.js`, `panel.js`, Catalog CSS; `test/unit/category-probe-ui.test.mjs`.
Interface: scoped API currentProbe/registerProbe; state `categoryProbe`; render quick panel. Existing Profile selection and Entry resolver remain authoritative.

- [ ] RED: initially 尚未识别; EXISTING selects only, NEW explicit register only; delayed probe from another tab cannot change pending registration ID; expired preview disables; refresh creates no Campaign; advanced form remains.
  ```js
  assert.equal(campaignWrites,0);
  assert.deepEqual(registerBodies,[{probe_id:p.probe_id,descriptor_fingerprint:p.descriptor_fingerprint,request_id:id}]);
  ```
- [ ] Run UI tests RED.
- [ ] Implement exact selection after profile refresh, render escaped descriptor; Catalog-only loading/errors/polling; no automatic Entry action. No YingDao root writes.
- [ ] GREEN UI, Entry UI, isolation regression; diff check; commit `feat: add quick category selection to Catalog`.

## Task 7 — Acceptance and controlled deployment

Files: add verification report under `docs/superpowers/`; no production fixtures or outputs committed.

- [ ] Run all Task1–6 tests and 24 Entry focused, 86 related, `npm run check`, `git diff --check`.
- [ ] Configure full suite using disposable copies from prior fixture environment (never official writable DB), `YINGDAO_REAL_SOURCE_DIR` only as read-only parser input; run full suite and compare exact failure names/details to `/private/tmp/entry-deploy-full.tap`.
- [ ] Review scope against all 33 user acceptance cases and protected-file diff. Commit verified report only after actual results.
- [ ] Normal feature push; fetch and reject unknown stable advancement. Confirm no production in-flight capture/QA/activation/export/writer, record DB and Profile fingerprints. Do not interpret persisted capturing as live activity without evidence.
- [ ] FF-only integrate, rerun same regression configuration, normal stable push. Controlled identified Dashboard restart only; no SIGKILL or task recovery commands. Existing automatic business recovery that would change Catalog rows blocks deployment.
- [ ] Update extension via existing safe procedure; no real Temu tab operation. Read-only operator page acceptance: quick panel 尚未识别, advanced fallback available, refreshed/select-back fingerprints equal. Stop before recognition.

## Coverage self-review

Descriptor and page negatives: Task1/5. Identity/alias/Girls' Sets/collision: Task2.
Profile-only explicit registration/concurrency: Task3/4. Probe TTL/two-tabs/restart:
Task4/6. Entry reuse/advanced fallback/isolation: Task6. Frozen/production and exact
baseline gates: Task7. No schema migration, second registry or duplicated Entry.
