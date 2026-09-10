# YingDao Excel-Wide Visual Retrieval & Multi-Run Review V1 Design

## 1. Current architecture and correction

The existing Review Console is run-scoped for mutations and currently derives price comparison groups from the 50 goods in one run. That behavior remains available only as compatibility data; it is no longer the visual-search universe. The visual universe is the complete `05_细分商品明细` sheet in the current run's immutable `selected_workbook_path`. The real workbook currently contains 2,135 goods and 2,124 embedded Temu images.

Review mutations remain strictly scoped to one `run_id`. Visual matches may point to goods in the current run, another completed run, a future plan, or no known plan. Cross-run matches never enter the current run's `selectGoods` or mutation endpoints.

## 2. Workbook universe authority

`loadVisualWorkbookUniverse({workbookPath})` reuses the XLSX package-image extraction contract from `random5-workbook.mjs`. It requires Sheet 05 and exact headers for goods identity, embedded Temu image, title, EUR price, pool version, sales/rating/reviews/rank, taxonomy, cluster, and URLs. It normalizes IDs as NFC strings, rejects duplicate goods IDs, maps images by workbook row and the `Temu主图` column, and never reads a different workbook.

The universe identity includes the workbook SHA-256, Sheet 05 semantic fingerprint, unique pool version, and image-anchor/content fingerprints. Missing images remain in metadata with `IMAGE_MISSING` and never receive fabricated vectors.

## 3. Local semantic model

The semantic backend is macOS Vision `VNGenerateImageFeaturePrintRequest`, fixed to revision 2. A committed Swift source sidecar is compiled locally into the YingDao cache when its source/toolchain fingerprint changes. It accepts JSONL jobs over stdin, uses local images only, emits 768-element Float32 feature vectors, and makes no network requests. Node normalizes each vector to unit L2 length and cosine similarity is the primary retrieval score.

Model identity is `APPLE_VISION_FEATURE_PRINT`, model revision is `2`, and model hash is the SHA-256 of the resolved Vision framework binary plus the compiled sidecar/source identity. The build report also records macOS and Swift versions. The binary and all generated model/index artifacts are ignored by Git. If this backend cannot compile or execute, building fails with `LOCAL_VISUAL_EMBEDDING_BACKEND_UNAVAILABLE`; pHash alone is never reported as semantic retrieval.

## 4. Preprocessing and perceptual hash

Embedded image bytes are decoded by Sharp, EXIF orientation is applied, the image is converted to sRGB, fitted into a deterministic 224x224 white canvas, and re-encoded as JPEG. `preprocessing_version=SHARP_224_SRGB_WHITE_V1`. Decode failure is recorded without a vector.

A deterministic 64-bit dHash is calculated from the decoded image. Hamming distance supplies a near-duplicate signal, but never replaces the semantic score. Every thumbnail path is derived by server-side goods identity and kept inside the index root.

## 5. Index persistence and atomicity

The YingDao cache root contains `visual-index/<index-fingerprint>/` with `manifest.json`, `products.jsonl`, `embeddings.bin`, `phash-index.json`, `thumbnails/`, and `build-report.json`. A sibling temporary directory is used for builds; validation verifies counts, vector dimensions, hashes, paths, and readable thumbnails before atomic rename. A failed build cannot replace the previous READY index.

Index identity binds workbook path metadata, workbook and Sheet 05 fingerprints, pool version, model identity/revision/hash, preprocessing version, vector dimension, and `index_schema_version=1`. Any identity change returns STALE. Review lifecycle changes do not change that identity or embeddings. Rebuilding identical input is idempotent and may reuse the READY index.

## 6. Retrieval and ranking

Queries resolve an anchor goods ID from the loaded index. The engine excludes the anchor, computes cosine similarity over persisted normalized vectors, calculates dHash distance, and derives metadata consistency. Taxonomy/cluster can lower a close visual match when product types conflict, but cannot add a visually weak item.

Default `top_k=20`; the collapsed UI shows six. Results below the configured semantic/final threshold are omitted. Stable ordering is final score descending, semantic score descending, pHash distance ascending, then UTF-8 goods ID ascending. Each result exposes `semantic_score`, `phash_distance`, `metadata_consistency`, `final_similarity_score`, and auditable `match_reason`. Scores are never described as a probability of identical products.

## 7. Review plan and multi-run lifecycle

V1 first audits existing sourcing runs and plan/task evidence. No unproven 2,000-item set is invented. If there is no authoritative plan source, the response states `REVIEW_PLAN_STATUS_UNKNOWN`, `REVIEW_PLAN_SOURCE_UNRESOLVED=true`, while visual retrieval remains operational.

Run counts come from frozen sourcing run metadata and actual run candidates. The service supports any positive goods count and per-goods candidate count, including a final 17x5 batch. Legacy runs without explicit count metadata derive and report a frozen-compatible snapshot from their own rows rather than a global 50/250 constant.

Lifecycle mapping classifies a match as current-run candidate ready, other-run candidate ready, future planned, not scheduled, or explicitly outside plan. Navigation actions are `SWITCH_CURRENT_RUN`, `OPEN_OTHER_RUN`, or `NONE`; other-run URLs contain both target run and goods ID.

## 8. run_id and mutation safety

The page has no hardcoded run fallback. Missing `run_id` shows a run-selection/error state and enables zero mutations. `goods_id` is optional and must belong to the selected run. Every mutation validates URL/current state/body run identity and repository ownership; mismatch returns `REVIEW_RUN_MISMATCH` with zero writes.

## 9. Read-only visual APIs and image safety

Existing Review bootstrap/detail remain lightweight. Visual data is lazy:

`GET /api/sourcing/review/goods/:goods_id/visual-matches?run_id=...&limit=20&index_fingerprint=...`

`GET /api/sourcing/review/visual-index/images/:goods_id?run_id=...&index_fingerprint=...`

Both validate that the run owns the workbook, the fingerprint matches that workbook, and the goods exists in the index. Image resolution never accepts a client path, applies lexical and realpath containment, validates signature, and decodes before serving. Existing Temu and supplier image routes retain their path, SHA-256, JPEG, and decode checks.

## 10. Market metrics and opportunity ratio

Only reliable visual matches above threshold, with valid EUR prices, acceptable unit normalization, and no metadata conflict contribute to market metrics. Metrics distinguish the anchor price, the lowest other visual match, the lowest including the anchor, the reliable unit minimum, median, and coverage.

Existing conservative package parsing and versioned FX remain authoritative; MOQ is never packaging. Candidate ratio becomes `visual_market_min_reliable_unit_price_eur / supplier_unit_price_eur`. Risk bands override numeric HIGH/MEDIUM/LOW: FX, unit, tier, missing visual match, and metadata conflict. The UI repeats that price ratio is not profit.

## 11. Review UI

The existing three-column page is retained. A lazy `Excel视觉相似商品` accordion sits below the current Temu item and above Random5. It displays index status, universe/image counts, source sheet, six previews while collapsed, and up to 20 cards while expanded. Image click opens preview only. Current-run goods have an explicit switch button; other-run goods open their own run URL; unmapped goods display that candidates have not yet been generated.

Index build/update controls are YingDao-owned and affect only YingDao state. NOT_BUILT, BUILDING, READY, STALE, and FAILED are explicit; there is no silent fallback to the old 50-item classification group.

## 12. Catalog isolation and compatibility

No `ui/modules/catalog/*`, Catalog route, Catalog state, polling, campaign, membership, or pool code is modified. Catalog database writes remain zero. Existing Review filters, navigation, candidate selection/clear/exclude/restore/note/open-link, 409 reload, Random5 order, 50 Temu images, 250 supplier images, and seven existing selections are preserved.

## 13. TDD and stabilization

Each implementation task follows RED-GREEN with focused and related regression tests. Tests cover workbook identity, image mapping, local-only embedding, pHash, atomic/stale index, deterministic query, dynamic counts, cross-run safety, lazy API/UI, price metrics, and path containment. Stabilization also fixes the Unicode static-module filesystem-path test without weakening traversal checks and replaces the flaky isolation timestamp assertion with deterministic business-state assertions. The full suite must return exactly the approved seven historical failures and zero new failures.

## 14. Real acceptance

After tests, the real 2,135-row workbook is indexed locally with zero remote visual calls. A controlled restart loads the stable runtime, obtains a real run from sourcing APIs, opens a goods anchor with multiple visual matches, expands the accordion, previews an image, and captures a screenshot outside the repository. No Review mutation, workbook write, Catalog write, or model upload occurs. Dashboard and page remain open.
