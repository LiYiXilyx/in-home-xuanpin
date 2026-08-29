# Project Current State

State captured at the completed freeze boundary: `2026-08-29T15:47:57+08:00`

This file records the state observed from the current Git checkout, repository files, and the formal SQLite database. It is not reconstructed from chat history.

## Repository and Git

- Repository: `LiYiXilyx/in-home-xuanpin`
- Local checkout: `C:\Users\Administrator\Documents\ChatGPT\选品上架-家里版本\temu选品`
- Remote: `origin = https://github.com/LiYiXilyx/in-home-xuanpin.git`
- Branch: `feat/catalog-3000-rpa`
- Previous HEAD before the cross-PC checkpoint: `fdfcf79b23f63a10b4775c55459f0367ef57b2da`
- Previous HEAD commit: `fix: restore applied sourcing migration checksum`
- Previous upstream comparison: `0 behind / 0 ahead` relative to `origin/feat/catalog-3000-rpa`
- Cross-PC checkpoint commit: the commit containing this file, with message `wip: checkpoint catalog full refresh cross-pc state`. Resolve its immutable SHA with `git rev-parse HEAD` after checkout; a Git commit cannot embed its own hash in its contents.

The checkpoint scope includes Catalog Full Refresh, manual passive capture, fixed Chrome handling, sales evidence/reporting, runbooks, and related tests. Database files, backups, profiles, logs, Cookies, Tokens, and credentials are excluded from Git.

## Track A

- Track A Phase 1: **PASS**.
- Acceptance record: `docs/TRACK_A_NETWORK_PHASE1_ACCEPTANCE.md`.
- Last recorded focused Track A + Review regression: `86 / 86 PASS`.
- Live acceptance proved natural `/de-en/api/poppy/v1/opt` traffic, `40` normalized rows, zero invalid identities, cache insertion, strict goods identity merge, and a 10-goods enrichment sample.
- Track A does not promote `NETWORK_ONLY` observations into formal products.

### Network runtime versions

| Runtime | Version |
| --- | --- |
| MAIN network runtime | `track-a-runtime-v2` |
| ISOLATED network runtime | `track-a-runtime-v2` |
| MAIN identity contract | `track-a-id-v2` |
| ISOLATED identity contract | `track-a-id-v2` |
| Parser endpoint gate | `track-a-parser-endpoint-v3` |

## Migration State

- Formal database: `data/temu_research_v2.db`
- Journal mode: `WAL`
- Migration max: `025_opportunity_confirmation.sql`
- SQLite integrity: `ok`
- Foreign-key violations: `0`

### Migration 024

- Filename: `024_sourcing_1688.sql`
- Repository raw SHA-256: `e3f0fd353549a74432d323edf337d79674b3de31b88dc219b27b988f21f7fae9`
- Applied database checksum: `e3f0fd353549a74432d323edf337d79674b3de31b88dc219b27b988f21f7fae9`
- Applied at: `2026-08-28T07:13:44.132Z`
- Status: immutable repository file and applied checksum match exactly.

### Migration 025 and Opportunity Confirmation Gate

- Filename: `025_opportunity_confirmation.sql`
- Applied checksum: `206af59838a709eb5e2bfdd86f1d5d6413a2ccc591bef46b147bda5dd8c4f512`
- Applied at: `2026-08-29T03:16:52.553Z`
- Implementation status: code and formal schema are deployed.
- Gate behavior: fail closed; only an explicit persisted human `approved` decision can make a candidate eligible for future Track B or Track C work.
- Current confirmation rows: `0`.
- Current confirmation event rows: `0`.
- The frozen Opportunity snapshot remains `awaiting_confirmation`; it has not been recomputed or changed by Catalog work.

## Formal Database State

| Metric | Current value |
| --- | ---: |
| Products | 2372 |
| Catalog memberships | 2372 |
| Active memberships | 2135 |
| Product snapshots | 4205 |
| Reviews | 147 |
| Opportunity snapshots | 2 |
| Opportunity candidates, all snapshots | 10 |
| Opportunity confirmations | 0 |
| Opportunity confirmation events | 0 |

### Active Pool

- ID: `catalog_pool_bdc90c9ae44740cea0e7a1b59476fd63`
- Status: `active`
- Declared count: `2135`
- Actual pool item count: `2135`
- Activated at: `2026-08-27T09:56:15.128Z`

### Opportunity

- Latest snapshot ID: `opportunity_snapshot_7f5cf83a3b7b469f9f4a3f0d5ecbf972`
- Status: `awaiting_confirmation`
- Generated at: `2026-08-27T10:14:18.792Z`
- Candidate count in this snapshot: `5`
- Confirmations for this snapshot: `0`
- Confirmation events for this snapshot: `0`
- Business gate: `OPPORTUNITY_PRODUCT_CONFIRMATION`

## Track Status

- Track A Phase 1: `PASS`.
- Track B: `NOT STARTED / BLOCKED` by the absence of approved Opportunity confirmations.
- Track C: `NOT STARTED / BLOCKED` by the absence of approved Opportunity confirmations.
- Existing Review and 1688 tables or historical probe artifacts are not authorization to start Track B or Track C.

## Product Identity and Snapshot Rules

- Stable product identity: `platform + goods_id`.
- In the `products` table this is enforced as `UNIQUE(platform, external_product_id)`.
- `goods_id` is stored and compared as an exact string. URL is provenance/navigation evidence, not identity.
- An already known identity must reuse its existing `products` row.
- A Full Refresh observation creates a **new** `product_snapshots` row after QA/materialization; it must not rewrite or delete an old snapshot.
- Only a truly unknown `platform + goods_id` may create a new `products` row and membership.
- Campaign staging is deduplicated by Campaign plus stable identity.

## Fixed Temu Chrome Design

- Chrome executable: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- Chrome User Data directory: `C:\Users\Administrator\AppData\Local\Google\Chrome\User Data`
- Formal profile directory: `Profile 10`
- Formal profile display name: `Temu1店`
- Required extension: the unpacked extension from this repository's `browser-extension` directory.
- Required local endpoint: `http://127.0.0.1:37821`
- Formal default-profile operation: `CDP_REQUIRED = false`.
- Port `9222` is not a requirement for the formal Profile 10 workflow. Chrome 136+ does not accept remote debugging against the default User Data directory in the required way.
- CDP may only be used by a separate, explicit browser-automation test mode with a non-default `--user-data-dir`; it must never alter or replace the formal profile.
- No Cookie, Token, login identity, or profile data may be copied. Login and CAPTCHA remain human actions.
- No fallback to `browser-profile-day4`, a fresh profile, another port, or another Temu identity is allowed.

The current Full Refresh Campaign is stored with the legacy label `FULL_REFRESH_EXTENSION_AUTO`, but its persisted checkpoint explicitly has `automatic_navigation=false`, `automatic_scroll=false`, `automatic_see_more=false`, and `automatic_try_again=false`. The latest operator instruction is authoritative: the human clicks `See more`, `Try again`, and `采集当前商品列表`; the program only processes that submitted page state.

## Catalog Full Refresh

### Required 50-goods gate

- Campaign ID: `catalog_campaign_f15018fc38154c17b385a87d8762f3ce`
- Name: `FULL_REFRESH_50_20260829064214`
- Target / accepted: `50 / 50`
- Status / QA: `completed / passed`
- Raw observed: `77`
- Electronic excluded: `3`
- Manual visible sales sample: `20 / 20 PASS`
- Materialization produced 50 new snapshots, reused existing identities, created one genuinely new product, and did not switch the Active Pool.

### Current 2000-goods Campaign

- Campaign ID: `catalog_campaign_6e86fd902ac244e08eade55975e8b9ac`
- Name: `FULL_REFRESH_2000_20260829065347`
- Type / mode: `refresh / FULL_REFRESH_EXTENSION_AUTO`
- Campaign status / QA: `paused / pending`
- Queue ID / status: `catalog_rpa_5251e3ff4d9e4ff688ec7f383e45833f / capturing`
- Checkpoint runner state: `PAUSED`
- Resumable: `yes`, through the same Campaign ID and existing queue/checkpoint.
- Target: `2000 refreshed unique identities`
- Accepted unique: `1208`
- Remaining: `792`
- Raw observed: `2154`
- Electronic excluded: `83`
- Overlap with previous Active Pool: `1087`
- Existing in all formal Products: `1092`
- Truly new relative to all formal Products: `116`
- Campaign duplicate goods identities: `0`
- Failed: `0`
- Sales parse success / raw sales evidence: `1208 / 1208`
- Network enriched / DOM fallback: `1194 / 14`
- Manual sales sample for the 2000 Campaign: `PENDING`
- Materialization: **not run**.
- Formal Products, snapshots, Active Pool, Reviews, migrations, and Opportunity have not changed from this Campaign.
- Frozen at: `2026-08-29T07:45:10.702Z`
- Last checkpoint: `2026-08-29T07:45:11.041Z`
- Last batch: `5d4ce2bb-46f3-44af-aaab-3c1b0061000a`
- Last observed goods_id: `606231007729593`
- Last observed at: `2026-08-29T07:19:31.135Z`

Temu stopped yielding a healthy continuation and displayed `Try again`. No CAPTCHA or `Try again` bypass was attempted. The accepted rows and checkpoint are persisted in the formal SQLite Campaign staging tables.

## Sales Count Correction Goal

- Every accepted Full Refresh record must retain `raw_sales_text`, `parsed_sales_count`, `final_sales_count`, and `sales_provenance`.
- Compact counts must be parsed deterministically, including `K`, `M`, `B`, `+`, decimal comma/point, and grouped separators. Example: `77K+` must become `77000`.
- A valid current value may correct a likely historical parse error only through a new snapshot and an auditable old/new comparison.
- Historical snapshots are immutable and must never be rewritten to make the comparison look clean.
- Missing or invalid current sales evidence must not overwrite a healthy historical value and must not be guessed.

## Cross-PC Database Backup

The formal database was initially observed in WAL mode. The Campaign was paused first, the project Node server/backend processes were stopped, and `PRAGMA wal_checkpoint(TRUNCATE)` completed with `busy=0`. After the connection closed, neither `temu_research_v2.db-wal` nor `temu_research_v2.db-shm` remained.

- Frozen formal database: `data/temu_research_v2.db`
- Frozen formal database size: `264830976` bytes
- Frozen formal database SHA-256: `55ac19572ce229a743ab0d5f6066a810382c62e6b030c5524d7d3825afcb531b`
- SQLite-safe backup: `backups/cross-pc-full-refresh-20260829-154631/temu_research_v2.db`
- Backup size: `264830976` bytes
- Backup SHA-256: `8ec9ed888ea6835694e327f4141fdf91954b45bc8073fdea28cc2d13d49bb86a`
- Backup integrity / FK violations: `ok / 0`
- Backup migration max: `025_opportunity_confirmation.sql`
- Backup Campaign: the same ID, `paused`, `1208 / 2000`, runner checkpoint `PAUSED`
- Backup Active Pool: `catalog_pool_bdc90c9ae44740cea0e7a1b59476fd63 / 2135`
- Backup Opportunity: `opportunity_snapshot_7f5cf83a3b7b469f9f4a3f0d5ecbf972 / awaiting_confirmation`

The source and backup hashes are not expected to be identical because SQLite backup can produce a logically equivalent database with a different physical page image. The portable artifact is identified by the backup hash above. On the next computer, verify that exact backup hash before installation, then rerun migration metadata, counts, `PRAGMA integrity_check`, and `PRAGMA foreign_key_check` before any Campaign action.

## Freeze Verification

- Catalog / Full Refresh / Track A targeted tests: `86 passed / 0 failed`.
- `npm run check`: `PASS`.
- `git diff --check`: `PASS` before the checkpoint commit.
- No unrelated legacy failure was encountered in the requested targeted suite.
