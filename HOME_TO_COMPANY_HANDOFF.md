# Home To Company Handoff

Generated at: 2026-08-26 23:16 Asia/Shanghai

## Repository

- Repository: `LiYiXilyx/in-home-xuanpin`
- Branch: `feat/catalog-3000-rpa`
- Code checkpoint commit: `37064f1` (`feat: checkpoint Day9.8 review queue safety`)
- Checkpoint push: PASS, `origin/feat/catalog-3000-rpa` advanced from `b6f4d4c` to `37064f1`.
- The final documentation commit is the commit containing this file. After restoring at the company, use `git rev-parse HEAD` and compare it with `origin/feat/catalog-3000-rpa`.
- Local-only runtime files remain ignored and are not in Git: `data/`, `backups/`, `outputs/`, `logs/`, browser profiles, `config.json`, secrets, and `.tmp/`.

## Database backup

- Source database: `data/temu_research_v2.db`
- Consistent backup to take to the company: `backups/home-to-company-20260826-231630/temu_research_v2.db`
- Backup size: `88,563,712` bytes
- Backup SHA-256: `229A9AC59FE59BE1521FB800861F047BFC8AE7B17F2117D332D15DD8E81ADDE6`
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: no rows
- Source database timestamp remained `2026-08-26 14:55:44 UTC` while the backup and read-only audit were performed.
- Do not overwrite the company database directly. Back up the company copy first, copy this file to a new restore path, verify it, then switch the local `config.json` path.

## Database state

- Migration max: `018_catalog_refresh_baseline.sql`
- Products: `1669`
- Active memberships: `1000`
- Product snapshots: `3200`
- Reviews: `147`
- Pool versions: `1`
- Active pool version: `catalog_pool_4839fefa58534e2988e5e2bb1d1ce959`
- Active pool products: `1000`
- Active pool non-electronic unique products: `1000`
- Product Pool QA: PASS

## Current campaign and review queue

- Catalog campaign: `catalog_campaign_be0bb901472d4a6ca9bf05ca5e16eafa`
- Campaign name: `catalog-refresh-1000-20260826`
- Campaign status / QA: `completed / passed`
- Campaign result: `1000` non-electronic unique products
- Catalog expansion Day5-Day8 is paused by business decision. Do not create a 1500 campaign and do not modify the active Product Pool.
- Current Day9.8 Gate R1 review job: `job_d861384c0da7405db7b3d05c5afb7fee`
- Job status: `pending`; target: `5`
- Queue: `completed=1`, `pending=4`
- Completed item: `601102902096969`, stop reason `CUTOFF_REACHED`, `reviews_captured=0`, `pages=1`
- Cutoff date: `2026-07-27`
- Sample source: ignored local `recommended-review-sample-50.json` output; do not regenerate or rescore the sample.
- Do not advance to Gate R2. Finish and assess only Gate R1 5/5, then stop for approval.

## Current stage

Day9.8 Review Coverage Expansion, Gate R1 only. Business Screening, Fine Classification, Category Opportunity Analysis, and the fixed 50-product recommendation sample are complete. Catalog expansion is intentionally stopped. AI pain-point analysis, product-opportunity classification, 1688, and Day11 have not started and must remain stopped.

## Completed work in the checkpoint

- Added fixed-sample Gate R1 queue generation and reporting support.
- Added review navigation safety checks for `platform + goods_id`, fresh navigation, detail verification, manual gates, and anti-loop cooldown behavior.
- Added review queue checkpoint/resume/retry metadata and controller routes.
- Added extension safety/compact UI updates without changing the Product Pool.
- Corrected current-pool market-analysis repository/QA handling and tests.
- Added `.tmp/` to Git ignore rules.
- `npm run check`: PASS.
- Targeted review/navigation/sample/extension/market tests: `26 passed, 0 failed`.
- `git diff --check`: PASS (only Windows LF/CRLF conversion notices).

## Unfinished work and blockers

- The existing local Yingdao application `Temu Review Queue Day9.8 R1` is only a skeleton and its main flow is not yet populated/validated. Yingdao state is local to the home machine and is not carried by Git.
- On the company machine, restore or rebuild the existing Review Queue flow from `docs/YINGDAO_REVIEW_QUEUE_RUNBOOK.md`; do not invent a new collection architecture.
- A direct `ShadowBot.Shell.exe` launch once reported missing `MSVCR14X.dll`. The official top-level `ShadowBot.exe` launcher worked. Do not copy random DLLs; install/repair the supported Visual C++ runtime if the official launcher fails.
- No known code-test failure remains. The operational blocker is the unfinished Yingdao outer-navigation flow.

## Extension

- Name: `Temu Catalog 与评论采集`
- Manifest: V3
- Version: `0.3.0`
- Load unpacked from the company checkout's `browser-extension` directory and click Reload after pulling.
- Confirm the Catalog button and review capture button are visible on a verified Temu product page.
- Do not start Catalog Auto Runner, a real review batch, or any localhost write task during restore verification.

## Yingdao responsibility

Control mode for Review Queue operation: `yingdao_existing_chrome`.

Yingdao is responsible only for:

1. outer navigation;
2. exact `goods_id` search and product-card selection;
3. category / result confirmation and detail-page `goods_id` verification;
4. triggering the business Extension after verification;
5. stopping at CAPTCHA or manual gates and resuming only after an operator confirms recovery.

Yingdao must not read/write SQLite directly, restore `source_url -> direct detail-page` navigation, or run high-frequency `See more` / `Try again` loops.

## Chrome and local configuration

- Use the healthy existing daily Google Chrome/Profile, not ShadowBotBrowser.
- Required account context: signed-in Temu, Germany site, English, EUR.
- Keep the same healthy Profile across queue items; do not copy locked profile files while Chrome is running.
- Current home `config.json` is intentionally not committed. It currently has `catalog.targetCount=1500`, `browser.mode=external_cdp`, and debug endpoint/port `9223`; these are local historical Catalog settings and do not authorize a 1500 campaign.
- For Day9.8 Review Queue, follow the job/runbook control mode `yingdao_existing_chrome`. Preserve Review/Fresh Navigation semantics and migration 018.
- Recreate company-local paths in `config.json`; never copy secrets or retain a home/company-absolute legacy database path.

## Exact next task

Restore the existing Yingdao Review Queue outer-navigation flow on the company machine, validate it in the healthy existing Chrome/Profile without starting collection, then resume the four pending items of Gate R1. For each item, use fresh navigation, verify the destination `goods_id`, trigger Extension review capture, persist the real stop reason, and stop when Gate R1 reaches 5/5. Do not automatically continue to Gate R2 or the final 50.

## Company restore steps

1. Clone/fetch `https://github.com/LiYiXilyx/in-home-xuanpin.git` and check out `feat/catalog-3000-rpa`.
2. Run `git pull --ff-only` and confirm local HEAD equals `origin/feat/catalog-3000-rpa`.
3. Run `npm ci`, `npm run check`, and the targeted Day9.8 tests before any runtime task.
4. Back up the existing company database. Copy the handoff database into a new local restore path and verify its SHA-256, `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, core counts, migration, and active pool version.
5. Create a company-local ignored `config.json`. Do not copy secrets, browser profiles, or absolute home paths.
6. Load/reload Extension version `0.3.0` from the checked-out `browser-extension` directory and verify UI only.
7. Open the official Yingdao launcher, restore the Review Queue flow per the runbook, select the healthy existing Chrome/Profile, and keep all real collection stopped.
8. Confirm port `37821` has no listener and no Node/Extension/Yingdao writer is active before declaring restore PASS.
9. Only after the restore gate passes, start localhost intentionally and resume the four pending R1 items. Do not create a Catalog campaign or modify Product Pool tables.

## Files to take

- Git branch `origin/feat/catalog-3000-rpa` (source, tests, docs, Extension).
- `backups/home-to-company-20260826-231630/temu_research_v2.db` via a secure company-approved transfer channel.
- The ignored fixed sample JSON used by the R1 job, if it is not already available on the company machine; verify it belongs to pool `catalog_pool_4839fefa58534e2988e5e2bb1d1ce959` and do not regenerate it.
- Recreate `config.json` locally. Do not transfer browser profiles, secrets, logs, `.tmp/`, or runtime outputs as source control artifacts.

