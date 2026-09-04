# Page-Derived Category Profile V1 — local verification

Date: 2026-09-04

Feature branch: `codex/page-derived-category-profile-v1`.
Stable base: `e7f04e6d4155485601509dfbf1289f002c867ffc`.

## Executed checks

- Focused checks: 22 passed, 0 failed.
- Related checks: 70 passed, 0 failed.
- Final full suite: 848 tests, 839 passed, 7 failed, 2 skipped.
- The seven failing test names match `/private/tmp/entry-deploy-full.tap`: two server-jobs Excel/reset tests and five existing image-cache tests. No new or environment failures.
- `npm run check` and `git diff --check` passed.
- Ten local HTML fixtures inspected: five Category listings accepted; search, detail, home, security, and empty pages rejected.
- Independent process registration race: one persisted Profile identity.
- Temporary Dashboard displayed the quick Category area and retained advanced onboarding and YingDao root. No real Temu page was operated.

Test logs are local temporary evidence, not committed artifacts. Final full output: `/private/tmp/page-derived-full-final.tap`.

## Deployment deferred

No stable merge, production migration, restart, or extension reload performed.
The existing read-only blocker response short-circuits for running Campaigns and cannot prove absence of runtime capture/QA/export activity. The richer inspection operation persists an inspection row and was deliberately not called. Runtime inactivity remains UNVERIFIED, not presumed active or idle.

Production Profile/Campaign writes by this task: 0. Real Temu detection/capture: 0. Frozen Snapshot/Image Cache implementation untouched.

## Limits

The parser accepts the fixture-verified DE/English Category URL grammar and blocks unknown forms rather than guessing. Production browser compatibility is not claimed by fixture acceptance. Final stable and cold-start fingerprint acceptance remains pending the deployment gate.
