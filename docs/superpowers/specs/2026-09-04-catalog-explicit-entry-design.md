# Catalog Explicit Operator Entry V1

## Status and scope

Business contract approved by the operator on 2026-09-04. Status: **PARTIAL_IMPLEMENTATION_EXISTS / ACCEPTANCE_PENDING**.

Retained implementation commits: `9e0ceb7` (read-only entry resolver), `c18efce` (exact Initial continuation), and `4d8f01a` (API and independent-connection race coverage). They require conformance review and gap-based acceptance, not replacement.

This is a **thin entry layer** over the Initial Category Pool / Multi-Category infrastructure already in stable. Do not migrate or reimplement the old Multi-Category branch. Initial Candidate Snapshot + Image Cache V1 remains completely frozen, including candidate_snapshot_id, snapshot schema/repository, CREATING→SEALED, SEALED-only reads, RECONSTRUCTED_COMPAT, LIVE_FREEZE, snapshot image caching/Preview and future QA/Activation handoffs.

Protected implementation: initial-pool-repository, catalog-repository, campaign-quantity-policy, initial-candidate-hash, initial-pool-qa, initial-activation-coordinator, existing extension Manual Bind/Capture, migration 026 and all historical migrations. Entry changes must remain in the Entry service, thin service/controller/router wiring, Catalog UI and dedicated tests. No production mutations, migrations, restart, capture, merge, cherry-pick or push are authorized by this implementation stage.

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

### Frozen precedence (first matching rule wins)

1. Invalid category/profile/membership identity or scope: BLOCKED.
2. More than one unfinished Initial within category identity: BLOCKED.
3. Pool history with missing, multiple, mismatched or baseline-inconsistent Active Pool: BLOCKED.
4. Active Pool together with any unfinished Initial: BLOCKED, even if the Active Pool itself is valid.
5. Valid Active Pool and no unfinished Initial: EXPANSION.
6. No history and exactly one valid unfinished Initial: CONTINUE_INITIAL.
7. No history and zero unfinished Initials: START_INITIAL, subject to orphan-membership/completed-without-pool gates above.

### Frozen continuation tuple and claim semantics

Audited `CAMPAIGN_TRANSITIONS`, migration 017 source/queue CHECKs, `claimRpaQueue`, and `createSourceRun`: campaign supports paused/manual_required → running; source/queue use capturing (not running); source runs have finished_at rather than a status column. Repository transitions are not general-purpose validators, so this endpoint must validate input tuples explicitly.

Successful continuation always returns: Campaign=running; Queue=capturing; Source=capturing; exactly one unfinished source_run; checkpoint runner_state=UNBOUND; capture_paused=true; no live page binding; all automatic action flags=false; exact Queue has a nonempty operator claim token/generation. These names already exist. It never returns paused Campaign with capturing children.

Allowed parent states are running, paused, manual_required. Queue/source must belong to the exact Campaign and each be pending, opening, waiting_page_ready, capturing, waiting_load_more or manual_required; terminal children and ambiguous/missing children fail. running continuation requires an existing valid same-Campaign claim and exactly one unfinished run. paused/manual_required may reacquire a missing claim; existing valid same-Campaign claim is reused. A same-Campaign claim is valid only with exact child identity, nonempty token, positive generation, an active queue state and an internally consistent source run; this is not stale-claim takeover.

For paused/manual_required without claim: under BEGIN IMMEDIATE, recheck foreign active queue/claim, atomically assign a fresh token to the exact Queue, increment generation/attempt, reuse its sole unfinished run or create one if there are zero unfinished runs (run_number=max+1); more than one unfinished run fails. Retain every finished run. Reset page binding and transition all statuses in the same transaction. Exception rolls back all state, claim, run and request changes.

Any foreign active queue or foreign nonterminal claimed queue: HARD FAIL / ZERO writes, including paused foreign parents. No global/latest claim selection or takeover. Running same-claim continuation creates no new run or generation. Every successful continuation requires fresh manual binding; no browser action is issued. A request replay validates terminal/current ownership before returning, and cannot reset a subsequently established binding as a retry side effect.

Two independent SQLite connections race START_INITIAL under BEGIN IMMEDIATE: exactly one complete winner; the loser observes existing Initial/claim and fails with zero partial rows. A busy-timeout error is also a hard failure, never a reason to run without the transaction.

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
11. Active Pool plus unfinished Initial blocks before EXPANSION selection.
12. paused Initial without claim transitions the full exact tuple atomically; with foreign claim the complete database fingerprint is unchanged.
13. running exact Initial with valid same claim retains source_run id and claim generation.
14. Two worker-thread independent DB connections synchronize before START_INITIAL; assert one winner and one hard failure plus one complete Campaign/source/queue/run.

## Delivery boundary

The design amendment is committed separately, followed first by a read-only conformance audit of the three retained commits. Only bounded Entry-layer gaps may proceed through an updated plan and TDD. Already-passing work must not be redone. If compliance requires changing protected infrastructure or frozen contracts, stop. No production Campaign action, migration application, restart, or push is authorized. Preserve existing dirty files and migration checksums.
