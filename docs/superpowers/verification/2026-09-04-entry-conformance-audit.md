# Retained Entry implementation conformance audit

Read-only audit after design amendment 99c1dbf. Retain all original commits. Focused temporary DB tests: 8/8 PASS (localhost listen required sandbox permission; initial EPERM was environmental).

| Commit | Capability | Design requirement | Current behavior | Status | Patch required | Files |
|---|---|---|---|---|---|---|
|9e0ceb7|Resolver reads|No creation/resume/claim writes|SELECT-only resolver|PASS|No|operator-entry-service.mjs|
|9e0ceb7|Identity|Exact frozen category/profile scope and children|Checks version/mode, but not frozen membership scope or child integrity|PARTIAL|G1|operator-entry-service.mjs|
|9e0ceb7|Precedence|Ambiguity/history/active+unfinished before actions|Branches present; active+unfinished test uses invalid empty pool, not valid pool|PARTIAL|G1 tests|catalog-explicit-entry.test.mjs|
|9e0ceb7|Quantity|Existing OPEN_ENDED policy|Reuses policy, does not reinterpret sentinel|PASS|No|operator-entry-service.mjs|
|c18efce|Exact continuation|Explicit id, no resumeRpa, manual mode, terminal rejection|All present|PASS|No|operator-entry-service.mjs|
|c18efce|Child/run scope|Exact category/source/queue/run ownership|Counts and source/campaign relation checked; source category and frozen profile scope incomplete|PARTIAL|G1|operator-entry-service.mjs|
|c18efce|Claim|Foreign zero writes, same valid reuse, missing exact acquire|Atomic transaction and retained run present; blocker details omitted|PARTIAL|G2|operator-entry-service.mjs, catalog-campaign-service.mjs thin injection|
|c18efce|Success tuple|running/capturing/capturing, sole unfinished run, UNBOUND, paused capture|Transitions and binding reset present|PASS|G2 additional no-run/manual_required/rollback coverage|Entry tests|
|c18efce|Replay|Revalidate current ownership/state|Rejects terminal/missing claim; may replay success with source/queue no longer capturing|PARTIAL|G2|operator-entry-service.mjs|
|4d8f01a|API|Exact path/body campaign, category/profile and request_id|Registry exact resolve, body identity check, required request id, local-origin check|PASS|G3 negative coverage|catalog-explicit-entry-api.test.mjs|
|4d8f01a|Race|Two connections, one winner, hard failure with zero partial rows|Worker connections/barrier and aggregate row assertions present|PARTIAL|G3: loser code, all create rows, same-request distinction and timeout coverage|Entry API test/worker|

Remaining UI G4: server descriptor buttons and quantity controls. G5: read-only selection/polling, click coalescing, scoped retry identity and stale response isolation. G6: complete regression environment and exact-seven comparison.

GAP_COUNT = 6
SAFE_TO_CONTINUE_REMAINING_IMPLEMENTATION = YES

No core repository, quantity policy, QA, activation, extension, migration or frozen snapshot changes are needed. Do not migrate either old branch.
