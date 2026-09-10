# Stale Claim Recovery + Manual Bind Browser UX V1 Verification

## Delivery

- Design: `docs/superpowers/specs/2026-09-02-stale-claim-browser-ux-v1-design.md`
- Plan: `docs/superpowers/plans/2026-09-02-stale-claim-browser-ux-v1.md`
- Feature verifier: `14/14 PASS`
- Related regression: `19/19 PASS`
- Full suite: `695 total / 686 pass / 7 known baseline failures / 2 skip`
- New failures: `0`

The seven failures are the approved baseline set: two Excel cleanup/reset HTTP status assertions in
`test/integration/server-jobs.test.mjs`, one image signature assertion in
`test/unit/catalog-parser.test.mjs`, and four image-cache assertions in
`test/unit/image-cache.test.mjs`.

## Production Inspection And Recovery

The Dashboard was restarted from the stable runtime before production inspection. Both authorized
Motorcycle claims passed two immutable inspections separated by at least 10 seconds. The final
transactional recheck returned `STALE_CONFIRMED` with no live worker, binding, capture, QA,
activation, Excel export, or source runner.

| Campaign | First inspection | Second inspection | Result |
| --- | --- | --- | --- |
| `catalog_campaign_6e86fd902ac244e08eade55975e8b9ac` | `catalog_claim_inspection_30d9a42abddd41a7b7d69c12a274e240` | `catalog_claim_inspection_59016b5a7c8f4fdf9330062c4813888e` | cancelled atomically |
| `catalog_campaign_4ea0bfffab774610b3bdc67b6c61e276` | `catalog_claim_inspection_d90cb8f2d5754694b04d6018e0609e0b` | `catalog_claim_inspection_e190200f8c89430ba7a01a1f7eea6e8a` | cancelled atomically |

Both queues and sources are `cancelled`, both open source runs are finished, and two append-only
termination audits use `STALE_CLAIM_ENDED_BY_OPERATOR`.

Protected production counts were unchanged by recovery: products `2372`, memberships `2372`, pool
versions `3`, pool items `4635`, snapshots `4205`, and one Motorcycle active pool.

## girls-sets Initial Campaign

- Profile: `operator-girls-sets-v1-bf7cb4caf08d`
- Campaign: `catalog_campaign_37e57e89cdaf4408b9c6fff761afcca6`
- Name: `采集童装`
- Quantity mode: `OPEN_ENDED`
- Public target / remaining / target reached: `null`
- Baseline / current unique: `0 / 0`
- Binding: `UNBOUND`
- QA: `NOT_RUN`

An idempotent replay returned the same Campaign and the database contains exactly one girls-sets
Campaign. No page detection, binding, capture, QA, or pool activation was performed.

## UI Acceptance

The Operator page renders Catalog and YingDao together. Manual Bind explicitly states that CDP is
not required, shows the six-step manual workflow, and keeps Legacy CDP under
`旧版 / 高级浏览器连接`. The current Campaign is excluded from the historical claim-conflict panel,
while the backend continues to expose the complete active-claim inspection contract.

