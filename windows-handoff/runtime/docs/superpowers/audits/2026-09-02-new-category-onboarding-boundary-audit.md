# New Category Onboarding Boundary Audit

Date: 2026-09-02

## Frozen decisions

```text
PROFILE_SOURCES = BUILT_IN + OPERATOR_MANAGED
MANUAL_BIND_MODE = MANUAL_BIND_PASSIVE_CAPTURE
PREVIEW_SCOPE = campaign_id + candidate_revision
FORMAL_SCOPE = category_key + category_profile_version + pool_version_id
MOTORCYCLE_POLICY_REUSE_FOR_CAPTURE_ONLY = NO
SECOND_CAPTURE_STACK = NO
```

## Existing seams to reuse

| Area | File | Existing entry point | V1 treatment |
|---|---|---|---|
| Registry | `src/modules/catalog-scale/category-profile-registry.mjs` | `createCategoryProfileRegistry()` | Extend to two explicit sources and retain reload-on-call behavior. |
| Profile validation | `src/modules/catalog-scale/category-profile.mjs` | `validateCategoryProfile()` | Preserve built-in ruled validation; add an explicit schema-v2 capture-only branch. |
| Initial Campaign | `src/modules/catalog-scale/catalog-campaign-service.mjs` | `createOperatorInitialCampaign()` | Reuse unchanged OPEN_ENDED persistence and atomic Campaign/source/queue creation. |
| Candidate ledger | `src/db/repositories/initial-pool-repository.mjs` | candidate revision and frozen payload reads | Use exact Campaign revision for preview export. |
| Initial QA | `src/modules/catalog-scale/initial-pool-qa.mjs` | `evaluateInitialPoolQa()` | Keep universal gates and make business policy explicitly profile-enabled. |
| Activation | `src/modules/catalog-scale/initial-activation-coordinator.mjs` | campaign-scoped mutex | Reuse unchanged. |
| Manual Bind | `browser-extension/catalog-manual-binding.js` | detect/bind context | Drive expected category evidence from aliases, breadcrumbs, and listing path. |
| Capture | `src/modules/catalog-scale/catalog-campaign-service.mjs` | `captureExtensionBatch()` | Reuse server-side binding proof and idempotent batch path. |
| Pool read | `src/db/repositories/catalog-pool-read-repository.mjs` | exact Pool tuple read | Reuse scope rules for formal export. |
| Workbook | `src/modules/export/export-service.mjs` | Artifact Tool workbook/image helpers | Reuse formatting and image safety; add explicit scoped model inputs. |
| Catalog UI | `ui/modules/catalog/*` | `mountCatalogPanel()` | Add onboarding/export controls inside the Catalog root only. |

## Universal versus Motorcycle-only rules

Universal capture and QA rules are product identity, Campaign/Profile scope, market/Page Health, binding evidence, batch consistency, required fields, data quality, SQLite integrity, foreign keys, cross-category isolation, frozen payload, and deterministic revision/hash.

Motorcycle-only rules are electronics/USB/battery exclusions, Motorcycle hard exclusion codes, price minimum, Motorcycle eligibility, Level1/2/3 taxonomy, Opportunity taxonomy, and legacy membership fallback. They remain enabled only by the built-in Motorcycle profile. A capture-only profile records policy status `NOT_CONFIGURED` and may activate a raw Pool without classification or Opportunity.

## Export boundary

Preview export reads only an explicit Initial Campaign and exact current candidate revision. Formal export reads only an explicit Category/Profile/Pool tuple. Neither path may query a global active membership set, infer latest Campaign/Pool, or select products outside the requested scope. Export writes workbooks only and performs zero database writes.

## Protected integration boundary

YingDao, Review, Random5, Visual Index, supplier image cache, and `/api/sourcing/*` are not implementation surfaces for this feature. Shared router/server changes are restricted to Catalog dependency composition and route registration.
