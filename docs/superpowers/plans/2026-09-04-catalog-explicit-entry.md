# Catalog Explicit Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution, as authorized by the operator. No additional approval pause.

**Goal:** Explicit operator click selects START_INITIAL, CONTINUE_INITIAL, or existing Expansion without implicit mutations.

**Architecture:** Add a scoped entry/continuation service composed with the existing Catalog service. Preserve its atomic Initial creation and quantity policy. Catalog module consumes server action descriptors; all page reads remain non-mutating.

**Tech Stack:** Node ESM, node:sqlite, node:test, existing vanilla Catalog UI.

**Spec:** docs/superpowers/specs/2026-09-04-catalog-explicit-entry-design.md

## Global constraints

- No production Campaign actions, production migrations, production writes, Dashboard restart, Temu capture or push.
- Preserve all migration checksums and unrelated dirty files.
- Tests write only temporary/fixture/copied SQLite.
- Final full-suite failures must match the approved seven file/name/reason identities; NEW_FAILURES=0.
- Category/profile identity precedes every action; BEGIN IMMEDIATE covers all continuation rechecks and writes.

## Task 1 — Read-only entry resolver

Files: new src/modules/catalog-scale/operator-entry-service.mjs and test/integration/catalog-explicit-entry.test.mjs; modify Catalog service composition and profile descriptor.

Interface: createOperatorEntryService({db,repository,initialRepository,now}) exposes resolve(profile), returning {action,available,code,campaign_id,category_key,category_profile_version}. resolve performs no writes.

- [ ] RED: fixture tests assert START_INITIAL before create, CONTINUE_INITIAL after create, BLOCKED for invalid profile, multiple unfinished Initials, pool history without active, Active Pool plus unfinished Initial, profile mismatch and orphan membership. Compare ordered row fingerprints, not only counts.
- [ ] Run `node --test test/integration/catalog-explicit-entry.test.mjs`; fail because resolver is absent.
- [ ] Implement precedence exactly as spec. Use category-scoped SQL, repository.getCampaign and getBaselineConsistency; never LIMIT 1 to resolve ambiguity.
- [ ] GREEN and related `node --test test/integration/initial-campaign-create.test.mjs`.
- [ ] `git diff --check`; commit `feat: resolve explicit category capture entry`.

## Task 2 — Atomic explicit continuation

Files: operator-entry-service.mjs; Catalog service composition; same integration test file.

Interface: continueInitial({profile,campaignId,requestId}) returns existing Initial operator summary. Store request audit under exact Campaign config operatorContinue requests (bounded to current implementation, no schema migration); request_id scope must be checked across Campaigns. Never use latest selection.

- [ ] RED: running same-claim retains run/token/generation; paused no claim atomically acquires exact claim; foreign claim and terminal/mismatched/multiple states leave ordered rows unchanged; injected transaction failure rolls back; same request replay performs zero writes.
- [ ] Implement within transaction(db,...): resolve again; verify exact id, mode, policy, queue/source identity and allowed states; reject foreign active/nonterminal claimed rows; validate unfinished run cardinality; reuse/acquire exact claim; preserve/create sole unfinished run; reset binding and automatic flags; set full running/capturing/capturing tuple; persist request result.
- [ ] GREEN: `node --test test/integration/catalog-explicit-entry.test.mjs test/integration/initial-manual-capture.test.mjs test/integration/initial-pool-activation.test.mjs`.
- [ ] `git diff --check`; commit `feat: continue exact Initial atomically`.

## Task 3 — Scoped API and concurrent creation

Files: catalog-controller.mjs, router.mjs, test/integration/catalog-explicit-entry-api.test.mjs, new worker fixture under test/fixtures.

Interfaces: GET /api/catalog/operator/entry?category_key=...&category_profile_version=...; POST /api/catalog/operator/initial-campaigns/:campaign_id/continue with matching body ids and request_id. Existing Initial create endpoint unchanged.

- [ ] RED: GET all modes zero writes; wrong path/body identity rejected; continue exact tuple exposed; missing request_id rejected. Use temporary HTTP server and real fixture services.
- [ ] RED race: two Worker threads independently open the same temporary SQLite and await a shared barrier before calling existing createOperatorInitialCampaign with different names/request_ids; assert one complete winner and one hard failure, exactly one source/queue/run/Initial.
- [ ] Wire controller with registry.resolve and assertCampaignBodyIdentity; map result through existing operator response mapping. Verify failure paths do not return current global context.
- [ ] GREEN plus `node --test test/integration/operator-campaign-api.test.mjs test/integration/initial-pool-api.test.mjs`.
- [ ] `git diff --check`; commit `feat: expose strict operator continuation API`.

## Task 4 — Explicit Catalog UI action

Files: ui/modules/catalog/api.js, model.js, panel.js; new test/unit/catalog-explicit-entry-ui.test.mjs.

Interface: profile.entry descriptor drives button; continueInitial(body) submits explicit id; no automatic requests on selection except GET/listProfiles.

- [ ] RED: mount/refresh/category change triggers no mutation; START/CONTINUE/EXPANSION buttons route correct payload; double-click coalesces; retain request_id on uncertain failure; selecting another scope cannot reuse pending request or apply late result; blocked action is disabled.
- [ ] Implement isolated Catalog handlers. Keep ordinary Expansion inputs. Treat continuable profiles as selectable even though creation eligibility is false. Synchronously guard loading; freeze selected identity at click and disregard stale responses.
- [ ] GREEN plus existing Catalog namespace/isolation, Initial UI and operator campaign UI tests.
- [ ] `git diff --check`; commit `feat: show explicit start or continue capture action`.

## Task 5 — Full verification

- [ ] Run all new tests and directly related Initial/claim/Manual Bind/activation/Catalog UI regressions.
- [ ] Run full suite using same isolated environment as pre-change baseline: `node --test --test-reporter=tap`.
- [ ] Compare exact failing file/name/error class/actual/expected against approved seven and pre-change baseline; investigate environmental failures, never classify them as approved.
- [ ] Record results, commit list, clean/dirty status and deployment-not-performed in docs/superpowers/verification/2026-09-04-catalog-explicit-entry.md.
- [ ] `git diff --check`; commit verification only. No merge into runtime, restart, push or production writes.

## Coverage self-review

Precedence/read-only: Task 1. Full state tuple/claim/idempotency/rollback: Task 2. Exact HTTP identity and two-connection race: Task 3. Explicit operator trigger and frontend duplicate/stale-response safety: Task 4. Exact-seven regressions and production boundary: Task 5.
