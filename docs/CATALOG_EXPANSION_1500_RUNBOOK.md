# Catalog Scale Day5 — Expansion 1000 → 1500 Runbook

## Safety gate

- SQLite is authoritative.
- The active 1000 Pool remains active until Expansion QA passes.
- Never clear products, snapshots, reviews, memberships, staging, or the Day4 Pool.
- Do not create a replacement Campaign after a session/listing failure; resume the existing Queue checkpoint.

## Architecture

- Yingdao: healthy Chrome, source navigation, Top Sales confirmation, CAPTCHA/manual recovery.
- Catalog Extension: card scan, scroll, See more/Try again, limited retry, batch and checkpoint.
- Node: Campaign, multi-source Queue, dedupe, electronic exclusion, materialization, QA and Pool activation.

## Start Day5 once

1. Confirm the formal baseline is exactly 1000 and migration max is 018.
2. Apply migration `019_catalog_expansion_1500.sql`.
3. Start localhost 37821 with the production config.
4. Create exactly one Campaign:
   `node tools/catalog-expansion-admin.mjs create --target 1500 --baseline 1000`
5. Save the returned Campaign ID. Never rerun `create` for the same Day5 attempt.
6. Claim the first source:
   `node tools/catalog-expansion-admin.mjs claim --campaign <campaign_id>`

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

## Required final checks

- Active Pool and active memberships: 1500.
- Duplicate goods ID: 0.
- Electronic products in active Pool: 0.
- New Day5 snapshots: exactly 500.
- Reviews unchanged.
- SQLite integrity: `ok`.
- Stop after 1500; do not begin 2000.
