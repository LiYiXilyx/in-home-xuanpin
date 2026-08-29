# Fixed Temu Controlled Chrome Profile

This document defines the only formal Temu browser identity used for the 50 / 300 / 3000 Catalog expansion campaign on this machine.

## Formal Profile

- Chrome profile display name: `Temu1店`
- Chrome profile directory: `Profile 10`
- User data directory: `C:\Users\Administrator\AppData\Local\Google\Chrome\User Data`
- Chrome executable: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- Capture mode: `MANUAL_NAVIGATION_PASSIVE_CAPTURE`
- CDP required: `false`
- Extension passive capture required: `true`
- Local extension server: `http://127.0.0.1:37821`

The live audit confirmed that this profile contains the accepted Track A unpacked extension and the healthy Germany / English / EUR Temu operating session. No Cookie, Token, password, local storage, or profile file is copied.

## Why Formal CDP Is Disabled

Chrome 136 and later ignore `--remote-debugging-port` and `--remote-debugging-pipe` for the default Chrome User Data directory. `Profile 10 / Temu1店` is located in that protected default directory, so the formal launcher does not request port 9222 and does not modify the real operating profile to bypass Chrome security.

Other explicit browser-automation test modes may retain CDP only when they use a separate, non-default `--user-data-dir`. Such test profiles are never a fallback for formal Temu work.

## Fixed Launcher

Start the localhost server first, then run:

```powershell
npm run dashboard
npm run browser:temu
```

The launcher is `scripts/start-temu-controlled-chrome.ps1`. It:

1. requires `127.0.0.1:37821` before opening Chrome;
2. opens exactly the installed Chrome, default User Data directory, and `Profile 10` on `about:blank`; it never opens, redirects to, or restores a Temu category page;
3. passes no remote-debugging switch;
4. creates no profile and has no fallback directory or port;
5. records a local runtime marker containing `cdp_required=false` and `extension_passive_required=true`;
6. refuses to guess the active identity if an unverified Chrome is already running.

## Manual Navigation Passive Capture

The operator manually:

- logs in;
- completes CAPTCHA or other verification;
- opens a healthy Germany / English / EUR motorcycle accessories page with Top sales;
- scrolls the page;
- clicks `See more`;
- changes necessary listing pages.

After reaching the healthy target page, the operator clicks `绑定当前页面`. Only a page that simultaneously passes Germany, English, EUR, exact category, exact Top sales sort, and non-empty real goods-card checks becomes `PAGE_BOUND`. The binding records `bound_url`, `bound_at`, `bound_category`, and `bound_sort`.

The program only:

- receives natural page Network observations through the installed extension;
- accepts `/api/poppy/v1/opt` product records parsed by the shared Track A parser;
- intersects Network identities with current real DOM `goods_id` values;
- applies strict `goods_id` deduplication and electronic/business exclusion;
- writes Campaign staging, snapshots and checkpoints to SQLite;
- restores the same Campaign and accepted identities after browser or server restart;
- stops at the exact stage or Campaign target.

The extension never scrolls, clicks `See more`, solves CAPTCHA, calls a Temu API directly, or replays a request.

If the bound page becomes the home page, a different category, a non-Top-sales sort, an empty listing, or an `Oops! The items are gone` page, the runner immediately enters `PAGE_CONTEXT_LOST`, pauses capture, and clears the live binding. It never navigates or clicks `Try again` to repair the page. The operator must restore a healthy page and click `重新绑定当前页面` before capture can resume.

## Stage Gates

The formal sequence cannot be skipped:

```text
50 Goods Manual Navigation QA
then 300 Goods QA
then 3000 Goods
```

Runner states are `UNBOUND`, `PAGE_BOUND`, `PAGE_CONTEXT_LOST`, `CAPTURING`, `PAUSED`, `TARGET_REACHED`, `COMPLETED`, and `FAILED`.

The current 50 Goods stage is measured from its frozen Campaign origin. Stage approval requires:

```text
accepted stage delta = 50
duplicate goods_id = 0
accepted_to_snapshot_missing = 0
failed = 0, or every failure explicitly isolated
SQLite integrity = ok
FK violations = 0
Active Pool unchanged
```

The 300 stage remains locked until 50 QA passes. The 3000 stage remains locked until 300 QA passes. Active Pool materialization and activation run only after the exact 3000 target and the existing transaction safety gates pass.

## Health Check

Before starting or resuming a stage, confirm in the visible fixed Chrome:

```text
Profile = Temu1店
Extension loaded = true
localhost:37821 connected = true
Germany = true
English = true
EUR = true
Motorcycles & Powersports Accessories = true
Top sales = true
real DOM goods_id > 0
page healthy = true
```

Wrong locale/category/sort, zero product cards, login, CAPTCHA, `Try again`, `Oops`, or extension/server unavailability places the runner in a waiting state. It is never permission to use another profile.

## Restart and Recovery

- Browser closed: restart the server if necessary, then run `npm run browser:temu`.
- Server closed: restart `npm run dashboard`; the SQLite checkpoint and accepted identities remain.
- Login or CAPTCHA: complete it manually in `Temu1店`, then resume from the panel.
- Extension stale: reload the existing unpacked extension from this repository's `browser-extension` directory in `Temu1店`.
- Page unhealthy: navigate normally in the same profile.
- Chrome already running without a valid fixed marker: close all Chrome windows manually and rerun the launcher.

## Forbidden Fallbacks

Formal Temu work must never use:

- `browser-profile-day4`;
- any `browser-profile-fresh-*` directory;
- a temporary or copied User Data directory;
- a copied Cookie, Token, password, or login store;
- another Chrome profile as an automatic fallback;
- automatic scrolling, automatic `See more`, automatic CAPTCHA handling, direct Temu API calls, or request replay;
- an attempt to re-enable CDP against the real default-profile directory.

If the fixed profile, extension, or local server is unavailable, the result is `MANUAL_REQUIRED`.
