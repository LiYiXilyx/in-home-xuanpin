# Catalog Explicit Operator Entry V1

## Status and scope

Business contract approved by the operator on 2026-09-04. This document specifies the implementation boundary; implementation has not started.

Existing Germany / English / EUR Manual Bind Passive Capture only. Preserve Initial OPEN_ENDED, existing targeted Expansion, candidate ledger, QA, activation, and all sealed evidence. No taxonomy, YingDao, image-cache, or browser automation changes.

## Evidence from current code

- `initial-pool-repository.mjs:getInitialEligibility` already reads pool history by exact category_key and enumerates nonterminal Initial Campaigns. Its current eligibility is creation-only.
- `catalog-campaign-service.mjs:describeOperatorProfile` uses this creation eligibility for initial_pool_available; therefore an existing Initial cannot currently be presented as a continuable entry through that flag.
- `createOperatorInitialCampaign` already creates Campaign/source/queue/source run/UNBOUND checkpoint transactionally and enforces create request idempotency.
- `resumeRpa` currently moves the queue/source to opening. Do not route the new operator continuation through this legacy path.
- `ui/modules/catalog/panel.js:createCampaign` currently chooses only Initial creation versus Expansion creation.

## Explicit trigger invariant

Opening the operator page, refreshing, selecting category/profile, polling, and detecting a CategoryPageDescriptor are read-only: ZERO Campaign creation, ZERO resume, ZERO claim mutation.

Only an explicit operator button click may issue a mutation request. Returning to a category never implicitly resumes a task.

## Read-only entry resolution

Resolve using exact category_key and category_profile_version. Return a single action descriptor with identity, action, exact campaign_id when applicable, availability and blocker codes. Do not overload creation eligibility as continuation eligibility.

| State | Action |
| --- | --- |
| No pool history, no unfinished Initial, otherwise valid scope | START_INITIAL / 开始首次采集 |
| No pool history, exactly one unfinished Initial with matching profile and manual mode | CONTINUE_INITIAL / 继续首次采集 |
| One valid scoped Active Pool and consistent baseline | EXPANSION / existing requested_new_count flow |
| Pool history but no Active Pool | BLOCKED / CATEGORY_POOL_STATE_INCONSISTENT |
| Multiple unfinished Initials | BLOCKED / INITIAL_CAMPAIGN_CONTEXT_AMBIGUOUS |
| Initial profile/mode/queue/source identity mismatch | BLOCKED / explicit identity error |

Use all unfinished Initials for the category when detecting ambiguity; do not hide conflicting candidates by filtering out other profile versions first. Never use display names, global latest Campaign, or global active memberships.

Cancelled and failed Campaigns are terminal and cannot be continued. A fresh Initial after terminal history is only possible through an explicit START_INITIAL action and the existing creation safety gates; no resurrection of terminal records. Completed Initial with no formal pool is inconsistent and must block, not create another Initial.

Active Pool still requires existing baseline consistency checks; this feature does not repair the Motorcycle 2135/1149 blocker or any later state.

## Mutation contracts

### Start

Reuse the existing Initial creation transaction. Require category_key, category_profile_version, request_id and the existing name contract. Baseline remains zero; business target and capture_limit remain null; quantity_mode remains OPEN_ENDED. Keep storage sentinel internal.

Re-resolve entry eligibility inside the transaction before any creation write. A concurrent first creation with another request_id must fail, not create a second Initial and not silently resume the winner. An identical creation retry returns the same Campaign; different payload under the same request_id fails.

### Continue

Add an operator-specific explicit continuation endpoint under /api/catalog/operator/initial-campaigns/:campaign_id/continue.

Require campaign_id in the path and body, category_key, category_profile_version and request_id. Resolve the exact profile and exact Campaign; revalidate unique unfinished candidate, zero pool history, OPEN_ENDED quantity policy, manual mode, one compatible source/queue, and claim ownership in one transaction.

Running + valid capturing queue is an explicit selection of the same task, not a new source run or claim. It must not start capture. Paused/manual_required recovery may only use a specifically tested manual transition, retaining Campaign/source/queue identity, setting capture_paused=true and UNBOUND, and clearing stale page binding. Do not invoke legacy resumeRpa/opening automation. Unsupported or inconsistent states fail closed.

No takeover of another Campaign claim. Claim conflict returns the existing complete blocker information and ZERO writes; no cancellation, queue deletion, or latest fallback.

Persist continuation idempotency/audit with exact request payload and result in a suitable existing request/audit mechanism, or an isolated additive migration if no suitable mechanism exists. Same request replay cannot resume a subsequently cancelled/completed task or mutate it back to running. Current state must still be validated; do not return stale historical success as current writability.

Preserve candidate data, QA revisions, products, memberships, pools, source history and existing run identity. Never create a duplicate active source run. Campaign terminalization or activation wins over a stale continuation request.

## UI and request lifecycle

Catalog owns entry descriptor, pending request and loading/error state. Render the action button from the server descriptor. Initial hides requested_new_count/target/remaining; Expansion retains those existing inputs and calculation.

The button handler checks loading synchronously before issuing requests. Retain request_id after timeout/network uncertainty. Scope pending request identity to category/profile/action/campaign/payload so switching categories cannot reuse another action's request. Refresh re-reads server state and exposes CONTINUE_INITIAL after a successful initial creation; it never automatically resubmits a mutation.

Late responses for an old category/profile must not replace the current selection or enable a wrong-category button. Continuation submits the displayed exact campaign_id; the server never chooses one on behalf of a mutation request.

Do not automatically detect, bind, navigate, scroll, click See more, or capture. The extension continues consuming explicit server context only. Keep all non-Catalog shell and YingDao state untouched.

## TDD acceptance matrix

All write tests use temporary/fixture/copied SQLite, never production.

1. All read-only entry permutations perform zero writes, including page refresh/category switching and descriptor detection.
2. Initial create requires explicit click; double click and identical request retry create exactly one Campaign/source/queue/run.
3. Two competing creation request_ids yield one winner and one hard failure.
4. Return to a category resolves the unique exact Initial; continuation retains its id and candidate count.
5. Wrong category/profile/campaign, multiple candidates, terminal Campaign, unsupported state, foreign claim: hard fail with zero writes.
6. Continue retry does not create another source run or reactivate a terminal task.
7. Continue sets no auto-browser actions; resumed manual tasks require fresh binding.
8. Pool history without Active Pool blocks; valid Active Pool preserves targeted Expansion and baseline checks.
9. Stale UI responses and request identities cannot cross categories.
10. Existing Initial capture/QA STALE/activation mutex and Catalog–YingDao isolation regressions pass.

## Delivery boundary

Design review precedes Implementation Plan and TDD. No production Campaign action, migration application, restart, or push is part of this design stage. Preserve existing dirty files and migration checksums; commit only this specification.
