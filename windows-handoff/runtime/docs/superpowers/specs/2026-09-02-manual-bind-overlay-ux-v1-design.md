# Temu Extension Manual Bind Operator Overlay UX V1 Design

## Goal and safety boundary

The extension renders one Catalog operator surface selected from the server-owned Campaign context. It does not create, resume, bind, detect, capture, run QA, or activate anything automatically. The existing `girls-sets` Profile and Initial Campaign remain unchanged and no sourcing/YingDao file is in scope.

## Audit

Four independent extension surfaces currently compete on Temu listing pages:

- `catalog-auto-runner.js` mounts `#temu-catalog-auto-runner` plus a launcher and contains Motorcycle-only category/sort constants.
- `catalog-manual-passive-runner.js` mounts `#temu-catalog-manual-bind` independently.
- `catalog-capture.js` mounts `#temu-catalog-capture-button` and `#temu-catalog-capture-status` independently.
- `content-script.js` owns Review notices/buttons, which must remain Review-specific and must not become a second Catalog action surface.

The Auto Runner boot path currently mounts even when the context is `MANUAL_BIND_PASSIVE_CAPTURE`; Popup independently reconstructs the Manual Bind display and leaks targeted `0 / 0` semantics for open-ended Initial Campaigns.

## Central mode contract

`browser-extension/catalog-overlay-mode.js` exports `resolveCatalogOverlayMode(context)` through `TemuCatalogOverlayMode`. Its only results are:

- `MANUAL_BIND`: `MANUAL_BIND_PASSIVE_CAPTURE` or the approved manual-navigation alias.
- `LEGACY_AUTO_RUNNER`: explicit `FULL_REFRESH_EXTENSION_AUTO`.
- `NO_CONTEXT`: no explicit Campaign.
- `BLOCKED`: malformed, unsupported, or internally inconsistent context.

The sentinel target never identifies a mode. Auto Runner boot and polling occur only for `LEGACY_AUTO_RUNNER`. Manual Runner boot occurs only for `MANUAL_BIND`. No-context creates one compact launcher with explanatory text and no action runner.

## Shared view model

`browser-extension/catalog-operator-view-model.js` converts a Manual Runner snapshot into one immutable operator model consumed by both page Overlay and Popup. It exposes operator fields (category label, quantity label, current unique, Page Health expected/actual checks, binding, steps, last counts, disabled reasons, human error copy) and a collapsed technical section (Campaign/Profile identities, fingerprints, network/DOM readiness, parser/checkpoint/error code).

Profile values always come from the current exact context. Page-health category expectations come from `page_health.category_names`, category aliases, navigation breadcrumbs, or display name in that order. A context identity change clears detection/binding and prevents an older async result from being rendered.

Initial `OPEN_ENDED` renders `不限数量`, current unique, and last-added count; it never renders `0/0`, a null target, remaining, or percentage. Targeted campaigns retain current/target semantics.

## Single page overlay

`browser-extension/catalog-operator-overlay.js` owns:

- one fixed root `#temu-catalog-operator-overlay`;
- at most one compact launcher inside that root when collapsed/no-context;
- one deduplicating toast container `#temu-catalog-toast-container` positioned above the panel;
- one 360–400px white panel, max-height `min(70vh, 640px)`, internal scrolling;
- task identity, three numbered steps, concise Page Health expected/actual rows, last capture counts, human error guidance, and a default-collapsed technical `<details>` section.

The overlay uses 18px title, 16px primary state, at least 14px body, 1.45 line height, explicit text/icons plus approved color tokens. It supports keyboard focus, visible outlines, `aria-live`, `aria-expanded`, disabled reason text, and session-scoped collapse state. Expanded state hides the compact launcher. Toasts are deduplicated by kind; normal messages expire after four seconds and errors persist until replaced/dismissed.

The Overlay invokes the existing runner methods only from explicit clicks. It does not add timers for capture, navigation, scroll, pagination, See more, CAPTCHA, or category/sort switching.

## Runner integration

`catalog-manual-passive-runner.js` owns Manual Runner state and mounts only the shared Overlay. It exposes the same snapshots/actions to extension messaging. `catalog-auto-runner.js` remains intact for explicit legacy refresh but cannot mount, poll, scan, or expose Motorcycle health text in Manual Bind mode. `catalog-capture.js` keeps its capture service but suppresses its independent Catalog button/status when the shared Manual overlay owns the page.

Review controls remain separate because product review capture is not a Catalog listing action. They use the shared toast host only when present and are not modified beyond overlap avoidance.

## Popup contract

Popup imports the same overlay mode and view-model scripts and renders the same operator model. Its three actions continue to message the active page runner. Popup does not infer category, target, or binding independently. Debug identifiers remain under a collapsed technical section. The legacy Auto Runner entry is an advanced-only explanatory control and is disabled while Manual Bind owns the context.

## Testing and real-page acceptance

Node VM/DOM tests cover mode exclusivity, no legacy DOM/polling in Manual Bind, dynamic girls/Motorcycle context, stale-response rejection, open-ended quantity, Page Health expected/actual rows, action gates, collapse/launcher exclusivity, toast dedup/layout, hidden technical details, and Popup/Overlay model equality. Existing Manual Bind API/idempotency/context-loss tests remain green. Tests never send a real capture.

Full suite must retain the exact approved seven baseline failures and add zero failures. Final acceptance reloads the unpacked extension, refreshes the real Girls' Sets page, inspects without clicking detect/bind/capture, stores a screenshot outside the repository, and leaves Dashboard and page open.

## Git and production

Work occurs on `codex/manual-bind-overlay-ux-v1`, is normally pushed, and is ff-only merged into `codex/catalog-yingdao-runtime`. No force/rebase/amend. Production Catalog rows, Profile, Campaign, Product, Membership, Pool, QA, and YingDao state are read-only throughout this feature.
