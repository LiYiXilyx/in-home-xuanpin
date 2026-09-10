# Stale Claim Recovery + Manual Bind Browser UX V1 Design

## 1. Scope and safety objective

This change replaces the opaque global `CATALOG_RPA_CLAIM_CONFLICT` with a strict, server-authoritative claim inspection and recovery contract. It also separates the formal `MANUAL_BIND_PASSIVE_CAPTURE` extension flow from the legacy External CDP controls.

The V1 safety invariant is fail closed: an operator may end a claim only when two immutable inspections and a transaction-time recheck all return `STALE_CONFIRMED`. `ACTIVE`, `NOT_ELIGIBLE`, `STALE_NOT_PROVEN`, missing evidence, unknown liveness, or changed evidence produce zero writes.

The change must not delete or rewrite Campaign history, Queue/Source history, staging, batches, snapshots, Products, Memberships, Active Pools, Pool items, or Motorcycle taxonomy. It must not resume the paused `1208/2000` refresh Campaign. Production handling is limited to the two explicitly authorized Motorcycle Campaign IDs, followed—only if both are safely terminalized—by one explicit girls-sets Initial Campaign creation.

## 2. Approved thresholds

The code-level minimums are:

| Setting | Minimum | Meaning |
| --- | ---: | --- |
| `claimHeartbeatStaleAfterMs` | `1800000` | A formal worker/queue heartbeat must be at least 30 minutes old. |
| `consecutiveInspectionMinIntervalMs` | `10000` | The second inspection must start at least 10 seconds after the first completed inspection. |
| `liveBindingLeaseMs` | `30000` | A binding heartbeat no older than 30 seconds is live. |
| `legacyNoHeartbeatStaleAfterMs` | `86400000` | A legacy claim without formal heartbeat evidence needs at least 24 hours of inactivity. |

Configuration may increase, but never lower, these values. HTTP requests and UI controls cannot override them. The effective values are returned in inspection evidence and frozen into the audit record.

## 3. Claim blocker identity and ordering

An active blocker is a nonterminal claimed Catalog RPA Queue in `opening`, `waiting_page_ready`, `capturing`, `waiting_load_more`, or `manual_required`, joined to its exact Campaign, Source, and latest unfinished Source Run. A blocker is never inferred from display names.

The blocker list is deterministic:

1. latest trustworthy activity descending;
2. claimed time descending;
3. Campaign ID, Queue ID, Source ID ascending.

The first item is the `primary_blocker`; `all_blockers` always contains the complete list. Campaign creation still performs zero writes when any blocker exists, but its conflict error includes the server-produced blocker summary rather than a guessed single owner.

## 4. Inspection data model

The inspection service is read-only except for persisting immutable inspection evidence. Each record contains:

- inspection ID, start/completion timestamps and inspection sequence;
- Campaign ID, category key, category profile version, type and status;
- Queue ID/status, Source ID/status and unfinished Source Run identity/status;
- runner state, claim token and claim generation;
- claimed worker/session identity when available;
- worker, queue, Source progress, checkpoint and binding heartbeat timestamps;
- binding status and binding fingerprint;
- `live_worker`, `live_binding`, capture/QA/activation/export/source-runner in-flight flags;
- canonical progress fingerprint;
- effective thresholds, stale status, stale reasons and blocking reasons.

Allowed stale statuses are exactly:

- `ACTIVE`: live worker, binding or in-flight work is present;
- `NOT_ELIGIBLE`: parent Campaign is not `paused`, or identity/status is outside the recovery contract;
- `STALE_NOT_PROVEN`: the claim looks old but at least one mandatory proof is false, unknown, missing, or changed;
- `STALE_CONFIRMED`: all mandatory proofs and a valid prior inspection succeed.

Inspection IDs are opaque server-generated identities. The client cannot submit `stale=true` or construct evidence.

## 5. Live worker, binding and in-flight contract

### 5.1 Activity registry

The single Dashboard process owns a campaign/queue-scoped activity registry. It tracks active request critical sections for capture batch, Initial QA, Initial activation, scoped Excel export and Source runner work. Registration and cleanup use `try/finally`; activity cannot be inferred from unrelated Node processes.

V1 retains `SINGLE_DASHBOARD_PROCESS_REQUIRED = YES`. The Launcher enforces a single service. If multi-process access is introduced later, this process-local registry must be replaced by database leases before recovery remains enabled.

### 5.2 Worker liveness

`live_worker=YES` when a matching registry entry, formal worker lease, or current claim heartbeat is live. `live_worker=NO` requires all applicable signals to be absent/expired and the parent Campaign to be paused. If the system cannot reliably resolve a signal, it returns `UNKNOWN`, which forces `STALE_NOT_PROVEN`.

### 5.3 Binding liveness

Manual Bind extension checkpoint/heartbeat updates carry the exact Campaign, Queue, Source, claim token/generation, binding generation and binding fingerprint. A matching heartbeat inside `liveBindingLeaseMs` is live. A historic `bound_url` alone is not a live binding. Missing/expired binding is only one stale proof; it never independently proves stale.

### 5.4 In-flight work

Any of the following blocks recovery: capture, Initial QA, Initial activation, scoped export, or Source runner activity. The end-stale transaction rechecks both persisted evidence and the process activity registry after the SQLite write transaction begins.

## 6. Stale determination

Only a parent Campaign in `paused` may enter stale evaluation. `running` and `manual_required` are always `NOT_ELIGIBLE`, regardless of age. Terminal Campaigns are not blockers.

The first inspection can return at most `STALE_NOT_PROVEN`; it establishes immutable evidence. A second inspection may return `STALE_CONFIRMED` only when:

- it starts at least `consecutiveInspectionMinIntervalMs` after the first completed inspection;
- Campaign/Queue/Source identity and statuses are unchanged;
- claim token and generation are unchanged;
- runner remains `PAUSED` or `STOPPED`;
- canonical progress and checkpoint fingerprints are unchanged;
- no worker, binding or in-flight operation is live;
- no heartbeat or progress resumed;
- the appropriate age threshold still passes.

For formal heartbeat claims, the latest formal heartbeat/activity must be at least `claimHeartbeatStaleAfterMs` old. For legacy claims without formal heartbeat history, the `LEGACY_NO_HEARTBEAT_FALLBACK` requires at least `legacyNoHeartbeatStaleAfterMs` since the maximum trustworthy activity timestamp:

`max(queue activity, Source progress, checkpoint, Campaign update, Source Run update)`.

Missing timestamps, malformed evidence, or ambiguity returns `STALE_NOT_PROVEN`.

The canonical progress fingerprint uses versioned deterministic serialization over Campaign counts, Queue checkpoint progress fields, latest batch identity/time, Source contribution, Source Run progress and binding generation. It excludes local timezone formatting and unordered JSON object insertion order.

## 7. Persistence and migration

A new additive migration creates:

1. `catalog_rpa_claim_inspections`: immutable inspection snapshots, linked to exact Campaign/Queue/Source and claim generation;
2. `catalog_rpa_claim_termination_audits`: append-only operator action and result evidence with a unique `request_id`;
3. any minimal claim-generation/lease columns required on `catalog_rpa_queue`, with safe defaults that do not rewrite historical Campaign semantics.

No historical migration checksum is edited. Existing Campaign rows are not backfilled or reclassified. Legacy evidence is interpreted by the service contract.

Append-only behavior is enforced through repository API and SQLite triggers that reject UPDATE/DELETE on inspection and termination audit records.

## 8. Controlled end-stale API

Endpoints remain under `/api/catalog/operator`:

- `GET /api/catalog/operator/rpa-claim-blockers`
- `POST /api/catalog/operator/rpa-claims/:campaign_id/inspections`
- `POST /api/catalog/operator/rpa-claims/:campaign_id/end-stale`

The end request requires exact Campaign, Queue and Source IDs, first and second inspection IDs, expected claim token/generation, a server-defined operator confirmation value, and an idempotency request ID.

Inside one SQLite transaction the service:

1. checks an exact idempotent replay;
2. reloads both immutable inspections;
3. verifies the second inspection is `STALE_CONFIRMED`;
4. rechecks identity, statuses, claim, generation, progress, heartbeat, binding and all in-flight flags;
5. changes Campaign, Queue and Source to `cancelled`;
6. finishes every unfinished Source Run with `STALE_CLAIM_ENDED_BY_OPERATOR`;
7. closes the claim lease without deleting historical token/evidence;
8. writes one append-only audit in the same transaction.

Any mismatch throws `STALE_CLAIM_RECHECK_FAILED` with zero writes. Faults roll back all terminalization and audit writes. Same request ID and same parameters replay the first result; changed parameters throw `STALE_CLAIM_IDEMPOTENCY_CONFLICT`.

The audit stores operator action/source, IDs and scope, previous/new statuses, both inspection IDs, stale evidence, thresholds, token/generation, reason and timestamp.

## 9. Campaign creation conflict contract

Initial and Expansion creation continue to reject implicit resume and perform zero writes when blockers exist. `CATALOG_RPA_CLAIM_CONFLICT` now contains:

- `primary_blocker`;
- `all_blockers`;
- stale status/reasons;
- supported inspection/action URLs.

Ending a blocker does not automatically retry Campaign creation. After all blockers are gone, the operator makes an explicit create request. Existing request-ID idempotency remains unchanged.

## 10. Catalog UI

The Catalog module owns blocker state, inspection loading/errors, confirmation and recovery result. It renders all blockers and marks the primary blocker. Each card shows Campaign, Category/Profile, type, Campaign/Queue/runner status, last activity, worker/binding state, stale determination and blocking reasons.

`查看任务` is always available. `结束陈旧占用` appears only for `STALE_CONFIRMED`. The click requires a second confirmation stating that Campaign/Queue/Source become cancelled, history and catalog data remain, and the Campaign cannot resume. The UI submits only exact server identities and the fixed confirmation protocol; the server never trusts UI state.

Catalog refresh/polling remains scoped to `catalog-module-root` and does not mutate YingDao state or DOM.

## 11. Legacy CDP and Manual Bind UX

The existing global button is legacy External CDP using Playwright `connectOverCDP` at port 9222. It moves into a collapsed `高级工具` section and is relabeled `旧版 / 高级浏览器连接（CDP 9222）` with the text `Manual Bind 手工采集不需要连接 CDP。`

The Catalog primary flow displays:

1. 创建首次采集任务；
2. 打开 Temu 类目页面；
3. 人工确认 Germany / English / EUR / Top Sales；
4. 使用 Temu 扩展检测当前页面；
5. 绑定当前页面；
6. 采集当前页面。

Legacy CDP disconnected/error state cannot disable Profile capability, Initial creation or Manual Bind extension actions, and cannot render a Catalog-global prerequisite message. Legacy Jobs/Review browser controls otherwise remain in the legacy shell.

## 12. TDD and regression

Implementation follows eight independently committed TDD tasks:

1. inspection model and complete blocker list;
2. thresholds, liveness and legacy stale determination;
3. immutable double inspection and race/recheck evidence;
4. atomic terminalization, audit, idempotency and fault rollback;
5. Catalog blocker UI and confirmation;
6. Legacy CDP downgrade and Manual Bind steps;
7. girls-sets conflict/idempotency regression;
8. full verification, stable integration and controlled production acceptance.

Tests use temporary SQLite and injected clocks/activity registries. Coverage includes every threshold boundary, UNKNOWN liveness, running/manual-required rejection, token/progress/binding races, multiple blockers, atomic rollback, zero Catalog data drift, CDP-disconnected Manual Bind, YingDao isolation and exact baseline-failure identity.

## 13. Production execution boundary

Only after feature/stable tests, ff-only integration and controlled Dashboard restart may production inspection run for:

- `catalog_campaign_6e86fd902ac244e08eade55975e8b9ac`;
- `catalog_campaign_4ea0bfffab774610b3bdc67b6c61e276`.

Each receives two inspections at least 10 seconds apart. If either is not `STALE_CONFIRMED`, no claim is ended and no girls-sets Campaign is created. If both are confirmed, the exact approved request IDs are used. Products, Memberships, Pools, Pool items, snapshots and Motorcycle taxonomy are compared before/after.

Only after both audits pass may the existing Initial creation service create exactly one `girls-sets` Campaign named `采集童装` with request ID `operator-create-girls-sets-initial-20260902-v1`. Expected public semantics are OPEN_ENDED, baseline 0, current unique 0 and UNBOUND. No detect, bind, capture, scrolling, QA or activation occurs.

## 14. Git and runtime delivery

Design, Plan and each TDD task are separate commits on `codex/stale-claim-browser-ux-v1`. The local dependency symlink is removed before final cleanliness checks. The feature branch is normally pushed, then stable `codex/catalog-yingdao-runtime` is advanced only by `git merge --ff-only`, fully retested, normally pushed and restarted after exact process identity verification. Force push, rebase and amend are prohibited.

## 15. Design gates

- `DESIGN_GATE = PASS`
- `UNRESOLVED_SCOPE_DECISIONS = 0`
- `PRODUCTION_STALE_CLAIM_TERMINATED_DURING_DESIGN = NO`
- `GIRLS_SETS_CAMPAIGN_CREATED_DURING_DESIGN = NO`
- `MANUAL_BIND_REQUIRES_CDP = NO`
- `SINGLE_DASHBOARD_PROCESS_REQUIRED = YES`
