# Catalog Scale Day5 — Expansion 1000 → 1500 Runbook

## Safety gate

- SQLite is authoritative.
- Expansion baseline authority is the active `catalog_pool_versions` row plus its `catalog_pool_version_items`.
- `catalog_memberships.active=1` is only a legacy fallback when no formal Pool Version exists.
- Record `baseline_source` as `ACTIVE_POOL_VERSION` or `LEGACY_ACTIVE_MEMBERSHIPS`.
- If a formal Pool exists and its intersection with active memberships is smaller than the Pool, stop with `CATALOG_BASELINE_INCONSISTENT`.
- The active 1000 Pool remains active until Expansion QA passes.
- Never clear products, snapshots, reviews, memberships, staging, or the Day4 Pool.
- Do not create a replacement Campaign after a session/listing failure; resume the existing Queue checkpoint.

## Architecture

- Yingdao: healthy Chrome, source navigation, Top Sales confirmation, CAPTCHA/manual recovery.
- Catalog Extension: card scan, scroll, See more/Try again, limited retry, batch and checkpoint.
- Node: Campaign, multi-source Queue, dedupe, electronic exclusion, materialization, QA and Pool activation.

## Start Day5 once

1. Confirm the formal baseline is exactly 1000 and run `baseline-check`.
2. Apply migrations `019_catalog_expansion_1500.sql` and `020_catalog_baseline_authority.sql`.
3. Start localhost 37821 with the production config.
4. Create exactly one Campaign:
   `node tools/catalog-expansion-admin.mjs create --target 1500 --baseline 1000`
5. Save the returned Campaign ID. Never rerun `create` for the same Day5 attempt.
6. Claim the first source:
   `node tools/catalog-expansion-admin.mjs claim --campaign <campaign_id>`

## Baseline recovery

1. Stop localhost, Yingdao and the Extension runner before replacing SQLite.
2. Back up the current `qa_failed` database with SQLite's consistent backup mechanism.
3. Restore the Day5 preflight backup and run migrations through 020.
4. Inspect authority:
   `node tools/catalog-expansion-admin.mjs baseline-check`
5. When the formal Pool is healthy but memberships are inconsistent, explicitly reconcile:
   `node tools/catalog-expansion-admin.mjs reconcile-memberships --confirm ACTIVE_POOL_VERSION`
6. Replay the preserved Day5 evidence into the same Campaign ID:
   `node tools/catalog-expansion-replay.mjs --source <qa_failed_backup> --campaign <campaign_id>`
7. Treat items already present in the formal Pool as overlap, never as net-new.

## Operate each source

1. Read the claimed source label/navigation hint.
2. Use Yingdao/manual operation to enter that source in the existing healthy Chrome profile.
3. Confirm Germany, English, EUR, Motorcycle context, real product cards and Top Sales.
4. Reload the unpacked Catalog Extension after code changes, then click `首次开始` or `恢复当前进度`.
5. When the source makes no further safe progress before the 1500 Gate, complete it as `SOURCE_EXHAUSTED`, then claim the next source.
6. CAPTCHA, Oops, zero cards, and unstable listing context must enter `manual_required`; they are never source exhaustion.
7. When the panel reaches 1500, complete the active source with `TARGET_GATE_REACHED`. Remaining pending sources are safely marked completed without collection.

## Finalize

Run in order:

1. `node tools/catalog-expansion-admin.mjs materialize --campaign <campaign_id>`
2. `node tools/catalog-expansion-admin.mjs qa --campaign <campaign_id>`
3. Confirm QA passed and the old 1000 Pool is still active.
4. `node tools/catalog-expansion-admin.mjs activate --campaign <campaign_id>`
5. Confirm the new 1500 Pool is active and the old 1000 Pool is superseded.
6. Generate `catalog-expansion-1500.xlsx` with the `excel` action.

The Day5 workbook navigation contract is:

- `当前观察链接` uses the latest URL captured from the current Temu product card first.
- `身份/历史链接` keeps the canonical `goods_id` URL as identity evidence only.
- A direct canonical URL showing sold out does not prove that the current product card is sold out.
- Product thumbnails are embedded in the workbook. Individual image download failures are recorded in the workbook QA JSON and do not rewrite Catalog availability state.

## Required final checks

- Active Pool and active memberships: 1500.
- Pool rows, distinct `goods_id`, and distinct `platform + goods_id`: all exactly 1500.
- Electronic products in active Pool: 0.
- New Day5 snapshots: exactly 500.
- Reviews unchanged.
- SQLite integrity: `ok`.
- Stop after 1500; do not begin 2000.
