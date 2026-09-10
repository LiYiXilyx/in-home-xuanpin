# Catalog 2000 Full Refresh Runbook

## Scope

This runbook refreshes 2,000 unique Temu Top Sales goods from the fixed `Profile 10 / Temu1店` operating profile. Product identity is always `platform + goods_id`. Existing products receive a new snapshot; only genuinely unknown identities create a product row. Historical snapshots are immutable.

This workflow does not recompute Opportunity, modify Review or 1688 data, or activate a Pool Version. A successful run produces a pool-switch recommendation only.

## Browser contract

- Mode: `FULL_REFRESH_EXTENSION_AUTO`
- Profile: `Profile 10 / Temu1店`
- Extension and `http://127.0.0.1:37821` are required.
- CDP is not required for this default Chrome User Data profile.
- Automatic navigation and sort switching are forbidden.
- The operator first opens a healthy Germany / English / EUR `Motorcycles & Powersports Accessories` page sorted by `Top sales`.
- The existing extension runner may scroll and click visible `See more`, `Load more`, or `Show more` controls.
- CAPTCHA, login, `Try again`, Oops, wrong category, wrong sort, wrong locale/currency, empty cards, and connection errors pause with `MANUAL_REQUIRED`. The runner never clicks `Try again` or bypasses verification.

## Full Refresh semantics

The progress gate is `refreshed_unique`, backed by unique `catalog_staging_products(campaign_id, platform, goods_id)` rows that passed electronic screening. Baseline overlap is counted as `existing_refreshed`; non-baseline identities are counted separately as `new_products`.

At the target, no additional eligible identity is accepted into the Campaign. Materialization reuses an existing `products(platform, external_product_id)` row, inserts a new `product_snapshots` row for every accepted identity, and creates a product only when that identity does not exist. Active memberships and the active Pool Version are not switched.

## Sales evidence

Every accepted Full Refresh card must contain:

- `raw_sales_text`
- `parsed_sales_count`
- `final_sales_count`
- `sales_provenance`

Compact values are parsed deterministically (`K`, `M`, `B`, `+`, decimal comma/point, and grouped separators). Examples: `77K+ = 77000`, `7.7K+ = 7700`, `1.2K+ = 1200`.

The report compares the latest snapshot preceding this Campaign with the new snapshot and retains old/new values, delta, ratio, field classifications, and a deterministic sales quality flag. A current K/M/B observation at least 100 times a smaller historical value, with matching raw and parsed evidence, is `LIKELY_OLD_PARSE_ERROR`. Historical rows are never rewritten.

## Commands

Create the mandatory smoke Campaign:

```bash
npm run catalog:full-refresh -- create-smoke
```

Inspect progress:

```bash
npm run catalog:full-refresh -- status --campaign <campaign_id>
```

After exactly 50 refreshed unique goods, record a 20-row visible-sales sample, complete the source, materialize, and run strict QA:

```bash
npm run catalog:full-refresh -- record-sales-sample --campaign <campaign_id> --sample <json_path>
npm run catalog:full-refresh -- complete-source --campaign <campaign_id>
npm run catalog:full-refresh -- materialize --campaign <campaign_id>
npm run catalog:full-refresh -- qa --campaign <campaign_id>
```

The sample is a JSON array of exactly 20 unique rows:

```json
[{"goods_id":"123","visible_sales_text":"77K+ sold","parsed_sales_count":77000,"pass":true}]
```

Only after `FULL_REFRESH_50` completes with strict QA may the 2,000 Campaign be created:

```bash
npm run catalog:full-refresh -- create-full
```

## QA gates

Smoke requires exactly 50 refreshed identities, zero duplicate identities, raw and parsed sales evidence for all 50, a 20/20 visible-sales sample, one new snapshot per accepted identity, exact product/membership deltas reported by materialization, unchanged active membership count and Active Pool, unchanged Reviews, frozen Opportunity snapshot/candidates/confirmation decisions, unchanged migration max, SQLite integrity `ok`, and zero foreign-key violations.

The 2,000 run uses the same gates and additionally produces full old/new field comparison, sales-change summaries, largest absolute and ratio changes, and the historical sales correction report. Pool activation remains a separate human-approved phase.

## Recovery

Runner state, round, target, counters, and manual gate are persisted in the RPA queue checkpoint. After Chrome or server restart, reload the extension on the same fixed profile and use `恢复当前进度`. Accepted `platform + goods_id` identities remain deduplicated in Campaign staging.
