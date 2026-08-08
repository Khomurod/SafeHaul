# Spec: operator-controlled AI provider priority

**Status:** implemented 2026-08-08 · **Audience:** the engineer or agent
implementing this, starting cold · **Written:** 2026-08-08

> **Implemented.** Kept as the record of what was asked for and why. The built
> result is described in `docs/ai-platform.md` → "An operator can change the
> order", and the design-system and verification record is the
> 2026-08-08 entry in `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`. Two deliberate
> departures from the text below are noted at §5.5 and §7.

Read this whole file before writing code. It is deliberately self-contained: you
should not need to reverse-engineer the AI platform to do this work. Every path and
symbol below was verified against the tree at the time of writing.

Also read `AGENTS.md` and `CLAUDE.md` in the repo root first. They contain binding
policy — design system, MCP tool responsibilities, test-runner safety, and release
pipeline rules — and this spec does not repeat them.

---

## 1. What SafeHaul is, in one minute

SafeHaul is a driver-compliance and hiring platform for trucking companies. Drivers
submit applications and documents (CDLs, medical cards, e-signed forms); companies
review them. There is a Super Admin surface for platform operators.

Two environments, **sharing one Firebase backend and one dataset**:

| | URL |
| --- | --- |
| Testing | `https://truckerapp-system.web.app` |
| Production | `https://app.safehaul.io` |

Production only ever changes through the Super Admin release/promotion system — an
exact tested version is promoted after its release is proven live. Nothing in this
task should touch that. Because the backend is shared, **a Cloud Functions change
reaches Production users as soon as it deploys**, before any promotion. Treat
backend changes with that in mind.

## 2. How the AI platform is built

Four layers, and the boundaries are enforced:

```
functions/ai/tasks/      what we ask for  (cdl_extraction, edoc_field_placement, blog…)
functions/ai/router/     who answers it   (ordering, eligibility, failover, validation)
functions/ai/providers/  how to speak to a vendor  (adapters + the single HTTP call site)
functions/ai/registry/   declarative source of truth (providers, capabilities, models)
```

`scripts/check-ai-provider-boundary.mjs` fails if a vendor hostname or SDK import
appears outside `functions/ai/providers/` and `functions/ai/registry/`. Respect that
layering: no vendor-specific knowledge leaks upward, and tasks never name a provider.

### The files you will care about

| File | Key exports |
| --- | --- |
| `functions/ai/registry/providers.js` | `AI_PROVIDERS` (frozen, 9 rows, sorted by `priority`), `resolveModel`, `buildAiSecretId`, `secretField`, `configField`, `STRUCTURED_MODE` |
| `functions/ai/registry/capabilities.js` | `CAPABILITIES` (`text`, `structured_json`, `vision`, `multi_image`, `long_context`, `summarization`, `classification`, `article_writing`), `normalizeCapabilities` |
| `functions/ai/router/router.js` | `runAiTask`, `describeRouting`, `SKIP_REASONS`, `DEFAULT_TOTAL_DEADLINE_MS`, `__test` |
| `functions/ai/router/errors.js` | `AiError`, `categorizeHttpFailure`, `RETRYABLE_CATEGORIES`, `TERMINAL_CATEGORIES`, `TASK_FATAL_CATEGORIES`, `isTaskFatal` |
| `functions/ai/providers/http.js` | `postJson` — **the only outbound HTTP call site in the platform** |
| `functions/ai/providers/index.js` | `ADAPTERS`, `getAdapter` |
| `functions/ai/credentials/store.js` | `COLLECTION = 'ai_provider_config'`, `readAllConfigs`, `writeConfig`, `recordProviderOutcome`, `recordTestResult`, `cooldownState`, `clearCooldown` |
| `functions/ai/credentials/secretManager.js` | `SECRET_PREFIX = 'SAFEHAUL_AI_'`, `buildSecretId`, `readSecret`, `writeSecret` |
| `functions/ai/callables.js` | the 8 existing Super Admin callables, `__test = { buildProviderRow, MASK, requireRegisteredProvider }` |
| `functions/ai/telemetry/record.js` | `ai_telemetry` collection, 30-day TTL, `recordAiTelemetry`, `readRecentTelemetry` |
| `src/features/super-admin/views/AiIntegrationsView.jsx` | the screen you are extending |
| `src/features/super-admin/services/aiIntegrations.js` | the 8 matching client service functions |
| `src/features/super-admin/components/ai/aiProviderPresentation.js` | `describeProviderState`, `MASKED_PLACEHOLDER` |

### The nine providers, in current registry order

`gemini` (1), `groq` (2), `cloudflare` (3), `github-models` (4, **retired
2026-07-30**), `mistral` (5), `cerebras` (6), `sambanova` (7), `openrouter` (8),
`huggingface` (9).

Only `gemini`, `mistral`, `openrouter` and `huggingface` support vision. Groq
explicitly does **not** (`supportsVision: false`) — the vendor withdrew llama-4
vision. This matters: CDL parsing and e-doc field placement are vision tasks, so
their eligible set is much smaller than the full nine regardless of any ordering.

---

## 3. What already exists — do not rebuild any of this

Three of the four things this feature sounds like it needs are already built and
working. Read them before writing anything.

### Mistral is already integrated

No code is needed. It is registry row 5, reached through the shared
`functions/ai/providers/openaiCompatible.js` adapter (`https://api.mistral.ai/v1`),
with its key at `SAFEHAUL_AI_MISTRAL_API_KEY` in Google Secret Manager. To start
using it, an operator installs the key through **Super Admin → AI Integrations** —
that is a configuration action, not a development task.

### Live provider status is already recorded and displayed

`ai_provider_config/{providerId}` carries, written by `store.recordProviderOutcome`
and `recordTestResult`:

`enabled`, `health` (`healthy` | `degraded` | `quota`), `consecutiveFailures`,
`lastFailureCategory`, `cooldownUntil`, `cooldownReason` (`quota` | `failures`),
`lastAttemptAt`, `lastSuccessAt`, `lastTestAt`, `lastTestSuccess`,
`lastTestCategory`, `credentialUpdatedAt`.

"Ran out of usage" is the `quota` case: on a `quota_exceeded` or `rate_limited`
category the store sets a **30-minute** cooldown with `cooldownReason: 'quota'` and
`health: 'quota'`. Ordinary failures get a 5-minute cooldown after 3 consecutive
failures. Cooldown is persisted rather than in-memory because Functions instances
are ephemeral.

`describeProviderState()` already turns that into display text, most-urgent-first:
`Retired by vendor` → `Not configured` → `Disabled` → `Quota cooldown` /
`Failure cooldown` → `Degraded` → `Healthy` → `Ready`. It is rendered by
`components/ai/AiProviderStatus.jsx`.

### Failover semantics are already correct

`functions/ai/router/errors.js` already distinguishes provider-level faults from
bad requests, which is exactly the desired behaviour:

- **Fails over to the next provider** (`RETRYABLE_CATEGORIES`): `timeout`,
  `network`, `provider_unavailable`, `quota_exceeded`, `rate_limited`,
  `model_unavailable`, `malformed_response`, `output_truncated`,
  `provider_request_rejected`, `schema_validation_failed`, `not_configured`.
- **Aborts the whole task** (`TASK_FATAL_CATEGORIES`): `invalid_request`,
  `capability_unavailable`, `deadline_exceeded`, `all_providers_failed`.
- `unauthorized` and `internal` end that provider's turn only, not the walk.

So a malformed request is not retried against all nine providers, and a schema
validation failure is treated as that provider's fault and does fail over. Do not
change these sets.

### Telemetry already exists

`ai_telemetry`, 30-day TTL via `expiresAt`, field allowlist `taskType`,
`capability`, `providerId`, `model`, `outcome`, `category`, `latencyMs`,
`fallbackCount`, `attemptedProviders`, `cooldownSkipped`, `credentialSource`. The
AI Integrations screen already renders a "Recent AI activity" card from it. This is
how you will verify your work end to end.

---

## 4. What is actually missing

**Priority is hard-coded.** `AI_PROVIDERS` in `functions/ai/registry/providers.js`
is a deep-frozen array with a literal `priority` field per row, sorted at module
load. A Super Admin cannot say "try Mistral first, then Gemini, then Groq". That is
the entire job.

**The effective routing order is invisible.** `describeRouting(capabilities)` in
`router.js` already returns, per provider, whether it is eligible and if not why
(`SKIP_REASONS`: `retired`, `incapable`, `disabled`, `unconfigured`, `cooldown`,
`no_model`). **No callable calls it**, so the screen cannot show an operator why a
provider they enabled is not being used.

### Decisions already made — build to these, do not re-litigate

1. **One global order**, not per-feature. A single ranked list applies to every AI
   task. Capability filtering still narrows it per task, which is why a global order
   is sufficient: an ineligible provider is skipped, not failed on.
2. **Status stays passive** — derived from real calls. No scheduled probe job; a
   probe would burn the very quota it is meant to watch. The existing
   `testAiProvider` callable already covers on-demand checking.
3. **Failover only on provider-level faults** — already true, see §3.
4. **Drag to reorder** on screen, with a keyboard-accessible equivalent.

---

## 5. The change

### 5.1 Persist the order

New Firestore document **`ai_routing_config/order`**:

```js
{ providerIds: ['mistral', 'gemini', 'groq', …], updatedAt, updatedBy }
```

One document, so a reorder is a single atomic write rather than nine. Server-only,
matching how `ai_provider_config` is handled. Add to `src/firestore.rules`
alongside the existing rule at roughly line 581:

```
match /ai_routing_config/{docId} { allow read, write: if false; } // server-only (AI routing order)
```

Do **not** reuse `system_settings` — that collection is client-writable by super
admins (`src/firestore.rules:597`) and this is server-only configuration reached
through callables.

### 5.2 Apply the order in the router, failing safe

Add a pure function — `orderProviders(registryProviders, storedOrder)`:

- providers named in `storedOrder` come first, in that order;
- every provider absent from the list follows, in registry `priority` order;
- unknown ids in the stored list are ignored, duplicates collapse to first
  occurrence;
- a missing, empty, or malformed document yields the registry default order.

**It must never return an empty list.** A corrupt config document must degrade to
the built-in order, not disable AI. Write the tests for that case first.

Ordering happens *before* `evaluateProvider()`; capability filtering, `enabled`,
`retired`, cooldown and `no_model` checks are unchanged and still apply after. Keep
`orderProviders` pure and injectable so it is unit-testable without Firestore, the
way the rest of `router.js` is (`deps = { client, fetchImpl, now, providers }`).

`priority` in the registry becomes the **default** order rather than the effective
one. Update its comment in `providers.js` to say so. Do not unfreeze the registry.

### 5.3 New callable: `setAiProviderPriority`

In `functions/ai/callables.js`, re-exported from `functions/index.js` next to the
existing eight. It must reuse the existing guards from
`functions/environmentVault/guards.js` — do not write new ones:

- `guardPrivileged` = `assertSuperAdmin` (exact `token.globalRole === 'super_admin'`,
  no Firestore fallback) + `assertRecentAuth` (900-second re-auth window, throws
  `failed-precondition` prefixed `REAUTH_REQUIRED:`) + `assertWithinRateLimit` on
  the **mutate** budget (10 per 300s), which fails closed.
- Validate every submitted id with the existing `requireRegisteredProvider`.
  Reject unknown ids rather than silently dropping them, so a bad client cannot
  quietly shrink the order.
- Write an audit row via `functions/environmentVault/audit.js` → the
  `environment_audit_log` collection, using its `ACTIONS`/`RESULTS`/
  `ALLOWED_METADATA` allowlist. Add a new action constant there if none fits.

### 5.4 Surface the effective order

Extend `listAiProviders` (same file) to return the resolved order plus
`describeRouting()` output. The screen should be able to say *"Cerebras is enabled
but skipped for this task: `incapable`"* rather than only showing a rank. This is
wiring an existing function to an existing screen, not new logic.

### 5.5 Frontend

- `src/features/super-admin/views/AiIntegrationsView.jsx` — extend; it already
  holds the re-auth `requestReauth`/`runGuarded` pattern (around lines 103–118,
  with `ReauthCancelledError`) that a mutating action must go through.
- A new ordered-list component under
  `src/features/super-admin/components/ai/`.
- A new service function in `src/features/super-admin/services/aiIntegrations.js`,
  following the eight already there.

Drag to reorder — `react-draggable` is already a dependency, so no new package.
**Ship keyboard-accessible move-up/move-down controls alongside it**: the
accessibility policy in `AGENTS.md` is binding and drag-only would fail it.

> **Departure, 2026-08-08.** The move controls shipped as specified. Drag uses
> the platform's own drag events rather than `react-draggable`, which also adds
> no package. `react-draggable` translates a single element with a CSS transform
> and reports pixel offsets, so a *list reorder* built on it has to infer a
> target index from coordinates and maintain a visual model alongside the list.
> Native `dragover`/`drop` hand back the target row directly, so the list stays
> the single source of truth and both input methods call one `moveTo`.

Design-system components and semantic `--ds-*` tokens only. Reuse `DataTable`,
`Card`, `MetricCard` from `@/design-system/components` and `Stack`/`ResponsiveGrid`
from `@/design-system/layouts`, as the view already does. Reuse
`describeProviderState()` rather than writing new status text. No local button,
modal, table or arbitrary colour; no 9px or 10px text. If a genuinely missing
capability blocks you, record it in `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` and
document the temporary exception in code — do not quietly invent a primitive.

The view starts at `<h2>`; the Super Admin masthead owns the `<h1>`.

---

## 6. Tests

Behaviour-preserving where it should be, and new coverage where the risk is.

**`orderProviders` units** — missing document, empty list, partial list (some
providers unlisted), unknown ids, duplicate ids, and a full nine-item list. The
missing/malformed cases are the important ones: they prove AI does not switch off
when config is absent.

**Router** — a stored order genuinely changes the attempt sequence; capability
filtering still excludes Groq from vision tasks whatever its rank; a provider in
cooldown is still skipped; `fallbackCount` and `attemptedProviders` still reflect
reality. Extend `functions/test/unit/aiRouter.test.js`.

**Callable** — non-super-admin rejected; stale auth rejected with the
`REAUTH_REQUIRED:` contract intact; rate limit enforced; unregistered provider id
rejected; audit row written. Follow `functions/test/unit/environmentVault.callables.test.js`.

**View** — extend `src/features/super-admin/views/AiIntegrationsView.contract.test.jsx`.
Cover the keyboard reorder path, not just drag.

**Rules** — prove a client cannot read or write `ai_routing_config`, alongside the
existing rules security tests (`npm run test:rules`).

**E2E** — `e2e/super-admin-ai-and-blog.spec.cjs` already covers this screen; extend
rather than adding a new spec.

### One thing that will *not* need changing, and why

`functions/test/unit/environmentRegistry.inventory.test.js` is the usual tripwire
here: it scans the tree for `process.env.X`-style usage and fails if any key is
unregistered, and it asserts `AI_PROVIDERS` has exactly **9** entries. This task
adds **no new environment keys and no new provider**, so that test needs no edit.
If you find yourself editing it, stop and re-read — you have probably added a key
or a provider that this spec did not ask for.

Note for the future: AI credential rows are *derived* from `AI_PROVIDERS`
(`registry.js` ≈ lines 986–1007), so adding a tenth provider auto-registers its
vault row but requires bumping that `9` and adding to the Secret Manager binding
list in the same test (≈ lines 187–213).

---

## 7. Guardrails

- **Layering.** Nothing vendor-specific outside `providers/` and `registry/`.
  Tasks must not name a provider.
- **Scope.** Do not change Firebase rules beyond the one new deny-all match, and do
  not change permissions, routes, feature flags, database structures or business
  workflows. This is a routing-control feature.
- **Shared backend.** A Functions deploy reaches Production immediately. The
  fail-safe behaviour in §5.2 is what makes that acceptable.
- **If you touch CI at all**, `AGENTS.md` → "Changing the release pipeline" is
  binding: the `!cancelled()` + explicit `needs.<dep>.result == 'success'` clause
  pair on gated jobs, the reporter-job exception for `release-validation` and
  `verify-shipped`, `npm run check:ci-plan` before merging, and the fact that a pull
  request never deploys and so cannot exercise the deploy path.
- **Local test-runner safety** (`AGENTS.md`): one Playwright suite at a time, never
  a broad `pkill`, long suites need a real PID and exit status — a tool timeout or
  `SIGTERM` (exit 143) is not a test failure.

### Two real inconsistencies found while writing this spec

Both are pre-existing. Fix them here if cheap, or record them — but do not leave
them undiscovered a third time.

1. **`docs/ai-platform.md` is stale.** It states Groq is priority 1 and supports
   vision. The code says Gemini is priority 1 and Groq has
   `supportsVision: false`. The registry is authoritative. Correcting the doc is a
   one-line change and prevents someone reasoning from it.

2. **The provider boundary guard has never run.**
   `scripts/check-ai-provider-boundary.mjs` is documented as
   `npm run check:ai-boundary` in its own file header, the README,
   `docs/security-posture.md` and `docs/ai-platform.md` — but **no such script
   exists in `package.json`, and nothing in `.github/workflows/main.yml` invokes
   it.** The guard protecting the exact layering this feature depends on has never
   executed. Adding the script and a step in the existing never-skipped
   `callable-contract` job costs approximately zero seconds and is the
   highest-value adjacent fix available. Recommended, and if you decline it, say so
   explicitly rather than silently.

> **Both fixed, 2026-08-08.** `docs/ai-platform.md` now records Gemini as
> priority 1 and Groq as having no vision capability, with the reason stated so
> the correction is not silently reversible; the historical narrative about the
> `unauthorized` defect now says Groq *was* priority 1 at the time rather than
> that it is. `npm run check:ai-boundary` exists in `package.json` and runs as a
> step in the never-skipped `callable-contract` job. It passes.
>
> **Departure.** The audit allowlist gained one field, `providerOrder`, rather
> than only a new action constant. `ACTIONS.UPDATE` already fitted, but without a
> field for the list itself the trail could record that *someone changed the
> order* and not *to what* — which is most of the value of auditing this
> particular action. Every id in it is registry-resolved before the write, so it
> carries public vendor names and cannot hold a credential.

---

## 8. Verification

Before opening a pull request:

```
npm run lint
npm run check:ci-plan
npm run check:function-exports
cd functions && npm test        # Cloud Functions suite
npm run test:rules              # rules security tests
```

plus the affected frontend contract tests, and
`e2e/super-admin-ai-and-blog.spec.cjs` on its own.

Then prove it actually works, rather than assuming a green suite means it does:

1. Reorder so Mistral is first. Confirm the write lands in
   `ai_routing_config/order`.
2. Run a real AI task — the CDL photo auto-fill path is the easiest — and confirm
   `ai_telemetry` records `providerId: 'mistral'`.
3. Remove or exhaust the Mistral credential and confirm the task still succeeds via
   the next provider, and that the screen shows Mistral as `Not configured` or
   `Quota cooldown`.
4. Delete the `ai_routing_config/order` document and confirm routing falls back to
   the registry order with AI still working. **This is the most important check in
   the list** — it is the failure mode that would take AI down platform-wide.

State honestly which of these you ran and which you could not. An unrun check
recorded as unrun is useful; an unrun check reported as passing is not.
