# SafeHaul — Audit Remediation Proposals

Detailed, industry-best-practice solutions for every finding in the full-scale
audit. Each item gives: the **problem** (with verified evidence), the
**recommended solution** and *why it's the industry standard*, a **concrete
implementation** (real code/config against this repo's actual APIs), and
**rollout + verification**.

**Verification tags** carried from the audit:
- **[Verified]** — file opened and confirmed.
- **[Reported]** — agent-surfaced; verify-first before coding.
- **[Corrected]** — re-checked and found different from the original claim.

> Two corrections made while writing this proposal, so nobody wastes effort:
> 1. **A6 (`integrations_index` "world-writable")** is a **false alarm**.
>    Firestore default-denies any collection without an explicit `match`; there
>    is no catch-all `match /{document=**}` in `src/firestore.rules`. Server-only
>    collections (`integrations_index`, `rate_limits`, `processing_status`) are
>    already unreachable by clients. Reframed below as optional defense-in-depth.
> 2. **A3 (`executeReactivationBatch` "unbounded SMS")** already caps batch size
>    at 50 (`smsService.js:111`). The real defects are (a) no *frequency* limit
>    and (b) a blocking `setTimeout(1000)`-per-lead loop that holds a function
>    instance up to ~50 s. Solution updated accordingly.

The reusable pattern to copy throughout: `functions/shared/rateLimiter.js`
exposes `checkRateLimit(key, limit, windowSeconds, failBehavior)` where
`failBehavior` is `'open'` (allow on system error — UX paths) or `'closed'`
(deny on system error — security paths). It already writes an `expiresAt` field
on each `rate_limits` doc — the same TTL pattern we reuse for B1.

---

## P0 — Security correctness, small diffs, high confidence

### A1 · Telegram webhook fails open `[Verified]` — ⚠️ SUPERSEDED (feature removed)

> **This remediation is obsolete and no longer applies to this repository.** The
> Telegram application-intake feature — including `functions/telegram/webhook.js`
> referenced throughout this section — was **removed from this repo** in commit
> `5a4c8dd`. There is no longer a Telegram webhook in this codebase to harden, so
> A1 is retained below for historical context only. (Scoped to Telegram
> *application intake in this repository*; unrelated Telegram functionality that may
> exist elsewhere in the SafeHaul ecosystem is not addressed by this note.)

**Problem.** `functions/telegram/webhook.js:7`:
```js
function secretMatches(req) {
    const expected = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    if (!expected) return true;          // ← unset secret ⇒ every POST authenticates
    ...
}
```
If `TELEGRAM_WEBHOOK_SECRET` is unset/empty, the endpoint accepts any POST and
runs `processUpdate()` against Firestore. This is the classic *fail-open
authentication* anti-pattern.

**Industry-best solution.** **Fail closed.** Authentication checks must deny
when the secret material is missing — never treat "not configured" as "allow."
Telegram supports a per-webhook secret token delivered in the
`X-Telegram-Bot-Api-Secret-Token` header (set via `setWebhook`); compare it with
a constant-time comparison to avoid a timing side channel, exactly as
`publicSigning.js` already does for envelope tokens.

**Implementation.**
```js
const crypto = require('crypto');

function timingSafeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function secretMatches(req) {
    const expected = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    if (!expected) {
        // Fail closed: a misconfigured secret must never authenticate traffic.
        console.error('[telegramWebhook] CRITICAL: TELEGRAM_WEBHOOK_SECRET unset — rejecting.');
        return false;
    }
    const header = String(req.get('x-telegram-bot-api-secret-token') || '').trim();
    const query  = String(req.query.secret || '').trim();
    return (header && timingSafeEqual(header, expected)) ||
           (query  && timingSafeEqual(query,  expected));
}
```
Add a **deploy-time guard** so the function refuses to come up misconfigured —
fail-fast beats fail-quiet:
```js
// at module load in functions/telegram/webhook.js
if (process.env.FUNCTIONS_EMULATOR !== 'true' && !process.env.TELEGRAM_WEBHOOK_SECRET) {
    console.error('[telegramWebhook] TELEGRAM_WEBHOOK_SECRET missing at startup.');
}
```

**Rollout.** Confirm the secret is set in prod (`firebase functions:secrets:access`
or the env), and that `setWebhook` was called with the same `secret_token`,
*before* deploying — otherwise legitimate Telegram traffic 403s. Then deploy.

**Verify.** Unit test: unset env ⇒ `secretMatches` returns `false` ⇒ handler
responds 403. Add to `functions/test/unit/`. **Effort:** ~20 min. **Risk:** low
(behind a secret that should already be set).

---

### E1 · No production sourcemaps `[Verified]`

**Problem.** `vite.config.js` `build` block sets no `sourcemap`, so Sentry
(`@sentry/react`, wired in `main.jsx`) only ever sees minified frames —
production stack traces are unusable, undercutting the whole error-tracking
investment.

**Industry-best solution.** Emit **hidden sourcemaps** (`sourcemap: 'hidden'`):
full maps are generated for upload to Sentry but **no `//# sourceMappingURL`
comment ships in the bundle**, so the maps aren't publicly served (no source
disclosure). Upload them to Sentry at build time and delete them from the deploy
artifact. This is the standard SPA + Sentry configuration.

**Implementation.** `vite.config.js`:
```js
build: {
    target: 'esnext',
    sourcemap: 'hidden',
    rollupOptions: { /* unchanged */ },
},
```
CI (`.github/workflows/main.yml`, in the build/deploy job), using the Sentry CLI
and the release SHA:
```yaml
- name: Upload sourcemaps to Sentry
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
    SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
    SENTRY_PROJECT: ${{ secrets.SENTRY_PROJECT }}
  run: |
    npx @sentry/cli releases new "$GITHUB_SHA"
    npx @sentry/cli releases files "$GITHUB_SHA" upload-sourcemaps ./dist --url-prefix '~/assets'
    npx @sentry/cli releases finalize "$GITHUB_SHA"
- name: Strip maps from deploy artifact
  run: find dist -name '*.map' -delete   # don't ship maps to Firebase Hosting
```
Tag the Sentry release at runtime so events map to the upload —
`Sentry.init({ release: import.meta.env.VITE_RELEASE_SHA, ... })` with
`VITE_RELEASE_SHA` injected from `$GITHUB_SHA` at build.

**Verify.** Throw a deliberate error in staging; confirm the Sentry issue shows
original file/line/column. **Effort:** ~45 min (+ one-time Sentry token secret).
**Risk:** very low.

---

### A2 · `getPublicEnvelope` has no rate limit `[Verified]`

**Problem.** `functions/publicSigning.js` rate-limits the **submit** path but not
the **read** path. `getPublicEnvelope` is unauthenticated (token-gated) and mints
a signed Storage URL on every call. An attacker who has a valid signing link can
hammer it — signed-URL generation and Firestore reads at no cost to them.
Mitigated only by the 1-hour URL lifetime.

**Industry-best solution.** **Defense in depth: layered rate limits** on every
unauthenticated, side-effecting endpoint, keyed by the most specific stable
identifier. Use a per-`requestId` limit (the envelope being read) *and* a
per-IP limit (catches enumeration across many envelopes). `'closed'` fail
behavior — a security path must not fail open.

**Implementation.** In `getPublicEnvelope`, immediately after extracting params:
```js
const { checkRateLimit } = require('./shared/rateLimiter');

// Per-envelope: a real signer refreshes a handful of times; 30/5min is generous.
const okEnvelope = await checkRateLimit(`envelope_read_${requestId}`, 30, 300, 'closed');
if (!okEnvelope) throw new HttpsError('resource-exhausted', 'Too many requests. Please wait and retry.');

// Per-IP: blunts enumeration of requestIds from one source.
const ip = request.rawRequest?.ip || 'unknown';
const okIp = await checkRateLimit(`envelope_read_ip_${ip}`, 100, 300, 'closed');
if (!okIp) throw new HttpsError('resource-exhausted', 'Too many requests from this network.');
```
**Reuse, don't reinvent:** this is the same helper and pattern already protecting
`submitPublicEnvelope` and `submitGuestApplication`.

**Verify.** Integration test in the emulator: 31 reads of one `requestId` inside
5 min ⇒ the 31st throws `resource-exhausted`. **Effort:** ~20 min. **Risk:** low
— pick limits comfortably above real signer behavior to avoid false positives.

---

### A3 · `executeReactivationBatch` — no frequency limit + blocking loop `[Verified, corrected]`

**Problem.** `smsService.js:103`. Batch size *is* capped at 50 (`:111`) and RBAC
*is* enforced (`assertCompanyAdminStrict`, `:120`). Two real defects remain:
1. **No frequency limit** — an admin (or a stolen admin session) can fire
   50-lead batches back-to-back with no throttle.
2. **Blocking `await setTimeout(1000)` per lead** (`:135`) holds a single
   function instance for up to ~50 s — fragile against the function timeout,
   expensive (paying for wall-clock sleep), and non-resumable on crash.

**Industry-best solution.**
- **Throttle** with the existing limiter (`'closed'`).
- **Replace the in-process sleep loop with the project's own recursive Cloud
  Tasks worker** (`functions/bulkActions/`, documented in `ARCHITECTURE.md` §6 —
  batch-of-N, enqueue-next, zombie-prevention double-check). The codebase
  *already* solved "send many messages reliably without holding an instance";
  reactivation should ride that rail instead of a parallel hand-rolled loop. The
  industry principle: **one durable, observable async pattern, not two.**

**Implementation — immediate throttle (today):**
```js
await assertCompanyAdminStrict(request.auth.uid, companyId);

const ok = await checkRateLimit(`reactivation_batch_${companyId}_${request.auth.uid}`, 5, 300, 'closed');
if (!ok) throw new HttpsError('resource-exhausted', 'Too many campaigns. Please wait a few minutes.');
```
**Follow-up (next iteration):** make `executeReactivationBatch` enqueue a
`bulk_sessions` job and return immediately; let `processBulkBatch` fan it out
with the existing pacing/zombie-kill logic. Removes the timeout/cost risk and
gives pause/resume for free.

**Verify.** Throttle unit test now; when migrated, reuse `bulkActions.test.js`
patterns. **Effort:** throttle ~20 min; worker migration ~1 day. **Risk:** low /
medium.

---

## P1 — Correctness, scale, mobile (verify-first where noted)

### B1 · `processing_status` grows unbounded `[Verified — no TTL field]`

**Problem.** `functions/driverSync.js` creates a `processing_status` doc per
application (idempotency guard) and never deletes it or sets an expiry. Confirmed:
no `expiresAt` is written. At scale this is a monotonically growing collection —
storage cost and slower range scans.

**Industry-best solution.** **Firestore native TTL policy** on an `expiresAt`
timestamp field. It's the managed, zero-maintenance pattern (Google deletes
expired docs automatically, no cron, no read cost). The idempotency guarantee
only needs to outlive the longest retry window — days, not forever. The repo
already uses exactly this for `rate_limits`, so it's a proven local pattern.

**Implementation.** Where the guard doc is created:
```js
const { admin } = require('./firebaseAdmin');
const TTL_DAYS = 30; // ≫ any realistic retry/replay window

await processingRef.set({
    started: true,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000),
}, { merge: true });
```
Then enable the policy **once** (Console → Firestore → TTL, or gcloud):
```
gcloud firestore fields ttls update expiresAt \
  --collection-group=processing_status --enable-ttl
```
Backfill existing docs with a one-off script stamping `expiresAt` so the old
rows also age out.

**Verify.** New docs carry `expiresAt`; the TTL policy shows *Active* in Console;
a backdated test doc disappears within the ~24 h TTL sweep window. **Effort:**
~1 h + console. **Risk:** low — only deletes the idempotency ledger after the
retry window; never touches application data.

---

### B2 · `activity_logs` unbounded `[Code shipped — destructive ops gated]`

> **Status:** non-destructive code is **shipped** — collection-group triggers
> (`functions/activityLogRetention.js`) stamp `expiresAt = createTime + 90d` on
> every activity-log write, and `scripts/backfill-activity-log-expiry.mjs`
> (dry-run by default) stamps pre-existing docs. The **destructive** parts
> (BigQuery export extension, then the TTL delete policy) are ordered, gated ops
> steps in [`production-readiness-runbook.md`](./production-readiness-runbook.md)
> §B2, requiring a one-line stakeholder sign-off on the 90-day window and a
> verified-live BigQuery export **before** any TTL delete is enabled.

**Problem.** `activity_logs`/`activities` subcollections accrue forever; read
cost on history views and collection-group queries grows linearly per tenant.

**Industry-best solution.** **Tiered retention**: keep ~90 days hot in Firestore
for in-app history; stream everything to **BigQuery** (via the *Firestore →
BigQuery* Firebase Extension, the standard export path) for durable analytics/
audit; TTL-delete the hot copy after the window. Compliance-friendly (audit data
preserved cheaply) and keeps the operational collection small.

**Implementation.**
1. Add `expiresAt` (now + 90 d) when writing each log; enable a TTL policy on the
   `activity_logs` collection group (same mechanism as B1).
2. Install the **firestore-bigquery-export** extension on `activity_logs` for
   point-in-time history before deletion.
3. Repoint long-range admin reports at the BigQuery dataset.

**Verify.** Logs older than 90 d absent from Firestore but present in BigQuery;
history UI still correct for the hot window. **Effort:** ~1 day. **Risk:** medium
— socialize the 90-day in-app window with stakeholders; the **open question on
per-tenant volume** sizes whether 90 d is right.

---

### C1 · No mobile e2e coverage `[Verified]`

**Problem.** `playwright.config.cjs` runs desktop Chromium/Firefox/WebKit only.
Driver flows are mobile-primary. (This PR's signing e2e already drives 375/320/884
px viewports manually, but there's no first-class mobile project.)

**Industry-best solution.** First-class **device-emulation projects** using
Playwright's `devices` registry (real UA, DPR, touch, viewport) so mobile is a
permanent CI lane, not a one-off `setViewportSize`. Cover the critical
mobile-primary journeys: signing (done), guest intake, auth.

**Implementation.** `playwright.config.cjs`:
```js
const { devices } = require('@playwright/test');
// ...
projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-safari',  use: { ...devices['iPhone 13'] } },
    { name: 'mobile-chrome',  use: { ...devices['Pixel 7'] } },
],
```
Tag mobile-critical specs and run those projects against them (Playwright
`grep`/project filtering) to keep CI time bounded.

**Verify.** `npx playwright test --project=mobile-safari` green for
signing/intake/auth. **Effort:** ~1–2 days. **Risk:** low; mainly CI-time
budgeting.

---

### A5 · PII potentially in logs `[Reported — verify before claiming]`

**Problem.** ~500 `console.*` calls across front and functions; phone/email/SSN
fragments may reach Sentry and Cloud Logging unredacted — a privacy/compliance
exposure (FCRA/PII context in trucking hiring).

**Industry-best solution.** **Centralized scrubbing at the sink**, not
per-call-site discipline (which always rots). Two layers:
1. **Sentry `beforeSend`/`beforeBreadcrumb`** hooks that deep-scrub known PII
   keys and pattern-match SSN/email/phone in strings — the vendor-blessed place
   to enforce "PII never leaves the process."
2. A thin **logger wrapper** (see E2) that scrubs before `console`, so Cloud
   Logging is clean too.

**Implementation (Sentry, `main.jsx`).**
```js
const PII_KEYS = /(ssn|social|dob|password|token|secret|authorization)/i;
const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

function scrub(value) {
    if (typeof value === 'string') return value.replace(SSN, '[ssn]').replace(EMAIL, '[email]');
    if (value && typeof value === 'object') {
        for (const k of Object.keys(value)) {
            value[k] = PII_KEYS.test(k) ? '[redacted]' : scrub(value[k]);
        }
    }
    return value;
}
Sentry.init({
    /* ...existing... */
    beforeSend(event) { return scrub(event); },
    beforeBreadcrumb(b) { return scrub(b); },
});
```
Mirror on the backend (`@sentry/node` in `functions/shared/errorHandler.js`).

**Verify.** Unit-test the scrubber against SSN/email/phone fixtures; throw a test
error containing fake PII and confirm the Sentry payload is clean. **Effort:**
~0.5–1 day. **Risk:** low.

### A6 · `integrations_index` rule `[Corrected — not a vulnerability]`

Firestore **default-denies** any collection without a `match`; there is no
catch-all rule in `src/firestore.rules`. `integrations_index` (and `rate_limits`,
`processing_status`) are already unreachable by clients and written only by the
Admin SDK. **No action required for security.** *Optional* defense-in-depth +
self-documentation: add explicit terminal rules so intent is auditable —
```
match /integrations_index/{id}   { allow read, write: if false; } // server-only (Admin SDK)
match /rate_limits/{id}          { allow read, write: if false; }
match /processing_status/{id}    { allow read, write: if false; }
```
and (best practice) a rules **unit test** asserting a signed-in non-admin client
is denied read on each. **Effort:** ~15 min. **Risk:** none.

---

## P2 — Important, broader

### C2 / C3 / C4 · Accessibility pass `[Reported]`

**Problem.** Inputs lack `aria-invalid`/`aria-describedby`/`aria-required`;
errors surface only as a submit-time toast (no per-field, programmatically
associated message); icon-only buttons lack `aria-label`; status is color-only
in candidate lists; modals don't move focus on open or trap it.

**Industry-best solution.** Target **WCAG 2.1 AA** (the de-facto legal/ADA bar).
Bake a11y into the shared primitives so it's correct everywhere by construction,
then enforce with automated checks:
- **`InputField`** owns the error wiring (`aria-invalid`, `aria-describedby`
  pointing at a rendered `role="alert"` message, `aria-required`).
- **Status** = icon + text, never color alone (WCAG 1.4.1).
- A shared **`<Modal>`** wrapper handles focus-move-on-open, focus trap, restore
  on close, `Esc`, `aria-modal` (or adopt Radix/React-Aria Dialog rather than
  hand-rolling — the standard build-vs-buy answer for dialogs).
- **`jest-axe`** in component tests + **`@axe-core/playwright`** in e2e to prevent
  regressions.

**Implementation (`InputField.jsx`).**
```jsx
const errId = error ? `${id}-error` : undefined;
<input
  id={id} name={name} type={type} value={value ?? ''} onChange={...}
  required={required}
  aria-required={required || undefined}
  aria-invalid={error ? true : undefined}
  aria-describedby={errId}
  className={...}
/>
{error && <p id={errId} role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
```
**Implementation (axe gate).**
```js
import { axe } from 'jest-axe';
it('has no a11y violations', async () => {
  const { container } = render(<DriverApplicationWizard />);
  expect(await axe(container)).toHaveNoViolations();
});
```

**Verify.** jest-axe + Playwright-axe green; manual NVDA/VoiceOver pass on the
signing room and the driver wizard. **Effort:** ~2–3 days. **Risk:** low/medium
(focus-trap changes need a keyboard regression check). **Open question: confirm
AA as the target.**

### C5 · Submit-time-only validation `[Reported]`

**Solution.** Add **on-blur, per-field validation** that reuses the existing
`validation.js` predicates and renders inline errors through the now-a11y-aware
`InputField` (C2). Industry norm: validate on blur, *re-validate on change once a
field has been touched/errored*, summarize on submit. Keep the schema-driven
`SchemaRenderer` as the single source of field rules. **Effort:** ~1 day inside
the C2 work.

### B3 / B4 / B5 · Query-cost guards `[Reported]`

- **B3** — add the missing `stats_daily` composite index *only if* a real query
  needs it (open `firestore.indexes.json` + the analytics query first; don't add
  speculative indexes — each has write cost):
  ```json
  { "collectionGroup": "stats_daily", "queryScope": "COLLECTION",
    "fields": [ {"fieldPath":"companyId","order":"ASCENDING"},
                {"fieldPath":"date","order":"DESCENDING"} ] }
  ```
- **B4** — the per-call cap (50) exists; add a **per-session lifetime ceiling**
  in the recursive worker (`batchWorker.js`) so a single `bulk_session` can't
  process > N total, as a runaway-cost circuit breaker.
- **B5** — **bounded reads**: analytics widgets must `.limit()` / date-range
  their `stats_daily` reads (e.g. last 90 days) instead of full-collection
  scans, with pagination for deeper history.

**Effort:** ~1 day total. **Risk:** low.

### D1 · Decompose god-components `[In progress — incremental]`

> **Status.** First incremental extraction shipped: the intake-chooser screen is
> now a presentational `IntakeChooser` child of `PublicApplyHandler` (behaviour
> identical, guarded by the existing `PublicApplyHandler` intake unit test).
> **Remaining extractions are deferred until they can be run against the guarding
> e2e suites** (`guest-application-intake`, `edoc-recruiter-send-flow`) — these
> touch the live guest DOT-application and signing flows, where the working rule
> is to run those e2e before *and* after each extraction. Continue one
> extraction per PR: `PublicApplyHandler` → `usePublicApplicationForm()` (state/
> validation/submit/queue) + thin step renderers; `EnvelopeCreator` →
> `useEnvelopeBuilder()` + `<EnvelopeCanvas>` + `<FieldPalette>` +
> `<PrefillConfigPanel>`; then `PEVRequestModal` and `VerificationPortal`.

**Problem.** `EnvelopeCreator.jsx` (~1100), `PublicApplyHandler.jsx` (~970),
`PEVRequestModal` (~880), `VerificationPortal` (~800). Hard to test, review,
reuse; merge-conflict magnets.

**Industry-best solution.** **Container/presentational split + custom hooks for
logic** (the standard React decomposition). Extract orchestration into hooks and
render into focused children, mirroring the pattern this very session used on the
signing room (`usePdfZoomGestures`, `signerFieldFlow`, `SignatureSheet`).
- `EnvelopeCreator` → `useEnvelopeBuilder()` (field CRUD/undo/persist) +
  `<EnvelopeCanvas>` + `<FieldPalette>` + `<PrefillConfigPanel>`.
- `PublicApplyHandler` → `usePublicApplicationForm()` (state/validation/submit/
  queue) + thin step renderers.

**Do it incrementally, behind the existing tests** (extract one hook/child per
PR; keep behavior identical). **Effort:** ~2–4 days each, splittable. **Risk:**
medium — guard with the existing e2e (`guest-application-intake`,
`edoc-recruiter-send-flow`) before/after each extraction.

### D3 · Type-safety beachhead `[Verified — JS, no checkJs]`

**Solution.** Don't boil the ocean with a TS migration. Add a **`jsconfig.json`
with `checkJs` + JSDoc** to get type-checking on the existing JS, gate it
**non-blocking** in CI first (collect the baseline), then ratchet. Start at the
highest-leverage modules: `src/lib/firebase.js`, `src/config/*`, the service
layer (`driverService.js`), and the callable contracts.
```json
// jsconfig.json
{
  "compilerOptions": {
    "checkJs": true, "allowJs": true, "noEmit": true,
    "moduleResolution": "bundler", "target": "esnext",
    "baseUrl": ".", "paths": { "@/*": ["src/*"], "@features/*": ["src/features/*"],
      "@shared/*": ["src/shared/*"], "@lib/*": ["src/lib/*"], "@app/*": ["src/app/*"] }
  },
  "include": ["src"]
}
```
CI: `npx tsc -p jsconfig.json --noEmit` as a **warning** lane initially.
**Effort:** ~1–2 days to baseline. **Risk:** low (non-blocking).

### D6 · De-risk `react-signature-canvas@1.1.0-alpha.2` `[Verified]`

**Problem.** An **alpha** dependency now sits on the legally-critical signing
path (this session adopted it in `SignatureSheet`).

**Industry-best solution.** Remove single-point-of-failure risk on a pre-release
dep: **(a)** pin the **exact** version (no `^`) so an alpha bump can't auto-land,
and **(b)** depend on the underlying stable library it wraps —
**`signature_pad`** (mature, widely used) — behind our own tiny `SignatureSheet`
adapter, so swapping implementations is a one-file change. Add a render smoke
test so a broken upgrade fails CI.
```json
"react-signature-canvas": "1.1.0-alpha.2"   // exact pin, no caret
```
**Effort:** ~0.5 day (pin) / ~1 day (wrap `signature_pad`). **Risk:** low.

---

## P3 — Hygiene, lower leverage

### D2 · Split `DataContext` `[Reported]`
One mega-context (≈11 values, ≈41 consumers) with an unmemoized `contextValue`
re-renders broadly. **Solution:** split by change-cadence into `AuthContext` /
`CompanyContext` / `UIContext` and `useMemo` each value — the standard fix for
context-induced re-renders. Optionally adopt `use-context-selector` if a split
is too invasive. **Effort:** ~0.5 day. **Risk:** low/medium (touches many import
sites — codemod it).

### E2 · Structured logging `[Reported]`
~500 ad-hoc `console.*`. **Solution:** a thin **`logger`** wrapper emitting
**structured JSON with severity** (the format Cloud Logging parses into
`severity`/`jsonPayload`), routing errors to Sentry and scrubbing PII (A5).
Adopt incrementally; lint-ban raw `console` via `no-console` once migrated.
```js
// functions/shared/logger.js
const scrub = require('./scrub');
const emit = (severity, message, ctx = {}) =>
  console[severity === 'ERROR' ? 'error' : 'log'](JSON.stringify({ severity, message, ...scrub(ctx) }));
module.exports = {
  info:  (m, c) => emit('INFO', m, c),
  warn:  (m, c) => emit('WARNING', m, c),
  error: (m, c) => emit('ERROR', m, c),
};
```
**Effort:** ongoing. **Risk:** low.

### E3 / E4 · CI gates `[Reported]`
- **Coverage**: add `vitest run --coverage` and start a threshold at the *current*
  baseline, ratcheting up (don't block day one). Industry norm: ratchet, never a
  big-bang gate.
- **Backend ESLint**: flip `no-unused-vars` from `warn` → `error` in
  `functions/.eslintrc.json` (dead imports hide copy-paste bugs).
**Effort:** ~0.5 day. **Risk:** low.

### D5 · Dedupe `normalizePhone` `[Reported]`
Two implementations (`validation.js` vs `helpers.js`). **Solution:** keep one
canonical `helpers.js` version; re-export from `validation.js`; delete the dup;
prune dead imports. A single phone-normalization path also prevents subtle
validation/format drift. **Effort:** ~30 min. **Risk:** low (one shared test).

### A4 · Public-read field review `[Verified intentional]`
`recruiter_links`, `public_profiles`, `job_posts` are `allow read: if true` by
design (pre-auth driver access). **Solution:** *verify the writers* only emit
sanitized fields, document the public field contract in-rule, and consider
**Firestore field-level security via a dedicated public mirror doc** (write a
curated `public_profiles/{id}` projection from a trigger) so the public surface
can never accidentally include PII added to the source doc later. **Effort:**
~0.5 day. **Risk:** low.

### A7 · App Check on public callables `[Resolved — Accepted (no App Check by design)]`

**Decision: accepted as-is; App Check will NOT be added.** Per
[`docs/security-posture.md`](./security-posture.md), App Check is an *intentional
product omission*. The public surface is mobile-primary (drivers on varied/again
carrier networks), and App Check (reCAPTCHA Enterprise/v3 attestation) carries a
real risk of false-positives that silently block legitimate applicants and
signers — a worse failure mode than the abuse it prevents. The surface is already
covered by sound defense-in-depth: per-IP/per-resource **rate limits**
(`shared/rateLimiter.js`), **constant-time token gating** on signing links
(`publicSigning.js` `safeCompare`), the A3 **frequency throttles**, and A5
**PII scrubbing**. Adding a high-risk, user-blocking control against a deliberate,
documented decision purely to "tick a box" is not warranted.

**Reversible future option (a product decision, not a defect):** if bot abuse is
ever observed, enable **reCAPTCHA Enterprise in monitor/unenforced mode** on
`submitGuestApplication` and the signing callables first, measure the
false-positive rate over a bake period, and only then consider enforcement.
Tracked as a product call, not an outstanding security gap. See
`docs/security-posture.md` for the standing rationale.


---

## Suggested execution order

1. **P0 batch** (A1, E1, A2, A3-throttle) — one small security/observability PR,
   ~half a day, very high ROI.
2. **B1** TTL + **A6** explicit deny rules — quick scale/clarity wins.
3. **A5** PII scrubbing + **E2** logger together (shared scrubber).
4. **C1** mobile e2e (locks in this session's mobile work permanently).
5. **C2/C3/C4/C5** a11y pass (confirm WCAG AA target first).
6. **D1/D3/D6** maintainability beachheads, incremental.
7. **P3** hygiene as fill-in.

## Open questions that change scope
- Are **Telegram** and **Facebook** integrations actively used in prod? (sets A1
  urgency and whether to keep/retire that surface).
- Expected **per-tenant data volume**? (sizes B1/B2 retention windows).
- Target **accessibility bar** — WCAG 2.1 AA assumed; confirm. (sizes C-series).
