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
fields, timeout, retry policy, quota detection and health-test method. The
model versions a row is asked for, per capability and in order, live beside it
in `registry/modelVersions.js`; `resolveModels()` returns a lane's list (or the
operator's override alone), and `defaultModels` / `resolveModel()` are its first
entry.

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
| Groq | ✅ | ✅ | ✅ | ✅ (max 5) | ✅ | Responses `json_schema`; **`json_object` on the image lanes** |
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

### Structured-output mode can differ *within* one provider

Groq is the reason `structuredModeByCapability` exists. Its schema support is a
property of the **model**, not the vendor. The `openai/gpt-oss-*` models accept
`json_schema`; `qwen/qwen3.6-27b`, Groq's image model until 2026-10-07, answered
a schema request with a 400, so its image lanes sent `{ type: 'json_object' }`
with the schema restated in the prompt.

`qwen/qwen3.8-27b`, which replaced it, accepts `json_schema` with images —
verified live on the CDL, medical card, PSP, MVR and E-Doc schemas — so every
Groq lane now sends `text.format = { type: 'json_schema', … }` and Groq enforces
the shape. The override remains for the next model that needs object mode. In
every mode the router validates the parsed result as well.

This is worth stating plainly because "turn the vision capability on" would have
produced a 400 on every CDL photograph. A capability flag is a claim about the
resolved model *and* the request shape SafeHaul sends it.

Consequence worth stating: a CDL or E-Doc image task is eligible for Gemini,
Groq, Mistral, OpenRouter and — for single images only — Hugging Face.
Cloudflare, Cerebras and SambaNova are skipped for image work by construction,
not by configuration, and no amount of reordering changes that.

### Model pins rot, and only the vendor can tell you

On 2026-08-17 an audit found six pins naming models their vendors had retired:

| Provider | Lane | Pin | Vendor status |
| --- | --- | --- | --- |
| Mistral | vision | `pixtral-12b-latest` | retired 2025-12-31 |
| Mistral | multi-image | `pixtral-large-latest` | retired 2026-05-31 |
| OpenRouter | vision, multi-image | `meta-llama/llama-4-scout-17b-16e-instruct` | never an OpenRouter slug; it lists `meta-llama/llama-4-scout` |
| Cerebras | every lane | `llama-3.3-70b`, `llama3.1-8b` | absent from the catalogue |
| Cloudflare | classification | `@cf/meta/llama-3.1-8b-instruct` | deprecated |
| SambaNova | classification | `Meta-Llama-3.1-8B-Instruct` | delisted |

Nothing in the repository could have caught this. Fixtures cannot know what a
vendor withdrew, and a pin is only a string until a request is made with it. The
effect was that CDL and E-Doc multi-page work fell to Gemini alone, behind a
20-request free-tier cap, with eight other providers configured and unable to
help — which is what "AI is unreliable" looked like from a driver's seat.

**`diagnoseAiModelPins`** (Super Admin → AI Integrations → *Verify model pins*)
is the standing guard: it asks each configured vendor's catalogue endpoint,
server-side with the managed credential, whether the pinned names — every
version in each lane's list, spares included — still resolve.
It is deliberately not in CI and not on a schedule — it needs real credentials.
Where a vendor publishes no readable catalogue it reports "unsupported" rather
than guessing, and an unreachable one reports "unreachable"; both are honest
answers where "ok" would be a lie.

### Verified live against the vendors, 2026-08-19

The registry's pins, capability flags and request shapes were checked against the
three configured vendors with SafeHaul's **exact** request shapes, using
credentials supplied for the purpose and used read-only. Recorded because the
alternative is re-litigating the same guesses.

| Provider | Pin | Request shape | Vision result |
| --- | --- | --- | --- |
| Gemini | `gemini-3.6-flash` present in the catalogue | `/v1beta/interactions`, plain-string `system_instruction`, `input:[{type:'user_input'}]`, `{type:'image',mime_type,data}`, `response_format` — all correct; `extractText`'s `steps[]` / `model_output` handling matches the live envelope | 256x256 read correctly (`"red"`, 1,089 image tokens) |
| Mistral | `mistral-large-latest` → `mistral-large-2512`, catalogue declares `vision: true` | OpenAI-compatible `chat/completions`, nested `image_url:{url}`, `json_schema` `strict:true` — accepted | 256x256 read correctly; multi-image "name the SECOND image" answered `blue` |
| Groq | `qwen/qwen3.6-27b` | `/openai/v1/responses`, `input_image` with a base64 data URL, `text.format:{type:'json_object'}` — accepted | 64x64 two-tone read correctly (`{"dark_half":"top"}`) |

**Every pin, capability flag and request shape checked was correct, and no
provider configuration change was warranted.** The reported failures came from
the platform's own diagnostics — probe image size, a connection test spending the
tier it was testing, a body marker outranking a status code, and a 30-minute
cooldown for a 45-second cap — plus one episode of genuine transient vendor
capacity (Groq's preview vision model returned `503 … currently over capacity`).

**One genuine quota finding, and its limit is small:** Gemini's free tier caps at
20 requests per minute and clears in under a minute. Nothing here supports
upgrading or paying for a provider, and no such recommendation is made.

The keys used for this were pasted into a working session and should be treated
as disclosed. Rotate them.

### Free-tier follow-up, 2026-09-03

The verification above used paid entitlements. A carrier on Mistral's **free**
tier hits a wall the audit could not see: `mistral-large-latest` is paid-tier
only. A free key returns `403 tier_not_allowed` for it, and Large is not even
listed in that account's catalogue — so every Mistral lane 403'd and the
connection test reported all six capabilities as failed, on a key that
authenticates and does inference.

Two changes, both verified against the live API on a free key:

- **Mistral is pinned to `mistral-medium-latest`** on every lane. Medium is
  vision-capable with structured output and long context, and on the free
  entitlement it read a CDL photo, a PSP page image, and PSP/MVR/medical text
  into the extraction schema. (`mistral-small-latest` passed the same checks and
  is the lighter alternative; there is no per-tier config, so the default targets
  the tier a free key actually has.)
- **The health-check probe images are regenerated as standard PNGs.** Mistral's
  newer models reject the previous hand-rolled minimal PNG with `400
  invalid_request_file` while reading a properly zlib-compressed PNG of the same
  pixels — so the probes now emit conformant images (`solidColorPng`), or the
  connection test would report a false "vision failed" for a provider that works.

### Pins retired again, 2026-10-07

Every AI reading feature stopped at once, because all three configured vendors
had changed something under their single pin per lane. Checked live with the
owner's keys through SafeHaul's own adapters:

| Provider | Old pin | What the vendor answered | New pin |
| --- | --- | --- | --- |
| Groq (photos) | `qwen/qwen3.6-27b` | `404 model_not_found` | `qwen/qwen3.8-27b` |
| Mistral (every lane) | `mistral-medium-latest` | `429`, `x-ratelimit-limit-req-minute: 0` on the free plan (Small too; Large is `403 tier_not_allowed`) | `ministral-14b-2512`; articles `ministral-8b-2512` |
| Gemini | `gemini-3.6-flash` | `503` "high demand" (3.5, 3.7 and 3.8 Flash too; the Lite versions answered) | unchanged |

- `qwen/qwen3.8-27b` read a CDL photo and two at once, in schema mode (see
  "Structured-output mode can differ *within* one provider"). It takes **three**
  images per request (`400 "This model supports up to 3 images"`), so Groq's
  `maxImages` is 3 and a four- or five-page document goes to the next provider.
  A photo costs about 1,800 input tokens against the free tier's 7,000 input
  tokens a minute, so about one two-photo licence read a minute fits.
- `ministral-14b-2512` read a CDL photo, two and five at once, and answered the
  claim check in about 4s. It took 33–48s to write an article against Mistral's
  45s timeout, so `ARTICLE_WRITING` resolves to `ministral-8b-2512` (9s).
- With one model per lane, any such vendor change was an outage for that
  provider. The re-pin restored service; spare versions (next section) are
  what changes it.

### Spare versions

Each lane now holds an ordered list of up to three verified versions
(`registry/modelVersions.js`), and a failure about *one version* moves to the
next version of the same provider before the provider's turn ends. The rules
are one table in `router/versionPolicy.js`:

| Failure | Next version? | That version rests |
| --- | --- | --- |
| `model_unavailable`: 404, a limit of zero, a tier, Labs or unknown-model refusal | yes | 24 h |
| `rate_limited` (429) | yes, without waiting | the stated wait, 1–10 min |
| `provider_request_rejected` (400/422) | yes | no: the image may be at fault |
| `provider_unavailable` (5xx) | only for work without a per-attempt ceiling | no |
| `timeout` | no | 10 min, only after a full slice |
| `unauthorized`, `quota_exceeded`, `network`, unusable answers | no | no |

- **Whose problem it is decides.** A gone, plan-restricted or rate-limited
  version says nothing about its siblings, so the next one is asked at once. An
  overloaded vendor's other versions are struggling too: on 2026-10-07
  `gemini-3.5-flash-lite` took 13–16 s to read a licence while the Flash
  versions answered 503, against 1–2 s on Groq. So a document read goes to the
  next provider, and only work with time to spare (articles, E-Doc placement)
  tries the overloaded vendor's other versions.
- **A limit of zero and a tier refusal are not quotas.** `providers/http.js`
  reads Mistral's `x-ratelimit-limit-req-minute: 0` (the literal `0`; a missing
  header is not zero), Gemini's `limit: 0` in a quota error, and the 400/403
  codes a row lists in `versionRefusalCodes` (Mistral: `1910`/`tier_not_allowed`,
  `1913`/`labs_not_enabled`, and `invalid_model`, its 400 for a model id it no
  longer knows), and reports them as `model_unavailable`. They no
  longer earn the provider-wide 30-minute quota cooldown, and Test connection
  reports them as Failed rather than Throttled.
- **A switch has to fit.** Under a per-attempt ceiling, a switch (like a retry)
  needs two full slices left: the next version's and a fallback's. A licence
  read (45 s / 20 s) can therefore switch in its first 5 s, which the fast
  refusals above always are; a medical card or report (45 s / 25 s) switches
  only on the next request, through the rest.
- **Rests.** A failed version rests in the lane it failed in
  (`ai_provider_config/{id}.versionRest`, one entry per lane and version under
  a hashed key), written with the turn's one `recordProviderOutcome`, and only
  in a lane with more than one version. Eligibility leaves resting versions out;
  when every version of a lane rests, all are tried, soonest-recovering first,
  so rests alone never shut a provider out. A version that answers clears its
  own rest; **Clear cooldown** clears them all.
- **One outcome per turn.** A provider's lane cooldown and its quota cooldown
  still count turns, so they start only when no version answered.
- **A document read does not sit through a long stated wait.** Under a
  per-attempt ceiling a vendor's "retry in N seconds" is honoured in place only
  up to 5 s (`INTERACTIVE_MAX_WAIT_MS`), Hugging Face's registry retry
  included; a longer wait sends the read to the next provider at once. Groq
  states 7–25 s on a spent per-minute token budget, which a driver used to wait
  out while Mistral could have answered. Work without a ceiling still waits, up
  to 30 s.
- **Test connection walks the versions too**, under the same table, and says
  "Passed using X after Y failed" when a spare answered. It neither reads nor
  writes rests, and switches only while the test's 150 s budget still holds a
  full probe.

The lists as verified on 2026-10-07: Gemini adds `gemini-3.5-flash-lite` for
photos and structured text (it rejects the article request with a 400, and
`gemini-3.5-flash` answered 503 to every check that day, so neither is an
article spare); Groq adds `openai/gpt-oss-120b` to every text lane, articles
included; Mistral adds `ministral-8b-2512` and, last, `mistral-medium-latest`
for a paid plan.

### Where a lane's versions come from

`resolveModels` in `registry/providers.js` decides, in this order:

1. **An operator override** (a row's `configFields` with `appliesTo`): the one
   model an account can reach, alone.
2. **A saved list** in the provider's `ai_provider_config/{id}.modelLists`
   (`registry/savedModels.js`): `modelLists.vision.models` for photos,
   `modelLists.text.models` for text and structured output. It is read with the
   rest of the provider's config, so a Firestore fault falls back to the router's
   last known configs. Whatever is malformed reads as nothing saved: an id not
   shaped like a model id is dropped, each id counts once, and a list keeps at
   most three. Article writing is never taken from a saved list.
3. **The built-in list** in `registry/modelVersions.js`.

Rests, the switching table and Test connection apply to a saved list exactly as
to a built-in one.

### The daily model check

`refreshAiModelLists` (`ops/modelRefresh.js`, every hour at :25 Chicago) keeps
the saved lists true without a programmer. A provider is checked when it is
due: daily at about 03:25 (and at any hour after 36 h), on the first run after
it is set up, and within the hour of the router recording a new failure in one
of its lanes (`laneHealth`, begun at `laneFailedAt`), then at most every 6 h
while it lasts. Only enabled, configured,
unretired providers, only the lanes they already serve, and never a lane an
operator chose a model for by hand.

For each lane (`ai/tasks/modelCheck.js`):

1. The vendor's catalogue (`ai/tasks/modelCatalogue.js`, shared with the
   model-pin diagnostic; Gemini is read with `pageSize=1000`) says which of the
   lane's versions still exist. One it no longer lists is out without a test.
2. Each remaining version takes the lane's test through its adapter, not the
   router, so the check moves no health, cooldown or rest
   (`ai/tasks/modelVerification.js`). **Photos:** the licence read exactly as a
   driver's is, on a made-up licence (`ai/tasks/verification/cdl-specimen.jpg`,
   its SHA-256 pinned in `aiModelVerification.test.js`). It passes only by
   reading all six fields right. **Text:** the structured-JSON probe.
3. While the lane has room (three at most), new names from the catalogue are
   tried, two per lane per run, in the order of `registry/modelCandidates.js`:
   stable names only, never a preview or a `-latest` alias.
4. The list is decided (`decideLane`). A version leaves only for a reason about
   itself: gone, read the licence wrong, refused the request. A busy vendor, a
   refused key or a spent allowance keeps it in place. A version joins only by
   passing. The order of the versions that stay never changes, and a lane is
   never emptied: if nothing passes, the list stays and the lane is reported as
   failing.

A refused key or spent allowance stops that provider's check. At most ten tests
a provider a run, 1.2 s apart (Mistral's free plan allows one request a second),
and none started after 400 s; providers run in parallel. A lease in
`ai_routing_config/modelCheck` keeps runs from overlapping, and
`autoSelect: false` there makes the check report without changing anything.

Results go to the provider's config: `modelLists.<lane>` when a list changed,
and `modelCheck` (when, why, what each version did) for the console. The owner
hears in Telegram when a list changed, when a lane stops or starts passing, and
when a key or allowance fails, with what to do (`ops/modelRefreshMessages.js`).
A state is told once, on the change, to the chat that heard it
(`modelCheck.notified.destination`): a chat connected later hears what is still
wrong. A list change that could not be sent waits in `modelCheck.pendingNews`
and goes with the provider's next check. With no chat connected nothing is sent.

The hourly watcher (`watchAiAndBlog`) runs whether or not a chat is connected:
its probes go through the router, so a provider that fails them is recorded,
and the model check takes it up within the hour.

## Fallback order and behaviour

The **default** order, derived from `priority` so it lives in one place:

1. Google Gemini
2. Groq
3. Cloudflare Workers AI
4. GitHub Models *(retired — always skipped)*
5. Mistral
6. Cerebras
7. SambaNova
8. OpenRouter
9. Hugging Face

Gemini leads and Groq is the fallback. The original brief specified Groq first;
the owner reversed it on 2026-08-03 after measurement — on the free tiers Groq's
model writes 175–213 word articles against Gemini's 311–417, while Gemini's
20-request cap makes it the less *available* of the two. Gemini for quality,
Groq for availability.

### An operator can change the order

Since 2026-08-08 that list is the default rather than necessarily the effective
order. A Super Admin can reorder providers from **Super Admin → AI
Integrations**, and the chosen order is stored in the server-only Firestore
document `ai_routing_config/order` as a single `providerIds` array — one
document, so a reorder is one atomic write rather than nine.

`functions/ai/router/order.js` applies it, and its contract is what makes it
safe to put in front of every AI request:

- providers named in the stored order come first, in that order;
- providers the list does not name follow, in registry `priority` order, so a
  partial list is a valid list and a newly added provider needs no re-save;
- ids not in the registry are ignored and a repeated id keeps its first place;
- **a missing, empty, unreadable or malformed document yields the registry
  order.** `orderProviders` cannot return an empty list from a non-empty
  registry and `readProviderOrder` cannot throw. Deleting the document restores
  the default; it does not switch AI off.

Ordering is applied *before* eligibility, so everything below still applies
afterwards. Promoting a provider cannot make it serve a task it is incapable of,
re-enable a disabled one, or lift a cooldown.

Changing it goes through the `setAiProviderPriority` callable, which reuses the
vault's guards — exact `globalRole === 'super_admin'`, 15-minute recent
authentication, the fail-closed mutate budget — validates every submitted id
against the frozen registry, and writes a value-free row to
`environment_audit_log` recording who set which order. An unknown or repeated id
rejects the whole write rather than being dropped, because silently discarding
one would shrink the routing order without telling the operator.

`listAiProviders` returns the effective order alongside the rows (`rank` per
provider, plus a `routing.lanes` summary from the router's own
`describeRouting`), so the console can say *why* an enabled provider is being
skipped for a given kind of task rather than only showing a number.

For each request the router determines the required capability, then walks the
effective order, skipping any provider that is retired, incapable, disabled,
missing a credential, missing a required non-secret setting, in cooldown, or has
no resolvable model. The first response that passes schema validation wins.

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

**Stops immediately on** exactly four *task-fatal* categories: an invalid
SafeHaul request, no capable provider, the total deadline, and
`all_providers_failed`. Every vendor would answer the first two identically, and
the last two mean there is no time or nothing left to try.

### Infrastructure faults are one provider's problem, not the task's

`evaluateProvider` reads Secret Manager, and `credentials/secretManager.js`
re-throws anything that is not NOT_FOUND — `PERMISSION_DENIED` when the runtime
service account has lost `secretAccessor`, `UNAVAILABLE`, a project quota error.
That is right *there*: a real infrastructure fault must never be misread as
"this provider has no credential".

It was wrong here. The provider walk had no `catch`, only a `finally`, so the
exception escaped `runAiTask` raw: **no telemetry row, no categorised error, and
no attempt at any remaining provider.** A single missing IAM binding read as a
total, silent AI outage — the same defect already fixed once for `unauthorized`
and `internal`, arriving through a different door. It is the most likely single
explanation for "AI stopped working entirely", and it is the first thing to
suspect if that recurs.

Now: `safeEvaluateProvider` records the fault as a `credential_error` skip
against that provider and the walk continues. Anything else escaping the walk is
wrapped into a categorised `AiError` with telemetry, so an uncategorised
exception can never reach a callable.

The stored routing *order* degrades to the registry order — an unreadable
preference must never stop AI working, and the registry order is always valid.

Provider **config** is treated differently, and the distinction is the point.
An empty config map is not neutral: absent config reads as `{ enabled: true }`,
so falling back to one would silently **re-enable every provider an operator had
disabled**, on paths carrying `restricted` CDL and document images.
`setAiProviderEnabled` promises the opposite. So `resolveConfigs` reuses the last
configuration the instance actually read, and a cold instance with nothing cached
skips every provider with `config_unavailable` rather than guessing. Failing
closed there is not a regression — the previous behaviour was to throw — but the
caller now gets a categorised error and a telemetry row instead of an uncaught
exception.

A deadline is also now reported as `deadline_exceeded` rather than being
overwritten with `not_configured`, which used to send operators to check
credentials that were never the problem.

### Task deadlines sit below the function timeout

Neither CDL nor E-Doc set `totalDeadlineMs`, so both inherited the router's 120s
default. `parseCdlWithGroq` is deployed with a 60s timeout, so a slow fallback
chain was killed mid-walk: the driver saw a generic function timeout instead of
the mapped `unavailable` error, and no telemetry was written — the failures
hardest to diagnose were the ones that recorded nothing.

CDL now gets 45s against a 60s function; E-Doc 100s against 120s. Both function
timeouts are named constants and the tests assert at least 10s of headroom,
because the relationship broke while the two numbers were literals in separate
files.

Every task that reads a driver's document also caps one provider's attempt below
its total: 20s for a CDL photo or the carrier's text reader, 25s for a medical
card, PSP report or MVR of up to five pages. The first provider in the order has
a 45s timeout of its own, the whole budget, so without the cap a stalled one
spent it all: the read timed out with other providers unused, and the total
deadline, being task-fatal, ended the walk before the stall could count against
that provider, so the next request waited on it again. With the cap a stall is a
`timeout`, which fails over and is recorded like any other failure, and a
provider whose policy allows a retry (Hugging Face) retries only when a full
slice would still be left for the next provider. `aiReadingDeadlines.test.js`
pins the cap on each of them.

### "Do not retry this provider" is not "do not try the others"

`retryable: false` answers only the first question. The router originally treated
it as answering both, and that was a real defect worth stating plainly:

- **`unauthorized`** is *one vendor's* key being wrong, expired or revoked. Eight
  other vendors with working keys are unaffected.
- **`internal`** is the catch-all assigned to *any* exception an adapter raises
  that is not an `AiError` — a `TypeError`, a bad property access, a parse slip.

Because Groq was priority 1 at the time, either of those aborted the chain
before Gemini was
reached, and the platform behaved as though no provider were configured while
reporting an error that blamed the request. A nine-provider fallback order that
one bad key can switch off is not a fallback order.

Both now end that provider's turn, are recorded against it, and the router
continues down the order. The provider is *not* retried — hammering a vendor that
just rejected the credential is pointless — it is simply skipped.

`isTaskFatal()` in `router/errors.js` is the single place that distinction lives.
`aiRouter.test.js` pins failover for `unauthorized` and for a raw `TypeError`,
and pins that `invalid_request` still stops on the first provider.

Measured impact: with a Groq `401` and a working Gemini, the blog pipeline went
from `failed_generation (unauthorized)` and zero articles to publishing normally,
against the same inputs.

**Bounds.** A per-provider timeout from the registry, a total request deadline
(120 s default), exactly one attempt per model version unless the registry marks
a retry safe (only Hugging Face does), at most three versions per lane (see
"Spare versions"), a 5-minute cooldown after 3 consecutive failed turns in a
lane, and a quota or rate-limit cooldown **sized to the wait the vendor stated**,
bounded by the same 30-minute ceiling. Cooldowns and version rests are persisted
in Firestore rather than held in memory, because Cloud Functions instances are
ephemeral and independent — an in-memory counter would let a dozen cold instances
each rediscover the same exhausted quota.

**When everything fails** the caller gets a safe categorised error. Nothing is
fabricated.

### What the person who asked is told

`failureKind` in `router/errors.js` reads a failure as one of four words, and the
CDL, report-import, document-reader and E-Doc callables word their messages from
it, so they agree on what a failure means:

- `unavailable`: the services failed, or every provider able to do the task is
  resting in a cooldown. The message says to try again in a few minutes or to
  enter the details by hand.
- `unreadable`: every provider tried answered, and none in a usable shape.
- `not_configured`: nothing is set up to do this.
- `failed`: anything else, such as a SafeHaul bug. The message blames neither
  the services nor the document.

`all_providers_failed` cannot say which it is, so the router attaches each
provider's category to it (`failureCategories`) and the trail decides: all
unusable answers is `unreadable`, any outage on it is `unavailable`, and a trail
with no outage (every adapter threw, every vendor rejected the request) is
`failed`, because waiting will not fix a bug. The callables used to read it as
the document's fault: a driver whose photo was fine, during an outage, was asked
for "a clearer photo". A walk that
found every capable provider cooling down now ends `provider_unavailable`, not
`not_configured`, which told a driver that AI was "not configured on the server"
and sent an operator to check keys.

In the browser, `aiReadErrorMessage` shows the callable's sentence and replaces
a bare code the server never sent ("deadline-exceeded", "internal", or the
status the runtime sends for an unhandled error, "INTERNAL") with the caller's
own words. A CDL photo that is kept as the CDL front says auto-fill did
not work, not that the licence could not be read.

### A cooldown sized to the vendor's cap, not to a round number

The quota cooldown was a flat 30 minutes. Gemini's free tier is 20 requests per
*minute*, and it says so:

```
Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests,
limit: 20, model: gemini-3.6-flash
Please retry in 44.26781542s.
```

Forty-five seconds of vendor cap was costing thirty minutes of the highest-ranked
provider being unavailable in every lane. That is the whole of "Gemini has
accumulated repeated failures while still passing basic text": the platform
over-reacting to a cap that clears in under a minute, not an exhausted allowance.

`readStatedRetryMs` now reads the wait from the response **body** as well as the
`Retry-After` header — Gemini states it only in the body, so the one number that
sizes the cooldown correctly was being discarded — and the cooldown becomes that
wait plus a small buffer, floored at 5s and capped at the existing ceiling.

### A body marker must not outrank a status code

`categorizeHttpFailure` consulted `quotaDetection.bodyMarkers` for **any** status
at or above 400, before mapping 400, 401 or 404. The markers include `quota`,
`rate limit` and `insufficient`, so a request-shape error or an auth error whose
body merely contained one of those words was relabelled `quota_exceeded`, earned a
cooldown, and told the operator to buy capacity. That is the mechanism that
manufactures a false quota diagnosis, and it is why the owner's own reading of
the logs pointed at free tiers.

The order is now: the vendor's own declared statuses decide first; then 401/403 →
`unauthorized`, 404 → `model_unavailable`, 400/422 → `provider_request_rejected`,
5xx → `provider_unavailable`; body markers are consulted only for other 4xx. A
vendor that signals exhaustion with a 402 still earns a quota cooldown — that is
a declared status, and it is deliberate.

### Health is per lane, because the lanes fail independently

`recordProviderOutcome` kept one `health` value and one `consecutiveFailures`
counter per provider. Two consequences, both of them reported symptoms:

- any text success flipped `health` back to `healthy` while the provider's vision
  lane was rejecting every CDL photograph — "healthy while important capabilities
  are failing";
- three vision failures cooled the provider out of the **text** lane as well.

A provider's text and image work reach different models on different
entitlements. So health and the failure counter are now per lane (`text`,
`vision`, from `laneForCapability`), the router's cooldown check is lane-scoped,
and the console shows a badge per lane. Quota and rate-limit cooldowns stay
provider-wide, because a vendor allowance is account-wide.

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

### Absent and unreadable are different faults

`readCredentials` reports them separately — `missing` for a secret that is not
there, `unreadable` for one this runtime cannot read — and never collapses one
into the other. It used to. Three separate places swallowed a read failure into
"no credential configured":

- `resolveCredentials` returned `{ complete: false }` with no reason;
- `buildProviderRow` turned that into **"Not configured — Needs API key"** on the
  AI Integrations row, while the routing panel on the same page said
  `credential_error`, so one screen contradicted itself;
- `buildTerminalFailure` had no branch for an all-`credential_error` walk and
  fell through to `not_configured`, which `cdlParser` mapped to "AI auto-fill is
  not configured on the server." — a message `useCdlAutoFill` shows verbatim, so
  **a driver mid-application** was told about our IAM.

An IAM fault and a missing key need opposite actions, and the operator was being
sent to add a credential that already existed. The category is now carried all
the way: `credential_error` is terminal and task-fatal, the console row reads
"Credential unreadable", and the driver sees "AI auto-fill is temporarily
unavailable. Please enter your licence details manually."

`saveAiCredential` also reads the credential straight back after writing it, so
the console can no longer create a secret it cannot then read — which is exactly
what happens when a new secret is created without an IAM binding.

### The runtime identity is not the same on every AI entry point

This is worth stating plainly because it produces the confusing symptom where
one AI feature works and another reports no credential on the same deploy.

| Entry point | Generation | Default runtime service account |
| --- | --- | --- |
| `parseCdlWithGroq` (CDL auto-fill), the four guest draft callables | 1st | `<project>@appspot.gserviceaccount.com` (App Engine default) |
| E-Doc field placement, every AI Integrations callable, the blog | 2nd | `725898258453-compute@developer.gserviceaccount.com` (Compute Engine default) |

There is no `setGlobalOptions({ serviceAccountEmail })` anywhere in the
repository, so both defaults are in play, and **both need
`roles/secretmanager.secretAccessor`**. Granting it to the App Engine account
alone — which is what this document used to instruct — leaves every 2nd-generation
AI feature unable to read a credential the 1st-generation one reads fine.

Unifying the two identities was considered and deliberately **not** done:
`bulkActions/services/queueService.js` relies on the App Engine account for Cloud
Tasks OIDC, so changing every 2nd-generation function's identity is a separate
change needing its own justification. Grant both, and make the mismatch visible
instead — which is what the diagnostic below is for.

### The credential-access diagnostic

Super Admin → AI Integrations → **Check credential access** answers, per provider
secret: does it exist, can *this runtime* read it, and if not, why —
`permission_denied`, `unauthenticated`, `resource_exhausted` or `unavailable`,
mapped from the gRPC status rather than guessed from a message. It also reports
**the service account actually in use**, read from the metadata server, so nobody
has to infer it from a generation table.

It is asked of **both** generations —`diagnoseAiCredentialAccess` (2nd) and
`diagnoseAiCredentialAccessV1` (1st) — and the two answers are shown side by
side, because a per-generation difference is the fault being looked for. The
browser calls them with `Promise.allSettled`, so one generation failing still
shows the other.

`exists` is `null`, not `false`, when the runtime is refused permission to check:
"we could not look" is an honest answer and reporting it as absence is how this
whole class of confusion started. No credential value is read, returned or
logged — the diagnostic only ever reports whether a read succeeded.

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

   The fallback covers a **failed** managed read as well as an absent secret.
   That was the gap: `readSecret` re-throws anything that is not NOT_FOUND, so a
   `PERMISSION_DENIED` threw before the fallback branch was ever reached — the
   rollback path did not protect production in the one failure mode it exists
   for. A fallback taken after a read failure reports
   `source: 'legacy-env-after-read-failure'`, and the console says so, because
   running on the legacy binding *because the managed read is broken* is a
   different situation from not having migrated yet.
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
| Applicant's own PSP report or MVR import | `extractApplicationReport` | `reportExtraction` | vision + structured JSON (+ multi-image for >1 page) | `restricted` |
| Carrier's document reader | `extractCompanyApplicationDocuments` | `applicationDocumentExtraction`, then `cdlExtraction`, `medicalCardExtraction` or `reportExtraction` for a document its text did not cover | text + structured JSON + long context; vision for the fallback (+ multi-image for >1 page) | `restricted` |
| News & Insights drafting | `publishScheduledBlogPosts` | `articleGeneration` | article writing + structured JSON + long context | `public` |
| News & Insights fact check | `publishScheduledBlogPosts` | `verifyArticleClaims` | text + structured JSON + long context | `public` |
| Connection test | `testAiProvider` | `healthCheck` | every capability the provider declares | constant prompts, generated images |
| Hourly watcher (Telegram alerts) | `watchAiAndBlog` (scheduled, `functions/ops/watcher.js`) | a `health_check` task through the router, one per lane | vision + structured JSON; text + structured JSON | constant prompts, a generated image |
| Model pin check | `diagnoseAiModelPins` | — | none (catalogue listing only) | no prompt at all |
| AI logs | `listAiTelemetry` | — | none (reads `ai_telemetry`) | metadata only |
| Credential access check | `diagnoseAiCredentialAccess` (2nd gen) and `diagnoseAiCredentialAccessV1` (1st gen) | — | none (Secret Manager reachability only) | no prompt at all; no credential value read |
| Publication runs | `listBlogRuns` | — | none (reads `blog_runs`) | metadata only |

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
with status, capabilities, masked credentials, resolved models, per-lane health,
last test — including the stored per-capability results, so a reload no longer
reduces them to a bare *Failed* — cooldown state and actions. A separated
**Research & Media** subsection manages Pexels, Unsplash and Openverse
credentials.

**Check credential access** is the first thing to reach for when a provider
reports a credential problem: it names the runtime service account in use and,
per secret, whether it exists and whether this runtime can read it — asked of both
function generations. See
[The credential-access diagnostic](#the-credential-access-diagnostic).

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

## Telemetry and the Logs tab

### One document per transaction

`ai_telemetry` used to record exactly one row per task, written on final success
or terminal failure. Every intermediate provider failure existed nowhere: a
fallback chain's causes survived only inside the `all_providers_failed` message
string and as counters on `ai_provider_config`. An operator could see that CDL
extraction failed and not which providers were tried, in what order, or why each
declined.

One document now carries the whole transaction:

| Field | What it answers |
| --- | --- |
| `transactionId` | correlation. Returned to the caller, so a Cloud Logging line and a Logs row can be matched by an engineer |
| `taskType`, `requiredCapabilities`, `capability` | which SafeHaul feature, and what it needed |
| `outcome`, `category`, `latencyMs`, `fallbackCount` | what happened overall |
| `providerId`, `model`, `credentialSource` | who finally served it |
| `verdict` | what the task's answer actually **said**, when the task supplies one |
| `inputSummary` | a **shape** description — see below |
| `attempts[]` | the timeline, bounded at 12 entries |

Each attempt records `providerId`, `model`, `attemptNumber`, `status`
(`attempted` / `skipped`), `skipReason`, `success`, `category`, `vendorCode`,
`httpStatus`, `latencyMs`, `retryAfterMs`, `schemaValid`, `inputTokens` /
`outputTokens`, and `nextProviderId` — enough to say why fallback happened and
where it went.

**Super Admin → AI Integrations → Logs** renders this: one row per transaction,
filterable by feature, outcome, provider, free text and date, with quick filters
for All / Errors / CDL / E-Docs / Articles. Activating a row opens the timeline:

```
CDL Extraction · txn 6f2a…
  1. Gemini    gemini-3.6-flash      quota_exceeded     HTTP 429   812ms  → mistral
  2. Mistral   mistral-medium-latest model_unavailable  HTTP 404   240ms  → groq
  3. Groq      qwen/qwen3.6-27b      success                      1,940ms  schema ✓
Final result → success (2 fallbacks, 2,992ms)
```

`verdict` exists because `outcome: 'success'` answers a narrower question than it
looks. It means "a provider replied in a valid shape", and it is written before
the caller has looked at the reply. A fact-check that answered `supported: false`
is a *successful* transaction and also the reason no article published, so
`article_generation: Success` next to `article_fact_check: Success` was a green
pair for a run that published nothing. The verdict is a single short token,
positively validated against `/^[a-z0-9_.-]{1,32}$/i` at both the router and the
telemetry layer — never a vendor message — and the Logs row reads
"Success · claims NOT supported — article refused" instead of
"Success · first provider".

`ai_telemetry` is `allow read, write: if false`, so the tab reads through the
`listAiTelemetry` callable — guarded exactly as `listAiProviders` is. Firestore
applies the date range and at most one equality filter (two composite indexes
cover every combination the UI can produce); provider and text matching run over
the returned page, and when that page is a window the response reports
`truncated` and the UI says so rather than implying completeness.

### What is never recorded

Never recorded: credentials, prompts, CDL or document images, provider response
text, extracted personal data, article drafts, or vendor error **bodies**.

The allowlist is the enforcement, and it applies twice — once at the transaction
level and again inside each attempt, because attempts are where vendor
diagnostics live and a vendor's error body is the likeliest place for a prompt
to come back to us.

Two rules are worth stating on their own:

- **`vendorCode` is validated positively, not truncated.** A truncated error
  message is still an error message. Only a short single-token value matching
  `^[a-z0-9_.-]{1,64}$` from a known code field survives; anything with a space,
  quote or newline is dropped. `model_not_found` is kept because it is the
  difference between "the vendor is down" and "we are asking for a model that no
  longer exists" — the exact fault a bare category could not express.
- **`inputSummary` is computed from shape, never content** — image count and
  media type from the data-URL prefix, field count from the schema, prompt
  length as a number. It is derived inside the telemetry module rather than
  passed in, so a caller cannot hand it a prompt by mistake. A CDL request reads
  `"1 image (image/jpeg), 6 structured fields requested"`.

`aiTelemetry.test.js` asserts the negative directly: given an entry carrying
prompts, images, credentials and extracted driver fields, none of it survives.

### Retention

30 days, via `expiresAt` and a Firestore TTL policy. The policy is declared in
`firestore.indexes.json` under `fieldOverrides`, so it deploys with everything
else. **It previously did not exist**: `expiresAt` was written and the docs
promised 30 days, but `fieldOverrides` was empty and `expiresAt` does nothing
without a policy naming it — telemetry was being kept forever.
`aiTelemetryIndexes.test.js` pins both the policy and the composite indexes.

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
   and restores its position; the cooldown also expires on its own. The result
   is now per-capability, so "text works, structured JSON is rejected" is
   visible on the row rather than hidden behind one verdict, and it names the
   version that answered when a spare did.
4. If a provider fails on `model_unavailable`, run **Verify model pins** before
   suspecting the vendor: the model may simply have been retired. The router has
   already moved to the lane's next version and rested the failed one for a
   day; **Clear cooldown** clears version rests along with the cooldowns.
5. If every capable provider is down, AI features return a safe error and the
   blog records `failed_generation` and retries on the next hourly run. No
   article is published with unverified content.

## Testing

No test in this repository contacts a real AI or image provider. Adapters take
an injected `fetchImpl`; tasks are mocked at the task boundary in feature tests.

The two live pathways are deliberately separate, operator-invoked and outside
CI: **Test connection** (`testAiProvider`) and **Verify model pins**
(`diagnoseAiModelPins`). Both run server-side with the managed credential and
neither returns, logs or echoes it.

A third runs on a schedule once a Telegram chat is connected: the hourly watcher
(`watchAiAndBlog`) sends one constant probe per lane through the router itself,
so it measures what users get from whichever provider answers, not one provider.
Its requests are recorded as connection tests (`health_check`) and count towards
provider health like any other. It alerts on a change only.

### What the capability probes prove, and what they do not

The connection test runs a synthetic probe per declared capability — text,
structured JSON, single-image vision, multi-image vision, and the article
generation and verification shapes — and reports a provider healthy only when
everything it *claims* works. Probes are gated on the capability, so a text-only
provider reports vision as *skipped*, not failed.

The probes run serially and the whole test is bounded by
`HEALTH_TOTAL_BUDGET_MS` (150s), inside `testAiProvider`'s 180s function
timeout — the same "deadline below the function it runs in" rule the task
deadlines follow. A probe the budget did not reach is reported as `not_run`, and
a test that did not finish is **not** a pass.

They are written to fail correctly, which is the harder half. The multi-image
probe asks about the **second** image, so a provider that accepts two and reads
one is caught. Structured answers are validated by SafeHaul's own validator and
then checked for substance, because a schema-valid object is not evidence the
model read anything. The verification probe uses a claim its source does not
support, so a provider that rubber-stamps everything fails.

**Stated plainly: these prove an image is accepted, understood and returned in
shape. They do not measure OCR accuracy and are not a proxy for reading a real
licence.** Extraction quality is not something a synthetic check can honestly
assert, and claiming otherwise would recreate the original problem — a green
check that means less than it looks.

No probe touches driver, applicant or company data: every prompt is a constant,
every image is generated from flat colour in
`functions/ai/tasks/healthProbes.js`, and the article probes name a fictional
authority so nothing in a probe can be mistaken for real source material.

#### The probe images were too small to be a fair test

They were 8x8 PNGs, and at that size two working vision providers reported as
broken. Measured on 2026-08-19 against the live vendors with SafeHaul's exact
request shapes:

| Provider | 8x8 | 256x256 |
| --- | --- | --- |
| Mistral, multi-image | `{"answer":"unknown"}` — **fails** | `{"answer":"blue"}` — passes |
| Gemini, multi-image | HTTP 504 `Deadline expired` | 200, correct |

The probes' intent was right; the input made them lie. They are now 256x256, and
the size is the point: a real CDL photograph is large, so a probe of the
capability SafeHaul actually uses has to give the model something to look at.
Every adversarial property is unchanged — the multi-image probe still asks about
the *second* image, structured answers are still validated and then checked for
substance, the verification probe still uses an unsupported claim.

#### A connection test must not spend the budget it is testing

Six serial probes on a free tier can exhaust the tier on themselves. Measured the
same day: Groq answered a two-image probe with
`429 … tokens per minute (TPM): Limit 8000, Used 3051, Requested 5023` — one
vision probe costs roughly 2.5k of an 8k-per-minute budget and the multi-image one
roughly 5k, so all six cannot fit. Mistral rate-limited with `429 code 1300`
after a handful of calls.

So a throttled probe is now its own outcome, not a failure:

| Probe status | Means |
| --- | --- |
| `passed` / `failed` | the capability was tested, and the answer was right or wrong |
| `rate_limited` | the vendor throttled the diagnostic. **The capability was never tested.** Shown as "Throttled" |
| `inconclusive` | the probe could not reach a verdict. Shown as "Not verified" |
| `not_run` | the budget did not reach it. Shown as "Not run", distinct from `skipped` |
| `skipped` | the provider does not declare this capability. Shown as "Not offered" |

Reporting a throttled diagnostic as a broken capability is the other half of why
working providers looked broken. The probe honours the vendor's stated wait once,
bounded by `PROBE_RETRY_CEILING_MS` (30s), and otherwise reports rather than
retrying into the limit. "A test that did not finish is not a pass" still holds —
`success` requires at least one probe run, none failed, and none left untested.

| Suite | Covers |
| --- | --- |
| `functions/test/unit/aiRouter.test.js` | Ordering, capability gating, every fallback trigger, terminal categories, cooldown, no-loop, telemetry secrecy, credential-read failure failing over, transaction timelines |
| `functions/test/unit/aiTelemetry.test.js` | Transaction shape, attempt cap, the allowlist at both levels, vendor-code validation, and explicit refusal to record prompts, images, credentials or extracted fields |
| `functions/test/unit/aiTelemetryIndexes.test.js` | Composite indexes read out of the real query chain, and the TTL policy |
| `functions/test/unit/aiHealthCheck.test.js` | Capability probes, including failing correctly: schema rejected while text works, retired vision model, an image ignored, a rubber-stamped claim |
| `functions/test/unit/aiProviders.test.js` | All nine adapters: endpoint, auth header, structured mode, response envelope, HTTP classification, timeout, path-traversal refusal |
| `functions/test/unit/aiCredentials.test.js` | Secret naming, namespace refusal, lifecycle, legacy fallback, every callable's authorization, audit records, Groq migration |
| `functions/test/unit/cdlParser.test.js` | Callable contract preserved, guards ordered before AI spend, error mapping, log privacy |
| `functions/test/unit/edocFieldPlacement.test.js` | Callable contract preserved, clamping, dedup, category mapping, log privacy |
| `src/features/super-admin/views/AiIntegrationsView.contract.test.jsx` | Masking, one-at-a-time reveal, 30-second clear, no plaintext in DOM or storage, retired provider, re-authentication, typed delete |
| `functions/test/unit/aiCredentialAccess.test.js` | The diagnostic: per-secret exists/readable, gRPC status mapping, `exists: null` when a check is refused, the runtime account read from the metadata server, and that no credential value is ever returned or logged |
| `functions/test/unit/aiCredentialAccessV1.test.js` | The 1st-generation entry point, and that its error codes are translated rather than flattened to `internal` |

## Manual actions required

These cannot be performed from the repository and must be done by a project
owner. **The feature is not fully live until they are.**

1. **Secret Manager IAM.** Grant **both** Cloud Functions runtime service
   accounts — this project mixes 1st- and 2nd-generation functions and they
   default to different identities (see "The runtime identity is not the same on
   every AI entry point"):
   - `<project>@appspot.gserviceaccount.com` — App Engine default, used by
     1st-generation functions including CDL auto-fill
   - `725898258453-compute@developer.gserviceaccount.com` — Compute Engine
     default, used by 2nd-generation functions including E-Doc, the blog and
     every AI Integrations callable

   Each needs:
   - `roles/secretmanager.secretAccessor` on secrets matching `SAFEHAUL_AI_*`
   - `roles/secretmanager.admin` (or `secretVersionManager` plus
     `secretmanager.secrets.create`) so the console can create secrets and
     destroy versions.

   Without the first, the affected generation reads every provider as
   unreadable. Without the second, add and delete fail with a permission error.
   Granting only one account is the state that produces "CDL works but E-Doc
   says there is no credential", or the reverse.

   **Check it:**

   ```bash
   gcloud secrets list --project truckerapp-system --filter="name:SAFEHAUL_AI_"
   gcloud secrets get-iam-policy SAFEHAUL_AI_GEMINI_APIKEY --project truckerapp-system
   ```

   A missing `secretAccessor` no longer takes AI down wholesale — the router
   records `credential_error` against that provider and continues — but the
   affected provider is unusable until it is granted. The routing panel in AI
   Integrations names the reason per provider, and **Check credential access**
   reports it per secret, per generation, alongside the service account actually
   in use. Run that before reaching for `gcloud`: it answers the same question
   from inside the runtime that is actually failing.

2. **Cloud Scheduler.** `publishScheduledBlogPosts` creates its job on first
   functions deploy. Confirm it exists, runs hourly at minute 15, and is pinned
   to `America/Chicago`:

   ```bash
   gcloud scheduler jobs list --location us-central1 --project truckerapp-system
   gcloud scheduler jobs describe firebase-schedule-publishScheduledBlogPosts-us-central1 \
     --location us-central1 --project truckerapp-system
   ```

   Check `state: ENABLED` and `lastAttemptTime`. Catch-up needs no
   configuration: a slot becomes due at its local hour and stays due for the
   rest of the local day, so a failed 07:00 run is filled by 08:15. It never
   reaches into a previous day, and at most one article publishes per run.

   Recent runs:

   ```bash
   firebase functions:log --only publishScheduledBlogPosts
   ```

3. **Deploy planner inclusion.** Add `publishScheduledBlogPosts` and
   `serveBlogPublic` to `DEPLOY_FUNCTIONS_ALWAYS_INCLUDE` in
   `.github/workflows/main.yml` if they should deploy on every run.

4. **Provider credentials.** No AI provider ships with a key. Until at least one
   capable provider is configured in AI Integrations, AI features return
   `failed-precondition` and the blog publishes nothing. Groq is covered by the
   legacy binding until migrated.

5. **Media credentials (optional).** Without Pexels or Unsplash, articles use
   the approved local fallback image. Openverse works without a credential.

6. **Confirm the telemetry TTL policy exists.** It is declared in
   `firestore.indexes.json`, so it deploys with everything else — but confirm
   the deploy applied it, because until it exists `expiresAt` is an ordinary
   field and nothing is ever deleted:

   ```bash
   gcloud firestore fields ttls list --collection-group=ai_telemetry --project truckerapp-system
   ```

7. **Run the checks that need live credentials.** These cannot run in CI, and
   they are the ones that catch what fixtures cannot. From Super Admin → AI
   Integrations:
   - **Test connection** on each configured provider, reading the
     per-capability results rather than only the overall pass/fail.
   - **Verify model pins**. Anything reported stale needs a registry change, not
     a credential change.

   Then from Super Admin → Blog Posts, the **manual publication check**
   (`runBlogPublicationNow`). It shares `publishDueSlots` with the schedule, so
   it cannot double-publish. The per-slot `detail` is now shown, and the Logs
   tab carries the full provider trail for that run.

## Related files

- [`functions/ai/registry/providers.js`](../functions/ai/registry/providers.js)
- [`functions/ai/registry/modelVersions.js`](../functions/ai/registry/modelVersions.js)
- [`functions/ai/router/router.js`](../functions/ai/router/router.js)
- [`functions/ai/router/providerTurn.js`](../functions/ai/router/providerTurn.js)
- [`scripts/check-ai-provider-boundary.mjs`](../scripts/check-ai-provider-boundary.mjs)
- [`docs/news-and-insights.md`](./news-and-insights.md)
- [`docs/security-posture.md`](./security-posture.md)
- [`docs/environment-and-integrations-runbook.md`](./environment-and-integrations-runbook.md)
