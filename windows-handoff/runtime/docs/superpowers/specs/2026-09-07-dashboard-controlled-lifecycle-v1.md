# Dashboard controlled lifecycle V1

Reuse Page-Derived Category Profile at 6ba7977. Operators use the existing launcher and browser buttons; deployment must not require terminal or sudo interaction.

## Runtime contract

Wrap the entire HTTP handler and track promises until handler completion, not response close. A disconnected client does not imply finished work. Expose GET /api/runtime/activity with aggregate counts only: no URL, query, body, business identity or token. Reading the endpoint performs no DB writes.

Graceful close first closes admission in memory. New requests receive 503, while already admitted handlers finish. Only after handlers finish may connections and databases close. No forced timeout or SIGKILL. This is process-local evidence only; detached Jobs/Review workers still require independent OS inspection. The endpoint must never claim global quiescence.

## First deployment

The old implementation cannot acquire this new gate without restart. On 2026-09-07 no 37821 listener was found; reverify all project processes and production DB occupancy before offline integration. Never infer that a missing listener proves absent detached workers. Preserve .DS_Store and all unrelated changes. Record business fingerprints before and after startup. No Campaign action, binding, capture, QA or activation.

## TDD sequence

1. RED: pending async handler and disconnected response stay active; drain rejects new work; read-only status excludes itself. Implement minimal tracker; GREEN.
2. Wire HTTP server and graceful close; real HTTP regression with delayed request and closed client; GREEN.
3. Run relevant existing regression and full fixture suite, compare known failures. Commit bounded lifecycle changes.
4. Offline process/DB checks, fingerprints, FF integration only when verified. Deployment remains incomplete until startup equality and browser acceptance pass.

No tshark, packet capture, persistent root permissions or production access logs are required. No new business system or migration.

## Local verification

Lifecycle unit/real HTTP: 4 passed. Related HTTP/Catalog/YingDao: 14 passed. Full suite with preserved historical fixture DBs and images: 852 tests, 843 passed, 7 known failures, 2 skipped. The seven failure names remain the two legacy Excel/reset failures and five image-cache failures. `npm run check` and diff whitespace check passed.

An initial full run using a copy of current operator data had four additional fixture-precondition failures (existing Review revisions and missing historical image fixture). Restoring the historical fixture inputs removed those failures without altering test assertions or production data.

Deployment not yet performed. Runtime endpoint reports PROCESS_ONLY and intentionally does not assert absence of detached workers. Existing production worktree has an untracked .DS_Store preserved in place.
