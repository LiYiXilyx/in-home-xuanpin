# Catalog Scale Day4 Company-to-Home Handoff

## Checkpoint

- Branch: `feat/catalog-3000-rpa`
- Day4 code commit: `f935588cb6880fcd3be3f55b7c876d7ed9b6dc45`
- Push status: pushed to `origin/feat/catalog-3000-rpa`
- Configured `origin`: `F:\temu选品`
- GitHub remote name in this checkout: `github`
- Current architecture: `Extension-First`
- Current stage: `Day4 PASS`
- Next stage: `Day5 1500` (not started)

## Production database

- Source: `data/temu_research_v2.db`
- Consistent backup: `backups/day4-company-to-home-20260826-182721/temu_research_v2.db`
- Backup SHA-256: `66F7A46E36B0CC4C3F40EC00F09A61419E4C10755E995BE89B5E3BC5E8174192`
- Backup integrity: `PRAGMA integrity_check = ok`
- Products: `1669`
- Active memberships: `1000`
- Snapshots: `3200`
- Reviews: `147`
- Formal pool versions: `1`
- Active pool version: `catalog_pool_4839fefa58534e2988e5e2bb1d1ce959`
- Migration max: `018_catalog_refresh_baseline.sql`

The earlier expected value `017` was the pre-Day4 maximum. Day4 requires and applies migration `018_catalog_refresh_baseline.sql`.

## Day4 artifacts

- Campaign ID: `catalog_campaign_be0bb901472d4a6ca9bf05ca5e16eafa`
- Queue ID: `catalog_rpa_2561f6dba10747c5a1f9b8863fad3634`
- Excel: `backups/day4-company-to-home-20260826-182721/catalog-refresh-1000.xlsx`
- Excel QA: `backups/day4-company-to-home-20260826-182721/catalog-refresh-1000-qa.json`

The SQLite database is authoritative. The workbook is a handoff/report artifact only.

## Runtime stopped state

- Localhost port `37821`: no listener
- Catalog Queue: `completed`
- Extension Auto Runner: `IDLE`, stop reason `TARGET_GATE_REACHED`
- Yingdao Catalog workflow: completed; do not restart the old high-frequency click loop
- Production database showed no file or WAL changes during the final quiet-period check

## Tests

- `npm run check`: PASS
- `git diff --check`: PASS
- Day4 targeted tests: `23/23 PASS`
- Full suite: `172 PASS / 1 known failure`
- Known failure: `test/integration/market-report.test.mjs`
- Do not fix the Day8 Excel issue as part of Catalog Scale work.

## Home recovery steps

1. Fetch the branch from the transferred repository and check it out:
   `git fetch origin feat/catalog-3000-rpa`
   `git switch feat/catalog-3000-rpa`
2. Confirm the Day4 code commit is present:
   `git log -1 --oneline`
3. Copy the handoff backup `temu_research_v2.db` into the home checkout's `data/` directory only while all localhost/Node/Extension catalog writers are stopped.
4. Keep the previous home database as a recoverable archive; do not delete or overwrite it without making a copy.
5. Run `npm install` only if dependencies are missing, then run `npm run db:status` and `npm run check`.
6. Verify the copied database with `PRAGMA integrity_check` and confirm the core counts and active pool version listed above.
7. Load/reload the Catalog Browser Extension from this branch and reconnect it only to the manually verified healthy Temu Chrome profile.
8. Do not create a new Campaign or start Day5 until the home preflight confirms the Day4 Campaign, active pool, and checkpoint.

## Safety reminders

- Do not clear `products`, `product_snapshots`, `reviews`, or historical memberships.
- Product identity remains `platform + goods_id`.
- Historical URLs are evidence/fallback, not durable detail navigation.
- Electronics remain exclusion-audit only and never count toward the non-electronic target.
