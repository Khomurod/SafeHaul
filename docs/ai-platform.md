# Shared AI platform

Every AI request in SafeHaul goes through one server-side system: `functions/ai/`.
No feature talks to a vendor directly, and
`scripts/check-ai-provider-boundary.mjs` fails CI if one tries.

- [Why this exists](#why-this-exists)
- [Request path](#request-path)
- [Folder layout](#folder-layout)
- [Provider registry](#provider-registry)
- [Capability matrix](#capability-matrix)
- [Fallback order and behaviour](#fallback-order-and-behaviour)
- [GitHub Models is retired](#github-models-is-retired)
- [Credential storage](#credential-storage)
- [Groq migration](#groq-migration)
- [Current AI call sites](#current-ai-call-sites)
- [Super Admin operation](#super-admin-operation)
- [Adding or removing a provider](#adding-or-removing-a-provider)
- [Telemetry](#telemetry)
- [Emergency disable](#emergency-disable)
- [Provider outage recovery](#provider-outage-recovery)
- [Testing](#testing)
- [Manual actions required](#manual-actions-required)

## Why this exists

Before this platform, two features each held their own Groq endpoint, their own
model pin and their own error handling. That meant a Groq outage broke CDL
auto-fill and document analysis independently, adding a vendor meant editing
feature code, and there was no single place to see whether AI was working.

The platform replaces that with one router, one credential store and one
console. The trade is a layer of indirection; what it buys is that a vendor
outage is survivable, adding a vendor is a registry row, and "which provider is
working" has an answer.

## Request path

```
SafeHaul feature
  → shared AI task interface        functions/ai/tasks/
  → capability-aware provider router functions/ai/router/
  → provider adapter                 functions/ai/providers/
  → normalized, schema-validated response
  → requesting feature
```

Features import a **named task**, never a provider. There is deliberately no
generic "send any prompt" endpoint and no public AI callable: the set of prompts
SafeHaul can issue is fixed in `functions/ai/tasks/` at deploy time.

## Folder layout

| Path | Responsibility |
| --- | --- |
| `functions/ai/registry/` | The frozen provider table and the capability vocabulary. The only authority on which vendors exist. |
| `functions/ai/providers/` | One adapter per vendor. **The only place** permitted to know a wire format, base URL, auth header or response envelope. |
| `functions/ai/router/` | Eligibility, ordering, fallback, deadlines, error taxonomy. |
| `functions/ai/credentials/` | Secret Manager access and the non-secret provider config document. |
| `functions/ai/tasks/` | The narrow task interfaces features may call. The platform's whole public surface. |
| `functions/ai/knowledge/` | The approved SafeHaul capability package the blog writes from. |
| `functions/ai/telemetry/` | Safe operational records. |
| `functions/ai/validation/` | Strict JSON Schema validation of model output. |
| `functions/ai/callables.js` | Super Admin → AI Integrations callables. |

## Provider registry

`functions/ai/registry/providers.js` is frozen and declarative. Each row carries
provider id, display name, priority, docs URL, API base URL, adapter name,
capabilities, structured-output mode, credential fields, non-secret config
fields, default models per capability, timeout, retry policy, quota detection and
health-test method.

Three properties make it load-bearing rather than decorative:

1. **A provider id from a browser is only ever *looked up* here.** It is never
   concatenated into a Secret Manager name, a URL or a Firestore path. An id not
   in the table does not exist.
2. **`secretFields` derive the Secret Manager naming convention.** The browser
   never names a secret.
3. **`capabilities` is a hard gate in the router, not a hint.** A provider that
   does not declare `vision` can never be handed a CDL photograph.

## Capability matrix

| Provider | Text | Structured JSON | Vision | Multi-image | Long context | Structured mode |
| --- | :-: | :-: | :-: | :-: | :-: | --- |
| Groq | ✅ | ✅ | ✅ | ✅ | ✅ | Responses `json_schema` |
| Google Gemini | ✅ | ✅ | ✅ | ✅ | ✅ | Interactions `response_format` |
| Cloudflare Workers AI | ✅ | ✅ | — | — | — | prompt-carried |
| GitHub Models | ✅ | ✅ | — | — | — | *retired — never selected* |
| Mistral | ✅ | ✅ | ✅ | ✅ | ✅ | OpenAI `json_schema` |
| Cerebras | ✅ | ✅ | — | — | ✅ | OpenAI `json_schema` |
| SambaNova | ✅ | ✅ | — | — | ✅ | OpenAI `json_object` |
| OpenRouter | ✅ | ✅ | ✅ | ✅ | ✅ | OpenAI `json_schema` |
| Hugging Face | ✅ | ✅ | ✅ | — | ✅ | OpenAI `json_object` |

Text-capable providers also declare summarization, classification and
article-writing. `prompt-carried` and `json_object` modes cannot enforce a schema
server-side, so the schema is restated in the prompt — and in **every** mode the
router validates the parsed result, because "the vendor promised JSON" is not
evidence that it sent JSON.

Consequence worth stating: a CDL or E-Doc image task is eligible only for Groq,
Gemini, Mistral, OpenRouter and Hugging Face. Cloudflare, Cerebras and SambaNova
are skipped for image work by construction, not by configuration.

## Fallback order and behaviour

The documented default order, derived from `priority` so it lives in one place:

1. Groq
2. Google Gemini
3. Cloudflare Workers AI
4. GitHub Models *(retired — always skipped)*
5. Mistral
6. Cerebras
7. SambaNova
8. OpenRouter
9. Hugging Face

For each request the router determines the required capability, then walks the
order, skipping any provider that is retired, incapable, disabled, missing a
credential, missing a required non-secret setting, in cooldown, or has no
resolvable model. The first response that passes schema validation wins.

**Fails over on** timeout, network failure, provider outage, quota exhausted,
rate limit, unavailable model, malformed response, truncated output, a request
this vendor rejected, failed structured-output validation, and not-configured.

Two of those are deliberately distinct from `provider_unavailable` even though
all three fail over identically, because the category is what an operator reads
in the console and in telemetry:

- `output_truncated` — the model stopped before finishing, almost always the
  output budget. A known fix, not an outage.
- `provider_request_rejected` — a 400/422: SafeHaul's request was wrong *for this
  vendor*. Another vendor with a different shape may still succeed, so it stays
  retryable, but it will fail here identically forever. Labelling it
  "temporarily unavailable" points an operator at the vendor's status page
  instead of at us, which is exactly what happened while diagnosing the Gemini
  request-shape bugs below.

**Stops immediately on** an invalid SafeHaul request, a rejected authorization,
no capable provider, or the total deadline. Trying nine vendors would return the
same answer nine times and burn nine quotas.

**Bounds.** A per-provider timeout from the registry, a total request deadline
(120 s default), exactly one attempt per provider unless the registry marks a
retry safe (only Hugging Face does), a 5-minute cooldown after 3 consecutive
failures, and a 30-minute cooldown after a quota or rate-limit response.
Cooldown is persisted in Firestore rather than held in memory, because Cloud
Functions instances are ephemeral and independent — an in-memory counter would
let a dozen cold instances each rediscover the same exhausted quota.

**When everything fails** the caller gets a safe categorised error. Nothing is
fabricated.

## GitHub Models is retired

GitHub retired GitHub Models on **2026-07-30**: the playground, model catalogue,
inference API and bring-your-own-key access were withdrawn from all customers
([changelog](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/)).

The registry row is kept so the documented fallback order keeps its shape and so
the console can explain the gap, but the provider can never be selected,
configured or enabled. The router filters retired providers before eligibility;
the adapter throws as a backstop; `saveAiCredential` refuses it; the console
shows "Retired by vendor" with the reason and offers no actions.

If GitHub ever restores an inference API, clearing the `retired` field on the
row re-enables it. Nothing else needs to change.

## Gemini: the Interactions API shapes, and how they were got wrong

Gemini's `/v1beta/interactions` surface does **not** follow the
`:generateContent` conventions. The adapter originally used those conventions
throughout, and as a result *every* Gemini call failed in production — text,
structured JSON and vision alike — while the unit tests passed. The four
mistakes, and what the API actually requires:

| Field | Wrong (`:generateContent` style) | Correct | Failure it caused |
| --- | --- | --- | --- |
| response text | `payload.output[]` | **`payload.steps[]`** | `malformed_response` on a correct answer |
| `system_instruction` | `{ parts: [{ text }] }` | **plain string** | `400 Expected string, unexpected character: '{'` |
| `input` | `[{ role, parts: [...] }]` | **`[{ type: 'user_input', content: [...] }]`** | `400 Unknown parameter 'parts'` |
| image part | `{ inline_data: { mime_type, data } }` | **`{ type: 'image', mime_type, data }`** | `400 Unknown parameter 'inline_data'` |

`steps` mirrors the request's step list: an array of `{ type, content }`. A
`thought` step carries the model's private reasoning — usually only an opaque
`signature`, sometimes text — and **must never be concatenated into the
answer**, or it corrupts an article and breaks JSON the router is about to parse.
`extractText` skips it by type.

### Thinking tokens consume the output budget

Current Gemini models reason before answering, and those thought tokens are
charged against `max_output_tokens` alongside the visible reply. Measured live on
2026-08-03 with `gemini-3.6-flash`: a one-word answer used **83** thought tokens
by default and **58** at `thinking_level: low`; a 16-token budget produced 13
thought tokens, zero output tokens and `status: "incomplete"`.

Every other provider treats `maxOutputTokens` as visible output, so the Gemini
adapter adds `THINKING_HEADROOM_TOKENS` on top of the caller's number rather than
making one adapter mean something different by the same parameter. It is a
ceiling, not a spend.

`status: "incomplete"` with no text now raises `output_truncated`, not
`malformed_response` — the first names a budget problem with a known fix, the
second describes a symptom and hides the cause.

### Why the tests did not catch any of this

The adapter's tests invented their fixtures from the adapter's own assumptions:
they asserted an `output_text` field and the `parts`/`inline_data` request shape.
The API returns neither. **A test that asserts the code's beliefs back to it
cannot catch the code being wrong about the world.**

Provider fixtures in `aiProviders.test.js` must therefore be *captured from a
real response*, not written from reading the adapter. The Gemini fixtures are
recorded verbatim (ids and timings trimmed) with the capture date. This does not
weaken the rule that no test may contact a vendor — the capture is a manual,
one-off act by a human or agent, and the recording is what CI runs against.

## Credential storage

**Secrets** live in Google Secret Manager under a strict SafeHaul-owned
convention: `SAFEHAUL_AI_<PROVIDER>_<FIELD>`, for example
`SAFEHAUL_AI_GROQ_APIKEY`, `SAFEHAUL_AI_CLOUDFLARE_APITOKEN`. Media credentials
use `SAFEHAUL_AI_MEDIA_<PROVIDER>_<FIELD>`. The name is *derived* from the frozen
registry at runtime, and `assertSafehaulAiSecret` is an independent second check
on the final string, so no request can reach a secret outside the namespace.

**Non-secret settings** — enabled/disabled, Cloudflare's account id, model
overrides, health, cooldown and last-test results — live in
`ai_provider_config/{providerId}`, a server-only Firestore document denied to all
clients. `writeConfig` accepts only fields declared on the registry row and
validates declared patterns, so a malformed account id never reaches a URL.

**No plaintext token is ever written to Firestore.**

### Why runtime access, not deploy-time bindings

Credentials are read with the Secret Manager client rather than `secrets: [...]`
bindings, for two reasons: a binding to a secret that does not exist yet fails
the entire functions deploy, so adding a tenth provider would otherwise break CI
until someone created its secret; and a new or rotated credential takes effect
within the 60-second in-process cache instead of needing a redeploy.

## Groq migration

`GROQ_API_KEY` was the original deploy-time binding and is still used by working
production features. The migration is deliberately reversible.

1. On first deploy, nothing changes behaviourally: `resolveCredentials` prefers
   the managed credential and falls back to the legacy binding, so CDL and E-Doc
   parsing keep working before anyone migrates anything.
2. AI Integrations shows Groq as configured, with "Using the legacy deploy
   binding, not the managed credential."
3. **Migrate legacy key** copies the token into Secret Manager entirely
   server-side. The token is never returned to the browser, never logged, and
   never placed in a response — an operator can migrate without ever seeing it.
4. The migration verifies the new credential against Groq before reporting
   success. A migration that silently wrote a stale value would look fine right
   up until the next driver tried to auto-fill a licence.
5. The old binding is **left in place**. That is the rollback path and it needs
   no code change: destroy the managed credential and the router falls back.
6. The migration is idempotent — run twice, it reports `alreadyManaged`.

### Final cleanup, after production verification

Only once AI Integrations shows Groq on `secret-manager`, a connection test
passes, and CDL auto-fill and the AI Field Assistant have been exercised in
production:

1. Remove `'GROQ_API_KEY'` from the `secrets` arrays in `functions/cdlParser.js`,
   `functions/ai/callables.js`, `functions/blog/scheduler.js` and
   `functions/blog/callables.js`.
2. Remove the legacy branch in `functions/ai/credentials/store.js`
   (`resolveCredentials` and `revealCredential`).
3. Remove the `GROQ_API_KEY` row from `functions/environmentVault/registry.js`
   and its entry in `functions/test/unit/environmentRegistry.inventory.test.js`.
4. Delete the `GROQ_API_KEY` secret in Secret Manager.
5. Deploy, then re-verify both AI features.

Do not perform steps 1–4 in the same change as the migration itself.

## Current AI call sites

Every AI use in the repository, as of this document:

| Feature | Callable / entry point | Task | Capabilities | Privacy |
| --- | --- | --- | --- | --- |
| CDL photo auto-fill | `parseCdlWithGroq` (name retained for deployed clients) | `cdlExtraction` | vision + structured JSON | `restricted` |
| AI Field Assistant | `analyzeEdocFieldPlacement` | `edocFieldPlacement` | vision + structured JSON (+ multi-image for >1 page) | `restricted` |
| News & Insights topic choice | `publishScheduledBlogPosts` | `selectTopic` | text + structured JSON + classification | `public` |
| News & Insights drafting | `publishScheduledBlogPosts` | `articleGeneration` | article writing + structured JSON + long context | `public` |
| News & Insights fact check | `publishScheduledBlogPosts` | `verifyArticleClaims` | text + structured JSON + long context | `public` |
| Connection test | `testAiProvider` | `healthCheck` | provider's configured capability | constant prompt |

`parseCdlWithGroq` names a vendor that is now only the *first* provider tried. It
is a compatibility alias: deployed driver-application clients call it by that
name and renaming it would break every browser that has not reloaded.

The prompts and JSON schemas for CDL and E-Doc were carried over **verbatim**, so
the migration changed which vendor may answer, not what SafeHaul asks for or what
the wizard receives.

### Privacy

`restricted` covers anything containing a real person's documents. On those
paths nothing about the content is logged — not the prompt, not the response, not
an excerpt, and never the provider's own error body, because several vendors echo
the submitted prompt back inside their error strings. Only a category and a
provider id reach a log line.

Blog generation receives public internet material plus the approved SafeHaul
knowledge package, and never driver, applicant, employee or company-private data.

## Super Admin operation

**Super Admin → AI Integrations** lists all nine providers in fallback order
with status, capabilities, masked credentials, resolved models, last test,
cooldown state and actions. A separated **Research & Media** subsection manages
Pexels, Unsplash and Openverse credentials.

The page reuses the Environment & Integrations vault's guards and audit trail
rather than starting a parallel security model, so the same rules apply without
being re-argued: exact `globalRole === 'super_admin'` from the verified token,
recent authentication (15 minutes) for every reveal and mutation, fail-closed
per-operation rate limits, one credential per reveal, value-free audit records in
`environment_audit_log`, and safe generic errors.

Reveal behaviour: masked as `********` (fixed width, unrelated to the real
value), one revealed slot page-wide, cleared after 30 seconds, on a second press,
on another reveal, when the tab is hidden, and on unmount. Never written to
storage, a `data-` attribute, the URL, a log, analytics or the clipboard.

AI credentials also appear in **Environment & Integrations**, read-only, with
their rows *derived* from the same registry so the two consoles cannot disagree
about which credentials exist. Reveal, replace and delete belong to AI
Integrations; pointing at one owner keeps a single source of truth instead of two
consoles writing the same Secret Manager resource.

The rate-limit buckets are shared with the vault (`envvault_<operation>_<uid>`).
That is deliberate: both are super-admin credential surfaces, and one limiter is
easier to reason about than two. It is a stricter posture, not a weaker one.

## Adding or removing a provider

To add one:

1. Add a row to `functions/ai/registry/providers.js` with its capabilities,
   credential fields, models, timeout and quota detection.
2. Add an adapter in `functions/ai/providers/`. If the vendor speaks the OpenAI
   `/chat/completions` shape, `createOpenAiCompatibleAdapter` needs only a
   header builder.
3. Register the adapter in `functions/ai/providers/index.js`.
4. Add adapter tests to `functions/test/unit/aiProviders.test.js`.
5. Grant the runtime service account access to the new secret name (see
   [Manual actions](#manual-actions-required)).

Nothing else changes. The environment-vault inventory row, the console row, the
capability gating and the fallback position are all derived.

To remove one: delete the row and the adapter, or — if the vendor withdrew the
service — set `retired` instead, which keeps the documented order legible.

## Telemetry

`ai_telemetry` records task type, capability, provider, model, outcome category,
latency, fallback count, cooldown skips and credential source, with a 30-day
`expiresAt` for a Firestore TTL policy. The recorded fields are an allowlist:
anything not named is dropped rather than trusted.

Never recorded: credentials, prompts, CDL or document images, provider response
text, personal data, or article drafts.

## Emergency disable

- **One provider:** AI Integrations → **Disable**. The router skips it
  immediately; no deploy needed.
- **One provider's credential:** AI Integrations → **Delete**. Destroys every
  version and marks the provider unconfigured.
- **All AI:** disable every provider. Every AI task then returns
  `not_configured`, which the CDL and E-Doc callables surface as
  `failed-precondition` — the same behaviour as before any key was configured.
  Driver applications and document signing keep working; only the AI assists
  stop.
- **The blog only:** disable the schedule in Cloud Scheduler
  (`publishScheduledBlogPosts`). Published articles stay served.

## Provider outage recovery

1. AI Integrations shows the affected provider `Degraded` or in cooldown, and
   the recent-activity panel shows the failure category.
2. The router has already been failing over. If a *later* provider is serving
   traffic, nothing is broken.
3. When the vendor recovers, use **Test connection**. A pass clears the cooldown
   and restores its position; the cooldown also expires on its own.
4. If every capable provider is down, AI features return a safe error and the
   blog records `failed_generation` and retries on the next hourly run. No
   article is published with unverified content.

## Testing

No test in this repository contacts a real AI or image provider. Adapters take
an injected `fetchImpl`; tasks are mocked at the task boundary in feature tests.

| Suite | Covers |
| --- | --- |
| `functions/test/unit/aiRouter.test.js` | Ordering, capability gating, every fallback trigger, terminal categories, cooldown, no-loop, telemetry secrecy |
| `functions/test/unit/aiProviders.test.js` | All nine adapters: endpoint, auth header, structured mode, response envelope, HTTP classification, timeout, path-traversal refusal |
| `functions/test/unit/aiCredentials.test.js` | Secret naming, namespace refusal, lifecycle, legacy fallback, every callable's authorization, audit records, Groq migration |
| `functions/test/unit/cdlParser.test.js` | Callable contract preserved, guards ordered before AI spend, error mapping, log privacy |
| `functions/test/unit/edocFieldPlacement.test.js` | Callable contract preserved, clamping, dedup, category mapping, log privacy |
| `src/features/super-admin/views/AiIntegrationsView.contract.test.jsx` | Masking, one-at-a-time reveal, 30-second clear, no plaintext in DOM or storage, retired provider, re-authentication, typed delete |

## Manual actions required

These cannot be performed from the repository and must be done by a project
owner. **The feature is not fully live until they are.**

1. **Secret Manager IAM.** Grant the Cloud Functions runtime service account
   (`<project>@appspot.gserviceaccount.com`, or the configured runtime account):
   - `roles/secretmanager.secretAccessor` on secrets matching `SAFEHAUL_AI_*`
   - `roles/secretmanager.admin` (or `secretVersionManager` plus
     `secretmanager.secrets.create`) so the console can create secrets and
     destroy versions.

   Without the first, every provider reads as unconfigured. Without the second,
   add and delete fail with a permission error.

2. **Cloud Scheduler.** `publishScheduledBlogPosts` creates its job on first
   functions deploy. Confirm it exists, runs hourly at minute 15, and is pinned
   to `America/Chicago`.

3. **Deploy planner inclusion.** Add `publishScheduledBlogPosts` and
   `serveBlogPublic` to `DEPLOY_FUNCTIONS_ALWAYS_INCLUDE` in
   `.github/workflows/main.yml` if they should deploy on every run.

4. **Provider credentials.** No AI provider ships with a key. Until at least one
   capable provider is configured in AI Integrations, AI features return
   `failed-precondition` and the blog publishes nothing. Groq is covered by the
   legacy binding until migrated.

5. **Media credentials (optional).** Without Pexels or Unsplash, articles use
   the approved local fallback image. Openverse works without a credential.

## Related files

- [`functions/ai/registry/providers.js`](../functions/ai/registry/providers.js)
- [`functions/ai/router/router.js`](../functions/ai/router/router.js)
- [`scripts/check-ai-provider-boundary.mjs`](../scripts/check-ai-provider-boundary.mjs)
- [`docs/news-and-insights.md`](./news-and-insights.md)
- [`docs/security-posture.md`](./security-posture.md)
- [`docs/environment-and-integrations-runbook.md`](./environment-and-integrations-runbook.md)
