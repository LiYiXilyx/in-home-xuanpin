# Day8.2 AI Provider Setup

Day8.2 defaults to rule-only mode. The classifier does not fail when AI is disabled, configuration is incomplete, or the API key is absent.

## Environment variables

- `TEMU_FINE_CLASSIFIER_ENABLED`: `true` enables the configured provider; all other values keep rule-only mode.
- `TEMU_FINE_CLASSIFIER_PROVIDER`: currently `openai-compatible`; `mock` is reserved for local tests.
- `TEMU_FINE_CLASSIFIER_MODEL`: provider model identifier.
- `TEMU_FINE_CLASSIFIER_API_KEY`: secret read at provider call time only.
- `TEMU_FINE_CLASSIFIER_BASE_URL`: OpenAI-compatible service base URL or full chat-completions URL.

Do not place the API key in `config.json`, UI fields, database rows, command arguments, or logs. Local `.env*`, `secrets/`, and `*.secret.json` files are ignored by Git, but the application itself reads the classifier key directly from the process environment.

## Runtime behavior

If the feature is disabled or the key is absent, the result records `ai_enabled=false` and `rule_only_no_api_call`. AI failures are recorded as `timeout`, `invalid_json`, `schema_invalid`, `taxonomy_invalid`, or `provider_error`, then the product keeps its rule result or enters manual review. One failed item never stops the batch.

`dryRun` and the `mock` adapter are dependency-injection options for tests and do not contact an external service.
