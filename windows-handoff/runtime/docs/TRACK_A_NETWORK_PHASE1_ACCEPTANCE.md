# Track A Phase 1 Acceptance Result

Acceptance timestamp: 2026-08-29 (Asia/Shanghai)
Verdict: **PASS**

## 1. Baseline

- Branch: `feat/catalog-3000-rpa`
- Start HEAD: `b060aa782cb7209f12f079f30892847bc8800113`
- SQLite integrity: `ok`; foreign-key violations: `0`
- Migration max: `024_sourcing_1688.sql`
- Products / memberships / active memberships / snapshots / reviews: `2371 / 2371 / 2135 / 4155 / 147`
- Active Pool: `catalog_pool_bdc90c9ae44740cea0e7a1b59476fd63` (`2135` items)
- Opportunity Snapshot: `opportunity_snapshot_7f5cf83a3b7b469f9f4a3f0d5ecbf972`, `awaiting_confirmation`, `5` candidates

## 2. Existing Architecture Reused

The existing endpoint matcher, passive fetch/XHR interceptor, bridge envelope and nonce checks, network cache, strict goods-id merger, DOM catalog parser/capture/runner, background service and manifest structure were reused. No module was structurally rewritten.

## 3. Parser Runtime Audit

Before this closure, the real localized `/api/poppy/v1/opt` path was:

```text
Temu response -> MAIN interceptor -> inline minimalPoppyProducts/sanitizeProduct
-> PRODUCTS message -> ISOLATED bridge -> inline normalizeProduct
-> cache -> strict goods_id merger
```

`catalog-network-parser.js` existed and its fixture tests passed, but the live bridge did not call it. Normalization was duplicated in the MAIN interceptor, bridge, and standalone parser. Other allowlisted endpoints remained diagnostic-only and were not promoted to formal product messages.

## 4. Changes

- `temu-network-interceptor.js`: MAIN now performs only bounded, scalar allowlist projection; fixed the candidate-sample reference.
- `catalog-network-parser.js`: added the validated `parseProductRecords` runtime entry point; tightened string and numeric validation.
- `catalog-network-bridge.js`: requires the shared parser before cache insertion and isolates parse failures.
- `catalog-network-cache.js`: added parse-success and merge-conflict counters.
- `catalog-product-merger.js`: counts strict goods-id conflicts while preserving DOM fallback.
- Network and manifest tests now exercise the actual runtime script order, parser delegation, failure isolation and diagnostics.

## 5. Parser Wiring

```text
Temu passive response
-> MAIN bounded scalar projection (localized /api/poppy/v1/opt only)
-> versioned/nonce-bound PRODUCTS message
-> ISOLATED bridge validation
-> exact endpoint validation
-> TemuCatalogNetworkParser.parseProductRecords
-> endpoint-specific normalization under parser limits
-> network cache
-> strict dom.goods_id === network.goods_id merger
```

## 6. Safety Boundaries

- Passive observation only; original fetch/XHR results are returned unchanged.
- No request or response mutation, no private API replay, and no credentials/storage access.
- Bridge payload limit: `64,000` bytes; chunk limit: `20`; response product limit: `50` in the observed extractor.
- Parser limits: depth `6`, array length `300`, visited objects `2500`; JSON/content-type and endpoint gates remain active.
- Parser errors are counted and rejected without throwing into the page/runner.
- `NETWORK_ONLY` records remain cache/diagnostic observations and are not submitted to Catalog batches or SQLite.

## 7. Observe-only Smoke

### Live Observe-only Evidence

Status: **FAIL**.

The user-opened controlled Chrome page was healthy and visibly satisfied Germany, English, EUR, Motorcycles & Powersports Accessories and `Sort by: Top sales`. It showed `40` unique real DOM goods. No navigation, scrolling, load-more action, campaign, batch submission or private API replay was performed.

| Required real metric | Result |
| --- | --- |
| page URL | `https://www.temu.com/de-en/motorcycles--accessories-o3-585.html?...` |
| locale / currency | `en` / `EUR (€)` |
| category / sort | Motorcycles & Powersports Accessories / Top sales |
| page health / behavior | healthy / normal |
| fetch count / XHR count | `0 / 143` |
| allowlist matched | `1` real XHR to `/de-en/api/poppy/v1/opt` |
| MAIN product messages / rows | `2 / 40` |
| ISOLATED product messages / rows | `2 / 40` |
| network responses intercepted | `0` |
| endpoint counts | `{}` |
| parse successes / errors | `0 / 2` |
| network unique goods / cache size | `0 / 0` |
| DOM unique goods | `40` |
| network enriched / network-only | `0 / 0` |
| merge conflicts | `0` |
| bridge reject | `goods_id`; schema rejects `2` |

The real response was HTTP 200 JSON (`322,058` bytes) and diagnostics identified `40` product records. Its first ten projected samples contained valid numeric `goods_id` values matching the current DOM goods, but both 20-row chunks failed the shared parser/bridge length gate. Therefore `network_responses_intercepted > 0` and `network_unique_goods > 0` were not met.

## 8. 10 Goods Enrichment Smoke

### 10 Goods Enrichment Evidence

Not run. The mandatory observe-only smoke failed, so the 10-real-goods enrichment stage was stopped before execution. No rows or network values were fabricated.

## 9. Provenance

### Provenance Summary

The current real-page preview contained ten `DOM` products and zero `NETWORK_ENRICHED` products because the network cache remained empty. Every displayed source URL and observed field provenance remained DOM-owned. Automated fixture coverage still proves the intended `NETWORK_ENRICHED` and strict DOM-fallback behavior, but real enrichment acceptance did not occur.

## 10. Diagnostics

### Diagnostics Summary

Runtime diagnostics now expose:

`network_responses_intercepted`, `network_endpoint_counts`, `network_parse_successes`, `network_parse_errors`, `network_unique_goods`, `network_cache_size`, `dom_unique_goods`, `network_enriched_goods`, `network_only_observed`, and `network_merge_conflicts`.

Automated tests cover success, parse failure, cache insertion/deduplication, network-only isolation, enrichment and merge conflict. The real run recorded two isolated parser failures and no cache insertion. Response count remains intentionally distinct from product count.

## 11. Review Regression

Review DOM loader, queue integration, navigation safety, coverage/sample gates, circuit breaker and manual CAPTCHA behavior passed in the focused regression. No formal Review Queue was created.

## 12. Track A Tests

- Focused Track A plus Review regression: `74 passed / 0 failed`.
- `npm run check`: PASS.
- `git diff --check`: PASS.

## 13. Full Test Suite

`FULL_SUITE_NOT_GREEN`: `228 passed / 7 failed` (235 total).

The seven failures are the pre-existing unrelated market-report wrapper, clear-Excel row-count expectation, and five image-cache/error-code/cache-status expectations. Track A tests passed inside the same full run.

Environment drift was observed and not changed:

- `sharp`: expected `0.35.3`, actual `0.35.4`
- `@oai/artifact-tool`: expected `2.8.48`, actual `2.8.52`

## 14. Data Integrity

| Metric | Before | After |
| --- | ---: | ---: |
| products | 2371 | 2371 |
| memberships | 2371 | 2371 |
| active memberships | 2135 | 2135 |
| snapshots | 4155 | 4155 |
| reviews | 147 | 147 |
| Active Pool ID | `catalog_pool_bdc90c9ae44740cea0e7a1b59476fd63` | unchanged |
| Active Pool count | 2135 | 2135 |
| Opportunity Snapshot | `opportunity_snapshot_7f5cf83a3b7b469f9f4a3f0d5ecbf972` | unchanged |
| Opportunity status / candidates | `awaiting_confirmation / 5` | unchanged |
| migration max | `024_sourcing_1688.sql` | unchanged |
| SQLite integrity / FK violations | `ok / 0` | `ok / 0` |

## 15. Git

- End HEAD: `b060aa782cb7209f12f079f30892847bc8800113`
- Changed scope: five network runtime files, two network/manifest test files, and this acceptance record.
- Commit: none, because the verdict is `FAIL`.
- Push: **NO**.

## 16. Remaining Gaps

1. Diagnose the real-schema parser/bridge length mismatch that rejected both valid-looking 20-row chunks as `goods_id` failures. This development was not authorized in the smoke-only continuation and was not attempted.
2. After a scoped fix and extension reload, repeat observe-only on the same healthy page.
3. Only if observe-only passes, export the 10-real-goods DOM/network/final/provenance table and re-run the data-integrity comparison.

## 17. Track A Phase 1 Verdict

**FAIL**

The healthy real page generated the expected passive response and 40 real product rows, but the shared parser rejected both chunks before cache insertion. Observe-only failed and the dependent 10-goods enrichment smoke was correctly not run.

## Root Cause

The real MAIN projection emitted `goods_id` as strings. The 40 visible live identities were all 15-character digit-only strings. The production database contains 2,371 non-null digit-only identities: 2,370 are 15 characters and one is 16 characters (`p50=15`, `p95=15`, min `15`, max `16`).

The rejecting layer was `catalog-network-bridge.js`: it required `normalized.length === products.length` and labeled every cardinality difference as `goods_id`. That was an all-or-nothing chunk contract, not a precise identity validation result. The previous diagnostics did not retain the rejected row index/type/length, so the specific dropped row could not be audited after the event. Tests missed this because fixtures contained only valid identities and generated chunking tests used short digit-only IDs; they did not cover the observed 40-ID set, the production 16-character boundary, over-bound IDs, or partial-row isolation.

## Identity Contract

| Layer | Type | Min | Max | Format | Hotfix result |
| --- | --- | ---: | ---: | --- | --- |
| MAIN projection | normalized string | 1 | 16 | digits only | canonical `goods_id`, exact string retained |
| Bridge | parser-owned | 1 | 16 | digits only | valid rows accepted; invalid rows isolated |
| Parser | string | 1 | 16 | digits only | shared endpoint contract |
| Cache key | string | 1 | 16 | digits only | shared endpoint contract |
| Merger | string equality | 1 | 16 | strict identity | unchanged |
| DB identity | TEXT | observed 15 | observed 16 | 2,371/2,371 digits only | schema unchanged |

No `Number`, `parseInt`, numeric coercion or leading-zero mutation is used for identity.

## Hotfix

- Added the shared bounded identity contract to `catalog-network-endpoints.js`, which is already loaded in both MAIN and ISOLATED worlds.
- MAIN now emits one canonical bounded `goods_id` string instead of independently forwarding `goods_id`/`goodsId` aliases.
- Parser exposes record analysis with safe invalid-row diagnostics.
- Bridge no longer rejects every valid row because one row is invalid; it caches the valid subset, counts the parse error and rejects the message only when no valid identity remains.
- Cache uses the shared identity contract and exposes the last safe parse diagnostic (`index`, type, length, digit-only flag, four-character prefix/suffix).
- The existing 64 KB bridge payload limit and 20-row chunking remain unchanged.

## Regression

- Added `test/fixtures/temu-live-goods-ids-sanitized.json` containing the 40 real visible goods IDs and no response secrets.
- Added coverage for exact 15/16-character preservation, leading-zero preservation, 17-character rejection, empty/null/non-digit rejection, safe partial-row isolation, cache insertion, and the real `20 + 20` message split.
- Focused Track A plus Review regression after hotfix: `78 passed / 0 failed`.
- `npm run check`: PASS.
- `git diff --check`: PASS.

## Live Observe-only Retry

The extension was manually reloaded and the existing healthy page was refreshed. The hotfix runtime was present at `document_start`: interceptor ready, nonce matched, new parse diagnostics available, and schema rejects were zero.

Two passive observations were recorded without changing category or sort:

| Retry | XHR | Fetch | Allowlist hit | Parser success/error | Cache |
| --- | ---: | ---: | ---: | --- | ---: |
| user refresh | 142 | 0 | 0 | 0 / 0 | 0 |
| same-URL normal reload | 54 | 0 | 0 | 0 / 0 | 0 |

Both pages remained healthy with Germany / English / EUR / Motorcycles & Powersports Accessories / Top sales and 40 DOM goods. Neither reload produced `/api/poppy/v1/opt`, so the retry cannot prove parser/cache success and cannot be marked PASS. No request was replayed and no private endpoint was called directly.

## 10 Goods Enrichment Retry

Not started. The live observe-only retry had no allowlisted product response and therefore did not pass its gate.

## Final Verdict

**MANUAL_REQUIRED**

The code hotfix and automated regression are complete, and the updated extension is installed. Final Track A PASS remains pending a naturally generated allowlisted product response, a successful live parser/cache observation, and its conditional 10-goods enrichment retry.

Business Gate remains `OPPORTUNITY_PRODUCT_CONFIRMATION`.

## Live Observe-only Final Retry

The user re-entered the category through normal Temu navigation. The final passive retry used the existing controlled Chrome and made no direct API call or request replay.

Page context passed: Germany, English, EUR, Motorcycles & Powersports Accessories, Top sales, healthy behavior, and `40` real DOM goods.

| Metric | Final retry |
| --- | --- |
| XHR / Fetch | `97 / 0` |
| allowlist hits | `1` |
| endpoint | `/de-en/api/poppy/v1/opt` |
| HTTP / JSON | `200 / yes` |
| raw response bytes | `321,677` |
| MAIN messages / rows | `2 / 40` |
| ISOLATED messages / rows | `2 / 40` |
| parser successes / errors | `0 / 2` |
| parser rejected rows | `40` |
| network responses / unique goods / cache | `0 / 0 / 0` |
| DOM unique / enriched / network-only | `40 / 0 / 0` |
| merge conflicts | `0` |

The new safe diagnostic showed the rejected values were `string`, length `15`, and digit-only. The parser-side shared identity contract nevertheless normalized every row to null (`normalized_count=0` for each 20-row chunk). Both messages were rejected as `goods_id`. This is not an allowed isolated bad row and the observe-only retry failed.

## 10 Goods Enrichment

Not run. Observe-only failed before cache insertion, so no real network record was available for a strict-goods-id merge. The ten-item preview remained DOM-only and no network values were fabricated.

## Provenance Evidence

- Sample goods available in DOM: `10`
- `NETWORK_ENRICHED`: `0`
- DOM-only: `10`
- Network field count: `0`
- Merge conflicts: `0`
- Network-only observed: `0`
- Formal transport observed: `DOM` only
- Source URL provenance: DOM

## Final Data Integrity

The final read-only database check remained identical to baseline: products `2371`, memberships `2371`, active memberships `2135`, snapshots `4155`, reviews `147`, Active Pool `catalog_pool_bdc90c9ae44740cea0e7a1b59476fd63` with `2135` items, Opportunity Snapshot `opportunity_snapshot_7f5cf83a3b7b469f9f4a3f0d5ecbf972` in `awaiting_confirmation` with `5` candidates, migration max `024_sourcing_1688.sql`, SQLite integrity `ok`, and zero foreign-key violations.

## Final Verdict

**FAIL**

The real network path reached MAIN and ISOLATED successfully, but the parser-side shared identity contract rejected all 40 valid-looking live identities. The 10-goods gate was not opened and no PASS commit was created.

## Runtime Identity Root Cause Hotfix 2

The live failure was reproduced locally without network access using the same real-format value `601099602102774`. It is a 15-character string containing only ASCII character codes `48` through `57`; both the digit regex and the bounded contract regex pass. The endpoint helper returns the exact original string.

The exact failure was the parser's optional global import:

```text
TemuCatalogNetworkEndpoints?.normalizeGoodsId?.(value) ?? null
```

When the parser runtime did not have the expected current helper, this expression silently mapped every identity to null. Loading the real parser in an isolated VM without that optional global reproduced the live result exactly: digit-only `true`, length `15`, normalizer result `null`. The prior bridge harness could not detect this because it loaded MAIN and ISOLATED scripts into one VM global, where the helper was always present.

Root cause classification: `WRONG_IMPORT`.

The parser now owns its runtime identity normalization instead of treating the validator as an optional global dependency. The contract remains trim + ASCII digits only + 1–16 characters + exact string preservation; it performs no numeric coercion and preserves leading zeroes. MAIN projection retains the matching bounded contract.

Static diagnostics now expose:

```text
NETWORK_RUNTIME_VERSION = track-a-runtime-v2
IDENTITY_CONTRACT_VERSION = track-a-id-v2
```

Both MAIN values received in the READY envelope and the ISOLATED parser values appear in the existing cache diagnostics, so the next live retry can prove both worlds loaded this hotfix.

Regression now creates separate MAIN and ISOLATED VM globals and sends the actual MAIN projected message through the actual bridge handler, parser runtime entry and cache. It proves 15-digit, 16-digit and leading-zero preservation; rejects 17-digit, empty, null and non-digit input; and sends the 40 sanitized live IDs as `20 + 20`, with 40 normalized, zero rejected and 40 cached.

No final live retry was run in this hotfix turn. Extension reload and a refresh of the existing Temu tab are required before the final observe-only retry. The intended unpacked directory is:

```text
C:\Users\Administrator\Documents\ChatGPT\选品上架-家里版本\temu选品\browser-extension
```

Chrome exposes the open extension detail tab and extension ID `fmdibncnfoakjkbpejbkphafkindligb` to the control session, but blocks programmatic access to `chrome://extensions`; the user-visible “Loaded from” filesystem field therefore requires confirmation during the manual reload.

## Final Runtime Version Proof

The user reloaded `Temu Catalog 与评论采集` from the confirmed repository directory and refreshed the existing Temu category page. The live diagnostics then reported:

| World | Network runtime | Identity contract |
| --- | --- | --- |
| MAIN | `track-a-runtime-v2` | `track-a-id-v2` |
| ISOLATED | `track-a-runtime-v2` | `track-a-id-v2` |

The interceptor was ready at `document_start`, its nonce matched across worlds, and there were no nonce, schema, payload or unknown-message rejects.

## Final Observe-only

The final attempt was passive: no direct API call, replay, request/response modification, Catalog Campaign, Catalog batch or formal database write was performed.

Page health passed with Germany (`Germany English` locale control and `/de-en/` URL), English, EUR, Motorcycles & Powersports Accessories, Top sales, 40 real DOM goods IDs, no `Try again` and no `Oops` state.

| Metric | Result |
| --- | ---: |
| XHR / Fetch | `71 / 0` |
| allowlist hits | `0` |
| allowlist endpoint | `null` |
| HTTP / JSON / response bytes | `null / null / null` |
| MAIN messages / rows | `0 / 0` |
| ISOLATED messages / rows | `0 / 0` |
| parser successes / errors | `0 / 0` |
| normalized / rejected rows | `0 / 0` |
| network responses / unique goods / cache | `0 / 0 / 0` |
| DOM unique / enriched / network-only | `40 / 0 / 0` |
| merge conflicts | `0` |

The observed requests were ordinary non-allowlisted page traffic. No natural `/de-en/api/poppy/v1/opt` response occurred during the final passive window, so the parser/cache acceptance gate did not open. This is absence of qualifying traffic, not a repeated identity rejection.

## Final 10 Goods Enrichment

Not run. Observe-only did not pass because there was no allowlisted response and no network cache record. The preview remained DOM-only; no network field was inferred or fabricated.

## Final Provenance

- Formal preview transport: `DOM` only
- Network-enriched goods: `0`
- Network-only observed: `0`
- Network-only formal promotion: `0`
- Source URL provenance: DOM
- Merge conflicts: `0`
- Accepted live network identity count: `0`; min/max length `null`; digit-only count `0`; invalid count `0`

## Final Data Integrity

The read-only database check remained identical to baseline: products `2371`, memberships `2371`, active memberships `2135`, snapshots `4155`, reviews `147`; active Pool `catalog_pool_bdc90c9ae44740cea0e7a1b59476fd63` remained active with declared/item count `2135 / 2135`; Opportunity `opportunity_snapshot_7f5cf83a3b7b469f9f4a3f0d5ecbf972` remained `awaiting_confirmation` with `5` candidates; migration max remained `024_sourcing_1688.sql`; SQLite integrity was `ok`; foreign-key violations were `0`.

## Final Verdict

**MANUAL_REQUIRED** — `NO_ALLOWLIST_TRAFFIC`

Runtime version and page health passed, and formal data remained unchanged. Track A Phase 1 cannot be declared PASS until a naturally generated allowlisted response proves live parser normalization, cache insertion and the conditional 10-goods enrichment gate.

## Final Conditional Retry With Allowlist Traffic

The user triggered a new product-list load through normal Temu page interaction. The extension observed two natural allowlisted XHR responses without direct API calls, replay, or request/response modification.

| Evidence | Result |
| --- | --- |
| Endpoint | `/de-en/api/poppy/v1/opt` |
| HTTP / JSON | `200 / yes` for both responses |
| Response bytes | `259,275` and `321,620` |
| Estimated product rows | `40 + 40` |
| MAIN messages / rows | `4 / 80` |
| ISOLATED messages / rows | `4 / 80` |
| Parser successes / errors | `0 / 0` |
| Normalized rows | `0` |
| Parser-invalid rows | `0` (no invalid-row diagnostic) |
| Bridge-rejected rows | `80` across four chunks |
| Bridge reject reason | `goods_id` |
| Network responses / unique goods / cache | `0 / 0 / 0` |
| DOM unique / enriched / network-only | `40 / 0 / 0` |

The current runtime remained correct in both worlds (`track-a-runtime-v2 / track-a-id-v2`). Safe candidate evidence sampled 20 identities from the two responses: all 20 were strings, length 15, ASCII digit-only, and within the 1–16 contract. The identity sample contained zero invalid values.

This differs from the previous live failure: the previous parser reported two errors and 40 invalid rows; runtime v2 reported no parser error and no invalid identity diagnostic, but the parser still returned zero normalized records, so the bridge rejected all four chunks and the cache remained empty. The required real parser/cache proof therefore failed.

The 10-goods enrichment smoke was not run because Observe-only did not pass. Existing preview products remained DOM-only, source URLs remained DOM provenance, and no network-only record entered a formal product.

The post-retry read-only database check remained identical to baseline: products `2371`, memberships `2371`, active memberships `2135`, snapshots `4155`, reviews `147`; active Pool `catalog_pool_bdc90c9ae44740cea0e7a1b59476fd63` remained active with `2135` items; Opportunity `opportunity_snapshot_7f5cf83a3b7b469f9f4a3f0d5ecbf972` remained `awaiting_confirmation` with `5` candidates; migration max `024_sourcing_1688.sql`; SQLite integrity `ok`; foreign-key violations `0`.

Final conditional verdict remains **MANUAL_REQUIRED**. Allowlist traffic is now proven, but the live parser/cache and 10-goods gates are not satisfied. No automatic hotfix was attempted.

## Parser Endpoint Gate Root Cause Hotfix 3

The `80 input / 0 records / 0 invalid identities` live shape was traced to the parser stage before product collection. The actual order was bridge envelope/schema validation, bridge exact endpoint normalization, `parser.analyzeProductRecords`, parser endpoint gate, product collection, identity analysis, then cache.

MAIN sends `payload.endpoint` as the string `/api/poppy/v1/opt`, produced by `normalizeTemuApiPath(new URL(responseURL).pathname)`. The bridge normalizes that value to `/api/poppy/v1/opt` and accepts it before calling the parser. The parser then performed a second gate through an optional ISOLATED global helper.

Local reproduction used the real category base URL, the exact payload endpoint and 20 live-format rows:

| Runtime condition | Endpoint allowed | Records | Invalid identities |
| --- | --- | ---: | ---: |
| endpoint helper loaded | `true` | 20 | 0 |
| endpoint helper unavailable | `false` | 0 | 0 |

The second condition exactly reproduces the live zero-record/zero-invalid combination. Because bridge-accepted representations (`/api/poppy/v1/opt`, localized paths, same-host absolute URLs, safe query/trailing-slash forms) all pass the current helper when it is callable, the live early return identifies the optional ISOLATED endpoint-helper dependency as the failing gate. The goods identity contract was not changed.

The previous 81-test regression missed this because the separate-world harness still explicitly loaded `catalog-network-endpoints.js` in ISOLATED before the parser, while the only test that omitted the helper called `normalizeGoodsId` directly and never exercised `bridge → analyzeProductRecords → endpoint gate`. Its base URL was also a fixed `/de-en/` root instead of the real category URL.

The minimal fix keeps the bridge's exact endpoint gate authoritative for bridge-delivered product messages. The bridge passes its already-normalized canonical endpoint into the parser; the parser accepts that proof only when both values normalize exactly to `/api/poppy/v1/opt`. Standalone parser calls still require the endpoint helper and fail closed when it is unavailable. The allowlist was not expanded.

Parser diagnostics now distinguish:

- `endpoint_gate / endpoint_rejected`;
- `product_collection / collection_empty`;
- `identity_normalization / identity_rejected`;
- `complete / ok`.

The existing network diagnostics safely expose endpoint raw path with query values redacted, endpoint type, query-free base path, normalized endpoint, allowed/helper flags, validation source, collection-attempted flag, records count and invalid-identity count. The marker is `track-a-parser-endpoint-v3`.

Browser-accurate regression continues to use separate MAIN and ISOLATED VM globals and manifest script order. It also reproduces the live missing-helper condition without bypassing the bridge. The projected bridge chain accepts one row, 20 rows, and 80 rows across four messages with zero parser errors; all 80 observations reach cache insertion. No live page refresh or retry was performed for this hotfix.

## Live Parser Endpoint Gate Evidence

The extension was reloaded and the healthy category page was refreshed before the operator naturally retriggered the product list. No direct API call, replay, request/response modification, Catalog Campaign, or SQLite write was performed.

| Evidence | Final live result |
| --- | --- |
| Page | Germany / English / EUR / Motorcycles & Powersports Accessories / Top sales / healthy |
| DOM goods | `40` |
| Transport totals | XHR `163`; Fetch `0` |
| Natural allowlist hits | `1` |
| Endpoint | `/de-en/api/poppy/v1/opt` → `/api/poppy/v1/opt` |
| HTTP / JSON / response bytes | `200 / yes / 321,955` |
| MAIN messages / rows | `2 / 40` |
| ISOLATED messages / rows | `2 / 40` |
| Parser stage | `complete / ok` |
| Endpoint allowed / validation | `true / bridge` |
| Endpoint helper available | `false` (the fixed live condition) |
| Last chunk records / invalid | `20 / 0` |
| Total records | `40` |
| Parser successes / errors | `2 / 0` |
| Bridge rejected rows | `0` |
| Cache insert attempts / inserted / deduped | `40 / 40 / 0` |
| Unique / cache / enriched / network-only | `40 / 40 / 40 / 0` |
| Merge conflicts | `0` |

Runtime proof was exact in both worlds: MAIN and ISOLATED reported `track-a-runtime-v2 / track-a-id-v2`; the parser marker was `track-a-parser-endpoint-v3`. The prior `records=0, invalid=0, cache=0` failure is closed by real traffic while the optional ISOLATED endpoint helper remains unavailable: the bridge proof admitted the exact endpoint, collection completed, and both 20-row chunks entered cache.

## Observe-only PASS

**PASS.** Natural allowlist traffic was observed, the parser completed with records, the cache was populated, parser errors remained zero, and page behavior remained normal.

## 10 Goods Enrichment

All ten sampled IDs existed in the current DOM and were strictly equal to the corresponding cache identity. The candidate diagnostic uses the same MAIN `projectProduct` function as the cache payload: its real samples contained `title` and image only, so missing network price, sales, rating, and review-count values are recorded as `null`, not inferred. `Final` is the actual merged preview.

| goods_id | Field | DOM | Network | Final | Provenance |
| --- | --- | --- | --- | --- | --- |
| `601099602102774` | title | `icon` | `Y10 Hard Wheat Motorcycle Helmet Headset` | `Y10 Hard Wheat Motorcycle Helmet Headset` | network |
|  | price / sales / rating / reviews | `10.47 / 77000 / 4.7 / 3979` | `null / null / null / null` | `10.47 / 77000 / 4.7 / 3979` | dom / dom / dom / dom |
| `601099514149132` | title | `item picture 210d oxford fabric motorcycle cover universal fit durable all weather weather non slip motorcycle cover for models` | `210D Oxford Fabric Motorcycle Cover, Universal Fit, Durable Outdoor Protection, All-Weather Weather Resistance, Non-Slip Motorcycle Cover for Various Models` | same as Network | network |
|  | price / sales / rating / reviews | `8.8 / 76000 / 4.7 / 7551` | `null / null / null / null` | `8.8 / 76000 / 4.7 / 7551` | dom / dom / dom / dom |
| `601102992953649` | title | `item picture motorcycle bike electric car cover rainproof dustproof uv and snowproof protective cover black motorcycle additions universal motorcycle and bike storage cover tear resistant design easy to clean` | `Motorcycle/Bike Electric Car Cover - Rainproof, Dustproof, UV And Snowproof Protective Cover, Black Motorcycle Additions, All-Season Universal Motorcycle And Bike Storage Cover, Outdoor Protection, Tear-Resistant Design, Easy to Clean` | same as Network | network |
|  | price / sales / rating / reviews | `5.42 / 67000 / 4.5 / 3137` | `null / null / null / null` | `5.42 / 67000 / 4.5 / 3137` | dom / dom / dom / dom |
| `601101179368252` | title | `item picture high quality oxford motorcycle weather protection suitable for vehicle models safe motorcycle storage reflective safety function uv resistant cover motorcycle cover` | `High quality Oxford motorcycle cover- all-weather protection, suitable for various vehicle models, durable, black, safe motorcycle storage| reflective safety function| UV resistant cover, motorcycle cover` | same as Network | network |
|  | price / sales / rating / reviews | `11.94 / 52000 / 4.6 / 5361` | `null / null / null / null` | `11.94 / 52000 / 4.6 / 5361` | dom / dom / dom / dom |
| `601101125571790` | title | `item picture 1pc heavy duty 210d oxford fabric motorcycle cover anti theft with reflective strips design weather applicable` | `1pc Heavy-Duty 210D Oxford Fabric Motorcycle Cover | Anti-Theft with Reflective Strips, Keyhole Design, Weather Protection for All Seasons, Universally Applicable` | same as Network | network |
|  | price / sales / rating / reviews | `11.31 / 51000 / 4.7 / 4157` | `null / null / null / null` | `11.31 / 51000 / 4.7 / 4157` | dom / dom / dom / dom |
| `601101051972183` | title | `item picture universal fuel cap strap durable stain resistant plastic gas lid tie for all vehicles` | `Universal Fuel Cap Strap - Durable Stain-Resistant Plastic Gas Lid Tie for All Vehicles` | same as Network | network |
|  | price / sales / rating / reviews | `1.03 / 40000 / 4.6 / 4251` | `null / null / null / null` | `1.03 / 40000 / 4.6 / 4251` | dom / dom / dom / dom |
| `601101752583192` | title | `item picture 1 2pcs heavy duty abs material anti theft lock with multi color options suitable for bicycles and motorcycles lightweight and portable providing for your` | `1-2pcs Heavy-Duty ABS Material Anti-Theft Lock with Multi-Color Options, Suitable for Bicycles And Motorcycles, Lightweight And Portable, Providing Strong Protection for Your Valuables` | same as Network | network |
|  | price / sales / rating / reviews | `7.97 / 40000 / 4.6 / 3812` | `null / null / null / null` | `7.97 / 40000 / 4.6 / 3812` | dom / dom / dom / dom |
| `601099523219339` | title | `item picture motorcycle back seat bag pu leather tail pack waterproof motorbike side bag retro mini universal roll bag` | `Motorcycle Back Seat Bag PU Leather Tail Pack Waterproof Motorbike Side Bag Retro Tactical Mini Universal Roll Bag` | same as Network | network |
|  | price / sales / rating / reviews | `6.5 / 37000 / 4.7 / 1717` | `null / null / null / null` | `6.5 / 37000 / 4.7 / 1717` | dom / dom / dom / dom |
| `601101443795535` | title | `item picture 2pcs set of motorcycle handlebar covers motorcycle decorative additions motorcycle bicycle brake lever covers handlebar rubber modification covers brake handlebar covers clutch handlebar rubber covers` | `2pcs Set of Motorcycle Handlebar Covers, Motorcycle Decorative Additions, Motorcycle Bicycle Brake Lever Covers, Handlebar Rubber Modification Covers, Brake Handlebar Covers, Clutch Handlebar Rubber Covers` | same as Network | network |
|  | price / sales / rating / reviews | `1.18 / 34000 / 4.6 / 1653` | `null / null / null / null` | `1.18 / 34000 / 4.6 / 1653` | dom / dom / dom / dom |
| `601099527011263` | title | `item picture bike kickstand adjustable strong aluminum alloy bicycle kickstand for 24 29 inch bikes` | `Bike Kickstand, Adjustable Strong Aluminum Alloy Bicycle Kickstand for 60.96-73.66 cm Bikes` | same as Network | network |
|  | price / sales / rating / reviews | `5.31 / 33000 / 4.7 / 3230` | `null / null / null / null` | `5.31 / 33000 / 4.7 / 3230` | dom / dom / dom / dom |

For all ten products, `source_url` is the current Temu DOM product URL with provenance `dom`; `capture_transport` is `NETWORK_ENRICHED`; endpoint is `/api/poppy/v1/opt`.

## Provenance

Strict identity equality was satisfied for all ten samples. Network titles safely replaced weak DOM labels; missing network numeric fields did not overwrite healthy DOM values. Source URLs remained DOM provenance. Formal transports were `NETWORK_ENRICHED` only for this sample; no `NETWORK_ONLY` observation entered a formal product, Catalog batch, Pool, Opportunity, or SQLite.

## Data Integrity

The final read-only database result exactly matched baseline: products `2371`, memberships `2371`, active memberships `2135`, snapshots `4155`, and reviews `147`. Active Pool `catalog_pool_bdc90c9ae44740cea0e7a1b59476fd63` remained `active` with declared/item count `2135 / 2135`. Opportunity Snapshot `opportunity_snapshot_7f5cf83a3b7b469f9f4a3f0d5ecbf972` remained `awaiting_confirmation` with `5` candidates. Migration max remained `024_sourcing_1688.sql`; SQLite integrity was `ok`; foreign-key violations were `0`.

## Final Verdict

**PASS.** Observe-only, real parser/cache, 10-goods enrichment, 86/86 Track A + Review regression, project checks, and formal-data integrity all passed. Track A Phase 1 is closed. Business work remains gated at `OPPORTUNITY_PRODUCT_CONFIRMATION`; Track B and Track C were not started.
