# Page-Derived Category Profile V1

## Scope and authorization

Base: `e7f04e6d4155485601509dfbf1289f002c867ffc`. Develop only in the isolated
`codex/page-derived-category-profile-v1` worktree. The operator explicitly
authorized continuous Design → Plan → TDD without routine approval pauses.
Production detection, registration, entry actions and capture are forbidden.
No migration is required or authorized. Snapshot/Image Cache V1 remains frozen.

## Architecture and alternatives

Use a passive extension descriptor, ephemeral server probes and the existing
operator Profile store. Reuse the existing Registry, Profile validator and Entry
resolver. Do not add a second registry or duplicate the Entry state machine.
Server-side Temu fetching is rejected (not passive); automatic registration upon
detection is rejected (violates explicit operator intent).

Three explicit actions have distinct authority: recognition writes memory only;
registration writes only an operator Profile; Entry is the existing, separately
clicked Campaign transition. Selecting an existing Profile is UI state only.

## Page proof and descriptor

Only HTTPS `www.temu.com` category-listing paths with stable category slug/ID,
an unambiguous breadcrumb parent and terminal, visible product cards, DE/en/EUR
and selected Top Sales qualify. URL shape alone is insufficient. Reject search,
detail, home, recommendations, account/cart/orders, CAPTCHA/security, empty and
ambiguous pages. Missing market evidence fails closed; never infer currency from
country alone. Read only current DOM/URL; no fetch, XHR, image downloads, navigation,
refresh, scrolling or See more. Existing evidence/search behavior is untouched.

Descriptor allowlist: descriptor_schema_version, page_url, canonical_listing_url,
hostname, pathname, page_type, site_country, language, currency, sort_order,
breadcrumbs, breadcrumb_terminal, breadcrumb_parent, page_category_name,
category_url_slug, category_numeric_id, dom_goods_count, captcha_blocking,
security_verification, search_no_results, detected_at. Serialize no account,
credentials, cookies, headers or unrelated DOM. Both transmitted URLs are sanitized
category URLs, not raw tracking URLs. Server reconstructs and validates derived
fields rather than trusting client claims of validity. Localhost has no module
authentication: this is an integration contract, not a security sandbox or proof
against a malicious local client.

## Canonical identity and reuse

One shared browser-safe canonicalization implementation is consumed by extension
and server. Normalize HTTPS host; preserve stable category pathname. Strip known
tracking/session/referral keys and fragment. Unknown query keys fail closed until
fixture evidence classifies them, rather than silently discarding identity.
Numeric IDs are extracted only from the category listing grammar, never product IDs.

Resolve all Registry profiles by precedence: canonical identity; canonicalized
legacy listing URL; confident numeric ID; exact normalized full breadcrumb path;
slug plus parent context. At a matching tier, more than one profile is ambiguous;
do not pick latest. Conflicting known canonical identities veto weak name matches.
Reuse the exact compatible category_key and version, including manually created
Girls' Sets. Incompatible market/scope/capabilities block with CATEGORY_PROFILE_CONFLICT.
Invalid Registry entries fail closed rather than being silently ignored.

When none match, derive a stable Latin slug from terminal/name then URL slug.
Use the unsuffixed slug if free. On a different canonical identity collision,
append confident category ID or deterministic canonical-path/breadcrumb hash.
Keep human category name unchanged. Reuse normalizeOperatorCategoryProfile and
validateCategoryProfile; any bounded server-derived identity override is internal,
not accepted through the manual draft API. No random category keys. Profile version
hash excludes detected_at, probes, request IDs and tracking.

## Profile contract

Existing OPERATOR_MANAGED / CAPTURE_ONLY schema: DE/en/EUR, Top Sales,
MANUAL_BIND_PASSIVE_CAPTURE, OPEN_ENDED; taxonomy UNCONFIGURED; raw capture and
initial pool enabled; classification/opportunity disabled. Membership parent and
subcategory come from validated breadcrumbs. legacy_membership_scopes is empty;
navigation is human_navigation_only with category confirmation gate. No Motorcycle
taxonomy fallback. No required operator-entered Latin alias in the quick path.

## Probe and registration lifecycle

POST /api/catalog/operator/category-probes creates a bounded in-memory record
with random probe_id, canonical descriptor hash, resolution, created/expiry times.
TTL 5 minutes; bounded registry evicts expired probes and rejects capacity overflow.
GET /api/catalog/operator/category-probes/current exposes the latest explicitly
recognized probe only for preview, never as write ownership. Restart loses probes.
Each browser-tab detection gets its own immutable probe. Dashboard pins the exact
displayed probe while an action is pending; late poll results cannot redirect it.

POST /api/catalog/operator/category-probes/:probe_id/register requires exact
probe_id, descriptor_fingerprint and request_id. Check existence, TTL, fingerprint,
descriptor and re-resolve inside the registration boundary. Return explicit
CATEGORY_PROBE_NOT_FOUND / EXPIRED / CONTEXT_MISMATCH on invalid inputs, zero files.
Requests cannot substitute arbitrary editable draft fields. Same request with a
different fingerprint conflicts. Repeated same category resolves the single Profile.

Reuse the existing Profile store's filesystem atomic write boundary. Serialize
registration across independent service instances/processes with a store-level
atomic lock; re-resolution and write share that boundary. Fail closed on occupied
lock (explicit registration-in-progress), never remove an unproven stale lock.
Same-category racers produce one winner and reuse or explicit benign retry result;
no duplicate versions, partial profile or overwrites. Advanced registrations must
participate in the same boundary to prevent races with the quick path. Lock and
receipt files are allowed only during explicit registration, not probes.

## UI

Catalog-root-only primary section “快速使用当前 Temu 类目”: initially 尚未识别;
display category/parent/path/canonical URL/market/sort/card count/time/resolution.
EXISTING offers 选择当前类目 (no write); NEW offers 注册并选择当前类目 (Profile only).
After selection refresh profiles and select exact identity, then reuse server Entry
descriptor without firing its action. Expired/blocked preview disables registration.
Keep advanced manual onboarding labeled 高级：手工创建 Category Profile.
Add one compact recognition section to the existing extension overlay, not a second
floating panel. Errors and busy state are visible, escaped and Catalog-scoped.

## Tests and deployment

TDD covers the 33 acceptance cases in the operator request: descriptor/negative
page matrix; tracking identity; exact Girls' Sets reuse; all zero-write boundaries;
TTL/context and idempotency; independent registration races; colliding names;
existing Entry START/CONTINUE/EXPANSION; manual onboarding; module isolation;
no browser automation or taxonomy fallback. Ten local page fixtures include five
unrelated category examples plus search/detail/home/security/empty. Names are data,
not branches. Test stores/SQLite are temporary or copies only.

Baseline Entry/Profile subset: 33 PASS (local-port permission rerun). Before deploy,
full suite must retain exactly the same seven named baseline failures, zero new or
environment failures. Feature normal push only after acceptance. Re-read stable;
unknown advance stops. Check no in-flight operation, record production read-only
fingerprints including Profile files, FF-only integrate, rerun regressions, normal
stable push and controlled restart only after identity/occupancy gates. Stop on
unexpected business writes. Extension update must not operate a real Temu tab.
Final UI is 尚未识别; leave first real recognition/registration/Entry to the operator.

## Self-review

Page proof, search exclusion, legacy identity reuse, two-tab ownership, expiration,
restart, races, collisions and tracking are specified above. No duplicated Entry
logic, persistent probe, schema migration or frozen implementation. Registration
lock crash recovery is deliberately fail-closed maintenance, not automatic deletion.
