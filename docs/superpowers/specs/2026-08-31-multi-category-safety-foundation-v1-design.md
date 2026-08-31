# Multi-Category Safety Foundation V1 Design

## Status

Approved for implementation on 2026-08-31. This design is limited to making a second category safe on the existing DE / English / EUR site. It does not authorize a real collection, production database writes, taxonomy content changes, or a multi-currency redesign.

## Goal

Make category scope an explicit, validated input to every formal Catalog Scale path so that two categories can coexist without sharing Campaign state, membership mutations, active-pool state, classification input, or Excel input.

Product identity remains `platform + external_product_id` (`platform + goods_id` for Temu). Category membership remains a separate relation. The same product row may therefore be referenced by one membership per category scope.

## Non-goals

- Do not add category to product identity.
- Do not collect a real second category.
- Do not resume, delete, or mutate any existing Motorcycle Campaign.
- Do not materialize or reclassify the production Motorcycle pool.
- Do not backfill the 452 production memberships whose `category_key` is `NULL`.
- Do not change Motorcycle taxonomy rules or create a real new-category taxonomy.
- Do not redesign currency fields or remove existing EUR-specific fields.
- Do not push commits.

## Safety invariants

1. A Campaign is selected only by an explicit Campaign ID. Control mode, target count, status, recency, or “latest” are never resume keys.
2. Resume validates Campaign ID, category key, category profile version, and Campaign type before any state change.
3. A membership lookup or upsert uses the requested category scope; a product-only lookup is forbidden.
4. Activating or reconciling a pool changes memberships only inside that pool's category scope.
5. Baseline, classification, and workbook inputs are derived from an explicit category key, pool version ID, or snapshot ID. No formal path falls back to all active memberships or a global latest record.
6. A taxonomy pipeline runs only with the binding frozen for its Category Profile. Missing or mismatched bindings hard-fail.
7. Legacy compatibility may resolve historical Motorcycle memberships at runtime only when the full scope proves a unique match. It never writes the resolved key to production data.
8. Any missing, conflicting, ambiguous, or cross-category scope is a hard failure before mutation.

## Category Profile and taxonomy bindings

The existing `taxonomy` field remains accepted only for backwards compatibility. New formal paths first resolve `taxonomy_bindings.<pipeline>` where `<pipeline>` is exactly `classify`, `fine_classify`, or `opportunity`.

All three bindings use the same shape:

```json
{
  "taxonomy_name": "string",
  "taxonomy_version": "string or null",
  "rule_version": "string",
  "category_scope": "category_key"
}
```

`taxonomy_version` contains a real version when the underlying taxonomy exposes one. It is `null` when the legacy system has no separate version. The resolver must not synthesize a version.

The Motorcycle profile receives explicit bindings for all three known pipelines. A narrowly scoped legacy resolver may construct those three known Motorcycle bindings when reading an old frozen Campaign config that predates `taxonomy_bindings`. This resolver is allowed only when all of these are true:

- `category_key` is exactly `motorcycle-accessories`;
- `category_profile_version` is a recognized historical Motorcycle profile version;
- the pipeline is one of the three known pipelines;
- the resolved taxonomy and rule version equal the repository's existing Motorcycle definitions.

New Category Profiles must contain `taxonomy_bindings`. Missing pipeline bindings, a binding whose `category_scope` differs from the profile category key, a taxonomy name mismatch, or a rule-version mismatch produces a coded hard failure. The old single `taxonomy` field never grants an unknown category access to a pipeline.

At Campaign creation, the validated, normalized Category Profile—including all resolved taxonomy bindings—is written into `catalog_campaigns.config_json`. Resume and downstream work use that frozen copy and compare it with any explicitly supplied profile. A later config-file edit cannot silently change historical Campaign semantics.

## Canonical category scope

Catalog Scale uses the existing `category_key` as the canonical category discriminator. A normalized scope also includes:

```text
category_key
category_profile_version
site_country
language
currency
primary_category
subcategory
sort_order
```

`primary_category` and `subcategory` come from an explicit normalized membership scope in the Category Profile. For the legacy Motorcycle profile, explicit historical scope aliases cover the existing formal spellings; aliases are compatibility evidence, not new category identities.

All scope SQL is centralized in one small module so repository methods do not hand-build inconsistent predicates. Mutation APIs receive a resolved scope object rather than a bare product ID.

## Legacy Motorcycle membership resolution

Production currently contains:

```text
LEGACY_MEMBERSHIP_NULL_CATEGORY_KEY = 452
LEGACY_ACTIVE_MEMBERSHIP_NULL_CATEGORY_KEY = 220
```

These rows remain unchanged. Runtime resolution follows this order:

1. A non-null `membership.category_key` must equal the requested category key. A different key is a mismatch, not a legacy candidate.
2. A null-key row is considered only for the recognized legacy Motorcycle profile.
3. Its site country, language, currency, primary category, subcategory, and sort order must exactly match one declared Motorcycle legacy scope alias.
4. Its `platform + goods_id` must occur in the explicit Motorcycle pool version used by the operation.
5. The membership must match exactly one declared legacy scope and exactly one membership candidate for that requested category operation.
6. Zero matches, duplicate matches, an alias collision, missing scope data, pool identity conflict, or Campaign/Profile conflict hard-fails.

The resolver returns audit counts for `uniquelyResolved`, `unresolved`, and `ambiguous`. It performs no `UPDATE` and is unavailable to new categories.

## Campaign selection and explicit resume

The three Catalog Scale admin tools stop using implicit finders:

- `catalog-full-refresh-admin.mjs`
- `catalog-manual-passive-admin.mjs`
- `catalog-expansion-admin.mjs`

Creation without `--resume-campaign` always creates a new Campaign ID after validating the supplied Category Profile. It never reuses an existing Campaign because target count or browser mode happens to match.

Resume requires `--resume-campaign <campaign_id>` and an explicit profile. A shared validator loads the Campaign and compares:

```text
campaign.id
campaign.campaign_type
campaign.category_key
campaign.category_profile_version
frozen category profile
resolved taxonomy bindings
```

Any mismatch hard-fails without transition, queue claim, checkpoint read, or materialization. Operational actions that act on an existing Campaign continue to require an explicit Campaign ID and use the Campaign's frozen scope; they do not call a “latest Campaign” helper.

The existing paused `1208 / 2000` Motorcycle Campaign is never selected unless its exact ID is explicitly supplied together with its matching Motorcycle profile.

## Membership materialization

Refresh and expansion materialization retain the existing product upsert by `platform + external_product_id`.

Membership resolution is changed from “latest membership for product” to “membership for product and resolved category scope.” For new rows the authoritative lookup includes `category_key` plus the existing site/language/currency/category/sort fields. For recognized legacy Motorcycle rows, the strict runtime resolver described above may select the matching null-key row.

Materializing Category B with a product already present in Category A therefore reuses the product row and inserts or updates only Category B's membership. Category A membership columns, active flag, Campaign link, source link, rank, and timestamps remain unchanged.

## Active pool and baseline isolation

The existing partial unique index on `catalog_pool_versions(category_key) WHERE status='active'` remains the database-level guarantee that one category has at most one active pool. It already permits different categories to each have one active pool.

Pool activation and reconciliation use the target pool's category key and resolved scope:

- supersede only the previous active pool for that category;
- deactivate only memberships resolved to that category;
- activate only membership IDs resolved for target pool items in that category;
- count and verify only the category-scoped active memberships;
- leave every other category's memberships and pool status untouched.

`getBaselineConsistency(categoryKey)` reads the explicit active pool for that key and category-scoped memberships only. When legacy Motorcycle rows are involved, it resolves them against that explicit pool. There is no fallback to all active memberships. `captureCampaignBaseline` freezes items from the resolved category pool only and hard-fails if no unambiguous category pool exists.

## Classification isolation and taxonomy gate

Formal classification APIs require an explicit Category Profile plus either `pool_version_id` or a category key that resolves to exactly one active pool. The preferred stable input is `pool_version_id`.

The selected pool must belong to the requested category and profile version. Product input is obtained by joining `catalog_pool_version_items` to products/staging/snapshots, not by scanning all active memberships.

Before classification:

1. resolve the pipeline binding from the profile or recognized frozen Motorcycle compatibility data;
2. assert binding `category_scope` equals the requested category key;
3. assert the loaded taxonomy name, real taxonomy version (when present), and rule version equal the binding;
4. hard-fail before replacing any classification rows if any assertion fails.

Week1 classify, fine classify, and Opportunity each use their own binding. Taxonomy content and classification rules remain unchanged.

## Excel and Opportunity snapshot isolation

Operations Excel requires an explicit pool version or category-scoped active pool. Its product rows and counts come only from that pool. Metadata records the actual category key, category profile version, source Campaign ID, pool version ID, and applicable taxonomy binding values.

Opportunity analysis requires an explicit source pool/category and produces a frozen snapshot. Opportunity Excel requires an explicit snapshot ID; it does not choose a global latest snapshot. Its metadata comes from the snapshot's frozen config and source relations.

The workbook must display `snapshot.config.taxonomyVersion` and `snapshot.config.ruleVersion`. It must not hardcode `motorcycle-opportunity-v2` or silently substitute a current constant for an older snapshot. A missing required snapshot metadata field is reported honestly as null/legacy, not replaced with a fabricated value.

## Error handling

New safety gates use stable coded errors so integration tests can assert the reason:

```text
CATEGORY_PROFILE_BINDING_REQUIRED
TAXONOMY_CATEGORY_SCOPE_MISMATCH
TAXONOMY_BINDING_MISMATCH
CAMPAIGN_RESUME_ID_REQUIRED
CAMPAIGN_CATEGORY_MISMATCH
CAMPAIGN_PROFILE_VERSION_MISMATCH
CATEGORY_SCOPE_UNRESOLVED
CATEGORY_SCOPE_AMBIGUOUS
POOL_CATEGORY_MISMATCH
POOL_VERSION_REQUIRED
SNAPSHOT_ID_REQUIRED
```

Safety errors are raised before transactions that mutate formal state. Existing transaction boundaries remain in place for materialization and pool activation.

## Test strategy

All write tests use temporary SQLite databases migrated from the repository migrations. No test accesses Temu or writes the production database.

Fixtures define `category-a` and `category-b`, explicit taxonomy bindings, separate scopes, Campaigns with identical target counts/control modes, and a shared goods ID `SAME001`.

Required integration coverage:

1. Product identity: two categories with `SAME001` produce one product row.
2. Membership isolation: each category has its own membership row.
3. Materialize isolation: re-materializing Category B leaves Category A membership byte-for-byte unchanged.
4. Active pool isolation: activating Category B leaves Category A pool and active membership active.
5. Campaign isolation: identical target/mode still creates distinct Campaign IDs.
6. Checkpoint isolation: Category B begins at zero and cannot read Category A's `1208 / 2000` state.
7. Explicit resume: absence of `--resume-campaign` never resumes; explicit A resumes only A.
8. Wrong-category resume: requesting B with Campaign A hard-fails.
9. Baseline isolation: each baseline contains only its category pool.
10. Classification scope: Category B input excludes Category A-only products.
11. Taxonomy binding: Category B plus Motorcycle taxonomy hard-fails.
12. Excel scope: Category B workbook input excludes Category A-only products.
13. Pool uniqueness: one active pool per category, two active pools across two categories.
14. Legacy unique resolution: null-key Motorcycle membership plus unique pool/scope passes.
15. Legacy unresolved: missing or nonmatching scope hard-fails.
16. Legacy ambiguous: colliding candidate evidence hard-fails.
17. New-category legacy denial: Category B cannot use Motorcycle legacy fallback.
18. Snapshot metadata: workbook uses the frozen taxonomy/rule versions, including a legacy `motorcycle-opportunity-v1` fixture.

Existing tests that assert implicit resume are updated to assert the new explicit behavior. Compatibility is not restored by weakening a gate.

## Production read-only QA

Before and after implementation, capture the following through a read-only database connection:

```text
SQLite integrity_check
foreign_key_check
products count
memberships count
active memberships count
legacy null-category membership counts
pool versions by category/status
Campaign count and status distribution
the exact 1208/2000 Campaign status and progress
```

The before/after values must be identical. The final report includes legacy resolver test counts and the two production audit constants, but it does not run the compatibility resolver as a production mutation.

## Delivery

Implementation may be committed in focused commits after tests pass. Nothing is pushed. The final verdict is `SAFE_FOR_SECOND_CATEGORY_10_ROW_DRY_RUN = YES` only when every required isolation test passes and production read-only QA proves no state change; otherwise it is `NO` with explicit blockers.
