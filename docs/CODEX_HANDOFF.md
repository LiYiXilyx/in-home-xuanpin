# Codex Cross-PC Handoff

Handoff captured at the completed freeze boundary: `2026-08-29T15:47:57+08:00`

## Last Completed Actions on This Computer

1. Track A Phase 1 reached final real-network acceptance and is recorded as `PASS` with runtime versions `track-a-runtime-v2 / track-a-id-v2` and parser endpoint gate `track-a-parser-endpoint-v3`.
2. Migration `024_sourcing_1688.sql` was restored to the exact immutable bytes already recorded in the formal database. Repository and database SHA-256 both equal `e3f0fd353549a74432d323edf337d79674b3de31b88dc219b27b988f21f7fae9`.
3. Migration `025_opportunity_confirmation.sql` was formally applied. The Opportunity Confirmation Gate is deployed and fail-closed, but no human confirmation has been recorded.
4. The mandatory real `FULL_REFRESH_50` Campaign completed and passed strict QA. It materialized 50 new snapshots, reused old identities, created one new product, and left the Active Pool and Opportunity unchanged.
5. A `FULL_REFRESH_2000` Campaign was created and manually captured through the fixed Temu profile. Temu eventually displayed `Try again`; no bypass or automatic continuation was attempted.
6. The 2000 Campaign was formally transitioned to `paused`; its existing queue/checkpoint is resumable at `1208 / 2000` with runner state `PAUSED`.
7. Project Node server/backend processes holding the database were stopped. WAL was closed with `PRAGMA wal_checkpoint(TRUNCATE)` and no `-wal` or `-shm` remained afterward.
8. A SQLite-safe backup was created and validated at `backups/cross-pc-full-refresh-20260829-154631/temu_research_v2.db`.
9. Catalog / Full Refresh / Track A targeted tests passed `86 / 86`; `npm run check` and `git diff --check` passed.
10. The required source, tests, runbooks, and handoff documents are included in the WIP checkpoint commit that contains this file. Database/profile/secrets are excluded.

## Current Campaigns

| Purpose | Campaign | Mode | Campaign status | Queue/checkpoint | Progress |
| --- | --- | --- | --- | --- | ---: |
| Current Full Refresh | `catalog_campaign_6e86fd902ac244e08eade55975e8b9ac` | `FULL_REFRESH_EXTENSION_AUTO` with all automatic actions disabled in checkpoint | `paused`, QA `pending` | queue `catalog_rpa_5251e3ff4d9e4ff688ec7f383e45833f` is retained; runner state `PAUSED` | `1208 / 2000` |
| Required smoke evidence | `catalog_campaign_f15018fc38154c17b385a87d8762f3ce` | `FULL_REFRESH_EXTENSION_AUTO` | `completed`, QA `passed` | queue completed | `50 / 50` |
| Old new-product expansion | `catalog_campaign_4ea0bfffab774610b3bdc67b6c61e276` | `MANUAL_NAVIGATION_PASSIVE_CAPTURE` | `paused`, QA `pending` | queue row says `capturing`, but persisted runner state is `PAUSED` | `2142 / 3000` total, originating from baseline `2135` |

### Does the old new-product Campaign need to be stopped?

No new stop action is required before handoff: the old expansion Campaign is already logically paused and its checkpoint runner state is `PAUSED`. Do not resume it on the next machine. Its queue-status/checkpoint-status mismatch must be inspected through the service/admin tools before any cleanup; do not edit the database directly, delete its queue, or reuse it as the Full Refresh Campaign.

## Current Full Refresh Meaning

The target is exactly `2000` accepted, unique, non-electronic `platform + goods_id` identities observed in the Full Refresh Campaign. The gate is not raw network rows, page links, batch rows, or historical Active Pool count.

Current 2000-Campaign facts:

- accepted unique: `1208`
- remaining: `792`
- raw observations: `2154`
- electronic exclusions: `83`
- overlap with previous Active Pool: `1087`
- existing in all formal Products: `1092`
- truly new relative to all formal Products: `116`
- duplicate identities in Campaign staging: `0`
- failed: `0`
- materialization: not run
- manual sales sample: pending
- frozen at: `2026-08-29T07:45:10.702Z`
- last checkpoint: `2026-08-29T07:45:11.041Z`
- last batch: `5d4ce2bb-46f3-44af-aaab-3c1b0061000a`
- last observed goods_id: `606231007729593`
- resumable: yes, from the existing Campaign and queue/checkpoint

The current 1208 records are persisted in Campaign staging and checkpoint tables in `data/temu_research_v2.db`. They are not yet formal refresh snapshots.

## Product and Snapshot Invariants

- Stable identity is `platform + goods_id`, mapped to `products(platform, external_product_id)`.
- Existing goods must be recaptured for current fields, but must not create a duplicate `products` row.
- Every accepted existing or new identity receives a new snapshot only after the Campaign reaches its gate and passes QA/materialization.
- Old snapshots must remain immutable and queryable.
- A new product row is allowed only when no matching `platform + goods_id` exists.
- `source_url` is evidence/provenance and is not the product identity.
- Active Pool switching is a separate transaction-gated human decision and is not part of this Full Refresh.

## Next Computer: Required First Actions

Do these in order. Do not start or resume the 2000 Campaign first.

1. Pull `origin/feat/catalog-3000-rpa` and verify that HEAD is the WIP checkpoint commit containing this document. Do not reset or rebase.
2. Obtain `backups/cross-pc-full-refresh-20260829-154631/temu_research_v2.db` through a separate data-transfer channel; it is intentionally not in Git.
3. Verify the backup SHA-256 is exactly `8ec9ed888ea6835694e327f4141fdf91954b45bc8073fdea28cc2d13d49bb86a` before using it.
4. With the next machine's server stopped, preserve any local database and place the verified backup at `data/temu_research_v2.db`. Do not copy a Chrome profile, Cookie, or Token.
5. Verify the synchronized database: migration max `025_opportunity_confirmation.sql`, exact `024` checksum, Products `2372`, snapshots `4205`, Reviews `147`, Active Pool `2135`, Campaign `paused / 1208`, integrity `ok`, and zero FK violations before any write.
6. Verify the fixed Temu browser contract: Chrome executable, `Profile 10 / Temu1店`, existing unpacked extension, and `http://127.0.0.1:37821`. Formal Profile 10 does **not** require CDP/9222. Do not create or select a fallback profile.
7. Verify the synchronized completed `FULL_REFRESH_50`, its `20 / 20` visible-sales evidence, materialization, and QA. If it did not transfer exactly, stop; do not bypass it.
8. Resume the existing Campaign by using the project service transition `paused -> running` for `catalog_campaign_6e86fd902ac244e08eade55975e8b9ac`. Do **not** create a new `FULL_REFRESH_2000` Campaign.
9. Start the local server, open the fixed Temu profile, and manually verify Germany / English / EUR / Motorcycles & Powersports Accessories / Top sales / healthy cards.
10. Continue from `1208 -> 2000`. The human clicks `See more`, `Try again`, and `采集当前商品列表`; do not interpret the stored mode label as permission to automate those actions.

The persisted resume cursor is:

```text
campaign_id = catalog_campaign_6e86fd902ac244e08eade55975e8b9ac
queue_id = catalog_rpa_5251e3ff4d9e4ff688ec7f383e45833f
last_batch_id = 5d4ce2bb-46f3-44af-aaab-3c1b0061000a
last_observed_goods_id = 606231007729593
current_unique = 1208
```

## Sales QA PASS Conditions

For `FULL_REFRESH_50`, PASS requires all of the following:

- accepted unique equals exactly `50`;
- duplicate `platform + goods_id` equals `0`;
- all 50 have `raw_sales_text`, valid `parsed_sales_count`, `final_sales_count`, and provenance;
- the human-visible sample is exactly `20 / 20 PASS`;
- accepted-to-new-snapshot missing equals `0` after materialization;
- one new snapshot exists per accepted identity;
- product and membership deltas exactly match genuinely new identities only;
- no invalid network value overwrites a healthy DOM value;
- Active Pool and active memberships are unchanged;
- Reviews, migration max, and frozen Opportunity data are unchanged;
- SQLite integrity is `ok` and FK violations are `0`;
- every failure is zero or explicitly isolated with an auditable reason.

The 2000 run uses the same evidence rules and additionally requires exact 2000 identity coverage, old/new field comparison, sales delta/ratio reporting, and a historical sales-correction report. A compact value such as `77K+` must parse to `77000`; historical incorrect values must remain in old snapshots and be corrected only by a new snapshot.

## Opportunity and Downstream Freeze

- Latest Opportunity Snapshot: `opportunity_snapshot_7f5cf83a3b7b469f9f4a3f0d5ecbf972`.
- Status: `awaiting_confirmation`.
- Candidates in latest snapshot: `5`.
- Confirmations / events: `0 / 0`.
- Do not recompute Opportunity during Catalog Full Refresh.
- Do not create Review or 1688 work from scores or historical artifacts.
- Track B and Track C remain `NOT STARTED / BLOCKED` until a matching human confirmation is persisted as `approved`.

## Fixed Chrome and Human Boundaries

- Formal identity: `Profile 10 / Temu1店` in the default Chrome User Data directory.
- Formal capture: extension plus `localhost:37821`; `CDP_REQUIRED=false`.
- Human handles navigation, login, CAPTCHA, `Try again`, scrolling, `See more`, and the visible `采集当前商品列表` button.
- Program handles parsing, strict identity dedupe, electronic exclusion, staging, checkpoint, QA, and SQLite persistence.
- Never copy Cookies or Tokens, create another official profile, replay Temu requests, call private APIs directly, automate CAPTCHA, or auto-fallback to another profile/port.

## Prohibited Recovery Actions

- Do not run `git reset --hard`, discard the dirty working tree, or check out files over it.
- Do not modify an applied migration, especially `024` or `025`.
- Do not update/delete `schema_migrations`, bypass checksum verification, disable the migration guard, or force-reapply a migration.
- Do not bypass CAPTCHA, login verification, `Try again`, or Temu safety pages.
- Do not start Track B or Track C.
- Do not recompute Opportunity.
- Do not switch the Active Pool as part of Full Refresh capture or handoff recovery.
- Do not materialize the partial `1208 / 2000` Campaign as if it had reached the target.

## Database Package

- Path on the old computer: `backups/cross-pc-full-refresh-20260829-154631/temu_research_v2.db`
- Size: `264830976` bytes
- SHA-256: `8ec9ed888ea6835694e327f4141fdf91954b45bc8073fdea28cc2d13d49bb86a`
- Integrity / FK: `ok / 0`
- Migration max: `025_opportunity_confirmation.sql`
- Campaign proof: same ID, `paused`, `1208 / 2000`, checkpoint `PAUSED`
- Active Pool proof: `catalog_pool_bdc90c9ae44740cea0e7a1b59476fd63 / 2135`
- Opportunity proof: `opportunity_snapshot_7f5cf83a3b7b469f9f4a3f0d5ecbf972 / awaiting_confirmation`

This database package is ignored by Git and must be transferred separately.

## Git Checkpoint

- Branch: `feat/catalog-3000-rpa`
- Previous HEAD: `fdfcf79b23f63a10b4775c55459f0367ef57b2da`
- Checkpoint message: `wip: checkpoint catalog full refresh cross-pc state`
- Exact checkpoint SHA: resolve with `git rev-parse HEAD` after pulling the commit that contains this document; a commit cannot embed its own SHA.
- Targeted tests: `86 / 86 PASS`
- `npm run check`: `PASS`
- `git diff --check`: `PASS`

Push target: `origin/feat/catalog-3000-rpa` by normal non-force push.
