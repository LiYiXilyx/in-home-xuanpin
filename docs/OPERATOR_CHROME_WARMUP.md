# Operator Chrome Warmup

## Architecture

Day9 uses the existing `external_cdp` mode as its operator-browser architecture. The operator starts Chrome with CDP enabled, and Playwright only attaches with `connectOverCDP` to Chrome's existing default context. It does not create a browser context, copy a profile, read or export cookies/tokens, or close the operator's Chrome.

`managed_profile` remains the system-managed collector mode and is not the Day9 operator-browser path.

## Start once, use normally

1. Close any previous Chrome that is already listening on CDP 9223.
2. Double-click `启动Temu运营Chrome.vbs` in the project root.
3. The script starts Chrome with a fixed project-local `browser-profile-operator-chrome` directory and CDP 9223. It opens `about:blank`; it never restores or navigates to a previous Temu session URL.
4. Keep this Chrome as the normal, long-lived Temu operating browser. Do not create a fresh profile for each job.

The profile is intentionally separate from daily Chrome. Never copy or import a daily Chrome profile, Cookie, Token, or Local Storage data.

## Required manual warmup

Before any Day9 validation, the operator must manually:

1. Open Temu homepage and log in.
2. Confirm Germany / English / EUR.
3. Perform one ordinary search.
4. Open one category normally from within Temu.
5. Open three ordinary product detail pages normally.
6. Return through the site to Motorcycle Accessories and select Top Sales.

Complete CAPTCHA or login prompts manually. The program never bypasses either.

## Validation gate

The program then performs read-only validation of the current page and these control products:

- `601099514149132`
- `601101179368252`
- `601101125571790`

At least 2 of 3 must be `AVAILABLE`, and the results must be compared with the operator's manual daily-Chrome check. A result of 0 of 3 means `CDP_ATTACHED_ENVIRONMENT_INCOMPATIBLE`: do not create a new profile or a Day9 review job.

## Current configuration

For this launcher, keep the runtime configuration at:

```json
"browser": {
  "mode": "external_cdp",
  "cdpEndpoint": "http://127.0.0.1:9223",
  "debugPort": 9223
}
```

No `operator_cdp` mode is needed because `external_cdp` already has the required ownership and safety behavior.
