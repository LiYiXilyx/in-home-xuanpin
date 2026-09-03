# Temu Market Evidence MVP V1 Design

## 1. Purpose and Scope

Temu Market Evidence MVP V1 adds an operator-controlled price-evidence workflow to the existing sourcing Review page. It does not automate Temu. The operator opens Temu, searches, binds the page, captures BEFORE evidence, manually clicks See more, captures AFTER evidence, chooses a Temu reference price, enters a 1688 price, saves a price assessment, and explicitly moves to the next Review goods.

The feature owns evidence sessions, safe screenshots, passive DOM snapshots, manual price assessments, and the Review UI integration. It does not change Catalog campaigns, pools, memberships, candidate ledgers, Initial QA/Activation, Random5 generation, image caches, or the frozen Initial Candidate Snapshot + Image Cache V1.

## 2. Frozen Contract Audit

```text
FROZEN_FEATURE_CONTRACT_IMPACT = NONE
SHARED_FIELDS_TOUCHED = []
FROZEN_FEATURE_FILES_EXPECTED_TO_CHANGE = []
SAFE_TO_IMPLEMENT_NEW_FEATURE = YES
```

The new feature must not read or write `candidate_revision`, `catalog_initial_pool_candidate_state`, `catalog_initial_pool_candidate_items`, `activation_payload_json`, `row_hash`, or `first_seen_sequence`. It uses the sourcing database and existing Review identities only. Any implementation discovery that requires changing those meanings is a blocking design conflict.

## 3. Considered Approaches

### Chosen: explicit bind token plus extension capture

The Review UI creates a session and shows a one-time bind token. The operator pastes that token into the extension on the manually opened Temu search page. The server exchanges it for the exact session identity; the extension retains the resulting binding for that tab. This keeps ownership explicit and avoids “latest session” inference.

### Rejected: server-selected latest session

This is simpler but violates the ownership contract and can attach evidence to the wrong Review goods after navigation or multiple windows.

### Rejected: automated opening/searching through CDP

This violates the manual-search safety contract and introduces unnecessary bot and account risk.

## 4. Ownership and Session Lifecycle

Every session is owned by:

```text
review_run_id + anchor_temu_goods_id + explicit session_id
```

All writes also require `expected_revision`. A goods identity may have multiple historical sessions, but at most one non-terminal writable session exists for each `review_run_id + anchor_temu_goods_id`. Creating another while one is writable returns `EVIDENCE_SESSION_ALREADY_WRITABLE` with HTTP 409 and zero writes.

Lifecycle:

```text
CREATED → BOUND → BEFORE_CAPTURED → AFTER_CAPTURED → ASSESSED → CLOSED
```

Phases cannot be skipped or overwritten. Re-capture requires explicitly closing the old session and creating a new one. Switching the Review UI to another goods makes the old session read-only. It becomes writable again only when run, goods, session, bound tab identity, query, status, and revision all still match. Mismatch returns `EVIDENCE_SESSION_CONTEXT_MISMATCH`, HTTP 409, zero writes.

`session_id` is random and non-secret. `bind_token` is random, one-time, expires after 15 minutes, is stored hashed, and only binds its own session. It grants no access to another session.

## 5. Additive Sourcing Database Model

Migration `db/sourcing-migrations/005_temu_market_evidence_mvp_v1.sql` adds:

### `temu_market_evidence_sessions`

- `session_id` primary key
- `review_run_id`, `anchor_temu_goods_id` foreign key to the Review item
- `query`, `status`, `revision`
- hashed bind token and expiry/consumption timestamps
- bound tab identity hash, initial page URL/context hash
- timestamps and explicit close reason
- partial unique index allowing one writable session per run/goods

### `temu_market_evidence_phases`

- `session_id`, `phase` (`BEFORE` or `AFTER`) unique
- `status` (`CREATING` or `SEALED`)
- page URL, query, tab identity hash, DOM schema version
- screenshot relative path, size, dimensions, MIME, SHA-256
- deterministic DOM snapshot hash, card count, captured timestamp
- immutable JSON payload containing only approved product-card fields

Only SEALED phases are readable. A phase write validates and stages the screenshot, then inserts metadata and DOM payload in one SQLite transaction. The final file rename occurs within the controlled critical section. Any caught failure rolls back the transaction and removes both temporary and newly created final files. Startup cleanup may remove orphan temporary files but never promotes them.

### `temu_manual_price_assessments`

- immutable assessment id and session identity
- optimistic session revision
- selected evidence phase and selected DOM card identity, or explicit manual Temu input
- Temu listed price EUR, pack quantity, unit price EUR
- optional Random5 supplier product id
- manually confirmed 1688 listed price CNY, pack quantity, MOQ, unit prices
- frozen FX identity/rate/source/as-of
- calculated price ratio, formula version, operator timestamp

Assessments are append-only revisions. The currently effective assessment is the latest valid revision for the explicit session. MOQ is stored independently and never used as pack quantity.

## 6. Passive DOM Evidence Contract

The content script reads only already-loaded DOM. It performs no fetch, XHR, image download, navigation, scroll, search, or See more click. Each approved card may store:

```text
goods_id, title, display_price_text, price_eur, currency,
product_url, image_url, sales_text, rating_text, position, captured_at
```

It never stores cookies, tokens, headers, account information, cart/order data, full HTML, or unrelated DOM text. Payload order is deterministic by visible position then goods id. BEFORE/AFTER delta is computed server-side as added, retained, and removed goods identities.

The bound page must be a Temu search-results page. Query, hostname, tab identity, and normalized search context must remain equal across BOUND, BEFORE, and AFTER. A changed page invalidates the write until the operator explicitly rebinds the same session under valid state.

## 7. Safe Screenshot Contract

The content script locates a product-results safety region that excludes the header/account/avatar/cart/order/navigation area and the extension overlay. The overlay is hidden before capture and restored in `finally`. The background service worker captures the visible tab only after explicit operator action; the content script crops the image locally to the validated intersection of the results region and viewport.

The crop validator requires positive dimensions, minimum useful area, no overlap with forbidden header selectors/rectangles, and correspondence with the DOM cards being serialized. It never falls back to the full viewport. Failure returns `SAFE_SCREENSHOT_REGION_NOT_FOUND`; screenshot plus DOM phase remains entirely unwritten.

Each session permits at most one BEFORE and one AFTER screenshot. Files live outside the Git worktree under the configured sourcing data root:

```text
<sourcing-data-root>/market-evidence/<run>/<goods>/<session>/<phase>.png
```

Frontend paths are never accepted. The server derives all paths and rejects traversal. Review pages serve screenshot bytes through strict run/goods/session/phase GET routes; they never embed remote Temu images automatically.

## 8. Extension and Binding Contract

New evidence messages use their own namespace and routes. The extension panel accepts an explicit bind token, calls the local server, and receives session/run/goods/query/revision. It binds only the active Temu tab and records a stable tab identity generated from extension installation id plus tab id and navigation generation; raw tab ids are not business ownership.

Every capture submits:

- run id, goods id, session id, expected revision
- tab identity and normalized query/page context
- phase
- cropped PNG payload and metadata
- approved structured card array

The server revalidates all identity and lifecycle fields. Extension state alone is never trusted. Navigating or changing query invalidates binding locally and is independently rejected by the server.

## 9. Manual Price Calculator

Inputs and formulas:

```text
temu_unit_price_eur = temu_price_eur / temu_pack_quantity
supplier_unit_price_cny = supplier_price_cny / supplier_pack_quantity
supplier_unit_price_eur = supplier_unit_price_cny / fx_cny_per_eur
price_ratio = temu_unit_price_eur / supplier_unit_price_eur
```

All monetary and quantity inputs must be finite and positive. MOQ may be zero/null according to source availability but is never substituted for supplier pack quantity. FX is resolved from the existing versioned sourcing configuration and frozen into the assessment. Missing/stale-invalid FX blocks saving with `FX_RATE_REQUIRED`; live calculator display may show incomplete status.

The UI label is strictly `价格倍率`; it must not claim profit, margin, ROI, or net return. Random5 “带入倍率计算器” imports only supplier identity and currently displayed price fields into editable calculator inputs. The operator must still confirm before saving.

## 10. Review UI Integration

The existing `/sourcing-review.html` gains a `Temu人工搜索比价 MVP` section in the middle panel. It contains:

- editable query and deterministic local suggestion
- create session and copy bind token
- explicit session/status/revision display
- BEFORE/AFTER evidence controls and status
- screenshot previews served locally
- structured results and BEFORE/AFTER delta
- Temu price reference selection plus manual override
- Random5 import button
- manual 1688 price, pack quantity, MOQ, FX and dynamic ratio
- save assessment and save-and-next

The Review client always sends its current `run_id` and goods id. When goods changes, it cancels stale UI requests and renders old sessions read-only. `save and next` saves exactly one assessment, then selects the next Review goods and stops. It never opens Temu, searches, or creates a new evidence session automatically.

## 11. API Contract

All routes remain under `/api/sourcing/review/`:

- `POST /goods/:goods_id/evidence-sessions`
- `GET /goods/:goods_id/evidence-sessions`
- `GET /goods/:goods_id/evidence-sessions/:session_id`
- `POST /goods/:goods_id/evidence-sessions/:session_id/close`
- `POST /evidence-sessions/bind-token/consume` (extension CORS, explicit token)
- `POST /goods/:goods_id/evidence-sessions/:session_id/rebind`
- `POST /goods/:goods_id/evidence-sessions/:session_id/phases/:phase`
- `GET /goods/:goods_id/evidence-sessions/:session_id/phases/:phase/screenshot`
- `POST /goods/:goods_id/evidence-sessions/:session_id/assessments`

Mutations require local origin or approved extension origin as appropriate, explicit identities, request id for retry idempotency, and expected revision. Unsupported verbs return 404/405 through existing router behavior. Maximum JSON/image payload size is explicit; PNG signature, dimensions, size, SHA-256, and safe-region metadata are verified server-side.

## 12. Error and Recovery Semantics

Primary errors include:

- `EVIDENCE_SESSION_ALREADY_WRITABLE` (409)
- `EVIDENCE_SESSION_CONTEXT_MISMATCH` (409)
- `EVIDENCE_SESSION_REVISION_CONFLICT` (409)
- `EVIDENCE_SESSION_PHASE_ORDER_INVALID` (409)
- `EVIDENCE_SESSION_PHASE_ALREADY_SEALED` (409)
- `EVIDENCE_BIND_TOKEN_INVALID` (404/409)
- `EVIDENCE_BIND_TOKEN_EXPIRED` (409)
- `SAFE_SCREENSHOT_REGION_NOT_FOUND` (422)
- `EVIDENCE_SCREENSHOT_INVALID` (422)
- `EVIDENCE_DOM_SNAPSHOT_INVALID` (422)
- `FX_RATE_REQUIRED` (422)

Network retry with the same request id returns the original committed result only when the request identity and payload hash match. Reusing it for another operation hard-fails. No error causes implicit resume, latest-session selection, navigation, or evidence overwrite.

## 13. Testing and Acceptance

All mutation tests use temporary sourcing SQLite and temporary output directories.

Required tests cover:

- session ownership, multiple historical sessions, one writable session, explicit close
- Review goods switch makes old session read-only; explicit return restores writes only on full identity match
- revision conflicts and request-id idempotency
- strict lifecycle and immutable SEALED phases
- safe crop success; missing/overlapping region produces zero DB/file writes
- overlay hidden/restored even on failure
- screenshot and DOM atomic phase behavior
- exactly two screenshots maximum
- no fetch/XHR/image download/navigation/scroll/search/See more calls
- deterministic DOM payload and BEFORE/AFTER delta
- screenshot output path containment and strict read routes
- calculator formulas, validation, FX freezing, and MOQ separation
- Random5 import does not mutate candidates
- assessment save and save-and-next stops on next goods
- stale UI response isolation after goods switch
- existing Review/Random5/visual index behavior remains passing
- frozen candidate-ledger fields and files remain untouched

Fixture localhost acceptance uses a local fake Temu-like page and extension unit/integration adapters. It must not open or operate a real Temu page. Review UI acceptance verifies the full flow through local fixtures and confirms the next goods waits for operator action.

## 14. Security and Operational Boundaries

This localhost application is an operator integration boundary, not a security sandbox. Server validation remains mandatory even if the UI or extension says a step passed. Screenshot paths are derived server-side, DOM fields are allowlisted and bounded, and evidence reads are scoped by run/goods/session.

No production sourcing mutation is required for automated acceptance. No Catalog or frozen Snapshot/Image Cache database migration is introduced. No real Temu capture is started. No push occurs without separate authorization.

## 15. Final Gates

```text
FROZEN_FEATURE_CONTRACT_IMPACT = NONE
SNAPSHOT_FEATURE_IMPLEMENTATION_STARTED = NO
SNAPSHOT_TASK1_STARTED = NO
FROZEN_SNAPSHOT_MIGRATIONS = 0
TEMU_PAGE_OPENED_BY_OPERATOR_ONLY = YES
PROGRAMMATIC_TEMU_OPEN_CALLS = 0
AUTOMATIC_TEMU_SEARCH_CALLS = 0
AUTOMATIC_SEE_MORE_CALLS = 0
CODE_INITIATED_TEMU_FETCH = 0
CODE_INITIATED_TEMU_XHR = 0
CODE_INITIATED_IMAGE_DOWNLOAD = 0
CODE_INITIATED_SCROLL = 0
SAFE_SCREENSHOT_FALLBACK_TO_VIEWPORT = NO
PHASE_ATOMIC_WRITES = YES
MVP_PHASE_A_CALCULATOR = PASS
MVP_PHASE_B_EVIDENCE = PASS
MVP_PHASE_C_REVIEW_INTEGRATION = PASS
SAVE_AND_NEXT_AUTO_SEARCHES = NO
PUSHED = NO
```
