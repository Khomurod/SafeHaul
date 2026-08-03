# Security posture (guest and public flows)

## Firebase App Check — previously used, intentionally removed

SafeHaul does **not** currently use Firebase App Check (no `initializeAppCheck`, no
`enforceAppCheck` on callables, no `request.app` / `request.appcheck` in security
rules, no reCAPTCHA Enterprise env vars).

### Decision history and rationale (why it was removed)

App Check **was previously implemented** in SafeHaul. In production it **blocked or
disrupted legitimate document uploads** for a meaningful number of real drivers —
most visibly the **CDL** and **medical-card** uploads on the public driver
application. The result was **failed applications and driver frustration**: drivers
who could not attach their documents could not complete or submit an application.

Because the public application is the top of the recruiting funnel, **reliable driver
application submission is deliberately prioritized over strict App Check
enforcement**. App Check was therefore removed. The current guest-upload access model
is a **conscious, accepted business-and-security tradeoff**, not an oversight or a
regression.

### This is an accepted risk — not a defect

Automated audits and security reviews should **not** report the absence of App Check,
or the existence of unauthenticated guest uploads, as a **newly discovered bug,
vulnerability, or accidental oversight**. It may be listed as an **accepted,
documented risk** alongside the compensating controls below — but it must not be
presented as an error to be "fixed" by re-enabling App Check or blocking guest
uploads.

The compensating controls below **must remain in place**, and audits should verify
*those* instead: file-type (MIME) allowlist, size limit, storage path isolation,
per-company tenant/intake gating, rate limiting, no public Storage read, and the
Admin-SDK server submit path.

## Guest and public intake controls

| Control | Implementation |
|---------|----------------|
| IP rate limits | `checkRateLimit` on `getSignedUploadUrl`, `getSignedGuestUploadUrl`, `submitGuestApplication` |
| Tenant / intake gate | `assertCompanyAcceptingIntake` before upload path reservation, signed read URLs, and submit |
| MIME allowlist | `getSignedUploadUrl` (`storageSecure.js`) |
| Path isolation | Storage writes only under `companies/{id}/{applications\|autofill}/guest_uploads/` |
| No public Storage read | Storage rules: guest `create` only; `read` for company admins; guests use callable signed URLs |
| Short-lived preview URLs | `getSignedGuestUploadUrl` — 15-minute signed read URLs, path-validated |
| Primary submit path | `submitGuestApplication` via Admin SDK (Firestore client rules are fallback only) |

## Accepted gap: a direct Storage upload can bypass the backend helper

The controls above are the intended, best-effort path. The SafeHaul app calls the
`getSignedUploadUrl` backend helper (`functions/storageSecure.js`), which
**rate-limits per IP** (`checkRateLimit`) and **checks the company is accepting
intake** (`assertCompanyAcceptingIntake`) before returning an approved storage path.
A well-behaved client always goes through that helper.

However, the **actual file write** is a Firebase Storage SDK `uploadBytes` call
authorized by the **Storage rules** — not by a server-minted token.
`src/storage.rules` permits an **unauthenticated** `create` under
`companies/{companyId}/{applications|autofill}/guest_uploads/**` for any file that
passes the MIME-type and 20 MB size checks. A client that calls `uploadBytes`
**directly**, skipping `getSignedUploadUrl`, therefore **bypasses the backend rate
limit and the intake gate**; only the Storage-rule checks (file type, size, path
shape) apply on that direct path.

**This gap is understood and currently accepted** — it is the same
business/security tradeoff described above. App Check, the control that would close
it, blocked legitimate CDL and medical-card uploads, so it was removed, and reliable
driver submission is prioritized over closing this bypass.

- The current direct guest-upload behavior **must not be blocked or tightened**.
  Doing so risks re-introducing the exact upload failures that prevented drivers
  from submitting.
- Future audits may cite this **only as a documented, accepted risk** — never as an
  accidental defect or oversight.
- It should be **reconsidered only when a reliable replacement** can protect the
  direct-upload path (e.g. server-minted signed upload URLs, or an App Check /
  bot-mitigation configuration) **without blocking legitimate drivers** — verified
  against real mobile-camera, HEIC, and large-scan uploads before any enforcement.

## What is not a finding

- Absence of `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` or App Check debug tokens
- Guest Storage writes without `request.app`
- Unauthenticated callables for guest upload path, signed read URL, and application submit (with rate limits and validation)
- A direct Storage `uploadBytes` bypassing the `getSignedUploadUrl` rate limit / intake gate — see "Accepted gap" above (documented accepted risk, not a defect)

## Tradeoff

Without App Check, automated clients can invoke public callables. Mitigations are rate limiting, strict path validation, and no broad Storage read access. Re-enabling App Check would be a deliberate product change requiring client, rules, functions, and Console alignment.

## When to revisit this decision

Re-open this decision **only** when one of the following is true:

- The **guest-upload architecture changes** (e.g. uploads move fully behind a
  server-minted signed-URL / token flow, off direct Storage-rule writes), or
- A **reliable App Check / bot-mitigation configuration becomes available that does
  not block legitimate drivers** from uploading CDL and medical-card documents
  (verified against real mobile-camera, HEIC, and large-scan upload paths).

Absent one of those, the absence of App Check is the **intended current design** and
should be left as-is. Any future change here must be validated end-to-end against the
public CDL and medical-card upload flow **before** enforcement is turned on, so the
original driver-upload failures are not reintroduced.

## AI document analysis (AI Field Assistant)

`analyzeEdocFieldPlacement` sends rendered E-Doc page images to a third-party
vision provider. It is a **separate callable from the public CDL parser**
(`parseCdlWithGroq`) on purpose — the CDL path is reachable by unauthenticated
guests mid-application, and this one must not be.

Controls enforced in [`functions/edocFieldPlacement.js`](../functions/edocFieldPlacement.js):

- **Authentication** — `request.auth.uid` is required.
- **Tenancy** — `assertCompanyAccessForRequest` (the same strict RBAC check
  `getSigningLink` uses), plus an E-Docs feature check
  (`companies/{id}.features.eDocs !== false`).
- **Rate limits** — per user (12 / 60s) *and* per company (60 / 300s), both
  `fail-closed`, because each call spends money at a third party.
- **Payload ceilings** — at most 5 pages per request, ~2 MB per page image and
  ~7 MB total; only `data:image/(png|jpeg|webp);base64` inputs are accepted.
- **No arbitrary Storage access** — the client sends images it rendered itself.
  The callable takes no Storage path and reads no file.
- **No Firestore write** — the only datastore access is the company feature
  read (and the shared rate-limit counters).
- **No signing tokens** — none are accepted as input or returned. `scanId` is an
  opaque client correlation id, capped at 64 characters.
- **Server-side key only** — `GROQ_API_KEY` never reaches the browser; the model
  pin is resolved independently through the shared AI provider registry, so document analysis and
  CDL OCR can move independently.
- **Output validation** — every suggestion is checked against the supported
  signer field types and prefill bindings, its page must be one that was
  scanned, and its coordinates must be finite, in 0–100 %, and large enough to
  use. Anything else is dropped.

Privacy:

- Rendered page images exist only in browser memory for the duration of one scan
  and are never written to Storage, IndexedDB or localStorage.
- Nothing logs PDF content, base64 images, recipient details, signatures, tokens,
  or the provider's response text — only counts, ids and HTTP status codes.
- The UI discloses, in plain language and before the scan starts, that page
  images are sent to the configured AI provider.
- **We do not claim provider Zero Data Retention.** No ZDR configuration has
  been verified in this project's production account, so no such claim is made in
  the product or in these docs.

## Super Admin Environment & Integrations vault

The Super Admin **Environment & Integrations** view lists every configuration
value, deployment secret and stored integration credential SafeHaul uses, and can
reveal one at a time. The full operational description is in
[`docs/environment-and-integrations-runbook.md`](environment-and-integrations-runbook.md);
the security-relevant controls are:

| Control | Implementation |
|---------|----------------|
| Server-mediated only | Six narrow Cloud Functions callables. No client reads secret storage directly, and there is no generic environment-variable endpoint. |
| Exact role | `globalRole === 'super_admin'` only. Company admins, ordinary users and unauthenticated callers are rejected — no degraded read. |
| Recent authentication | Reveal and every mutation require `auth_time` within 15 minutes. A silent token refresh does not satisfy it; only `reauthenticateWithCredential` moves the claim. |
| Allowlisted lookup | Every entry identifier is resolved against the frozen registry before anything is read or written. `process.env` is never enumerated or serialised. |
| One value per request | A reveal returns exactly one value. Revealing one row can never surface another. |
| No ciphertext to the browser | Encrypted Firestore credentials are decrypted server-side; the stored ciphertext never leaves the backend. |
| Masked by default | The list response carries `maskedValue: '********'` and no plaintext, so there is nothing sensitive in the initial DOM to hide. |
| Automatic clearing | A revealed value clears after 30 seconds and immediately on a second press, another reveal, a view change, a hidden tab, unmount, sign-out or refresh. It is never written to `localStorage`, `sessionStorage`, IndexedDB, a data attribute, the URL, a log, an error, analytics or a Sentry breadcrumb, and is never auto-copied to the clipboard. |
| Fail-closed rate limits | 60 lists / 30 reveals / 10 mutations per 5 minutes per caller; a limiter error denies rather than allows. |
| Value-free audit | Every outcome, including denials, writes to `environment_audit_log` through an allowlist filter that cannot carry a value, ciphertext, a fragment or a length beyond the recorded `valueLength` integer. The collection denies all client access, including Super Admins. |
| Generic failures | Callable errors never contain plaintext, ciphertext or provider response text. |
| Protected keys stay readable, not writable | Sensitivity never removes the eye; infrastructure keys such as `SMS_ENCRYPTION_KEY` and `BULK_WORKER_SECRET` lose Edit, Replace, Add and Delete instead. |
| Honest unavailability | GitHub Actions cannot return a stored secret. Those rows stay listed, keep the eye, and report "The source does not permit reading the saved value." No value is invented or substituted. |

The vault does not change the existing SMS `IntegrationManager` workflow: that
form still never preloads stored credentials, `__PRESERVE__` still means "keep
what is stored", and line inventory, assignments and dedicated-line credentials
are untouched. The vault is a separate, explicitly authorised reveal path.

## Shared AI platform

| Control | Implementation |
| --- | --- |
| No feature calls a vendor directly | `scripts/check-ai-provider-boundary.mjs` fails CI on any vendor endpoint or SDK outside `functions/ai/providers/` |
| No generic prompt endpoint | Features import a named task from `functions/ai/tasks/`; there is no public AI callable and no passthrough |
| Capability is a hard gate | A provider that does not declare `vision` can never receive a CDL photograph or a document page, by construction rather than by configuration |
| Credentials never reach the browser | Stored in Secret Manager, read server-side, revealed only through the audited one-at-a-time path |
| A browser cannot name a secret | Names are *derived* from the frozen registry; `assertSafehaulAiSecret` is an independent second check on the final string |
| A browser cannot reshape a URL | Cloudflare's account id is pattern-validated before interpolation, and its model id rejects any `..` segment |
| Provider errors are never echoed | Only an HTTP status is carried forward. Several vendors quote the submitted prompt back inside their error bodies |
| Restricted content is never logged | On CDL and document paths only a failure category and provider id reach a log line — no prompt, response, excerpt or image |
| Telemetry is an allowlist | Anything not explicitly named is dropped rather than trusted |
| Exhaustion fails safe | When every capable provider fails, the caller gets a categorised error. Nothing is fabricated |
| Credential management is super-admin only | Exact `globalRole`, recent authentication for reveal and mutation, fail-closed rate limits, value-free audit records, shared with the environment vault |

The Groq migration is reversible by design: the legacy `GROQ_API_KEY` binding is
retained as a rollback path and read only when the managed credential is absent.
The cleanup procedure is in [`docs/ai-platform.md`](./ai-platform.md).

## News & Insights (public blog)

| Control | Implementation |
| --- | --- |
| Model output is never markup | The generator returns structured blocks; the renderer builds the HTML and escapes every value. No script, handler, `javascript:` link or embed survives |
| Only published articles are served | Every public read path filters on `status`, so a deleted article is indistinguishable from one that never existed |
| Slugs are validated, then only compared | An invalid slug gets the same 404 as an unknown one, so probing reveals nothing |
| Removed articles are not indexed | 404 responses carry `noindex, follow` |
| No internal metadata is public | Provider, model, generation record and source fingerprints never leave the server |
| The public surface is read-only | Non-GET methods get 405; no administrative action is reachable |
| Blog generation sees no private data | Public internet material plus the approved capability package only — never driver, applicant, employee or company data |
| Images are licensed or ours | Every stored image carries full licence metadata; anything incomplete is refused in favour of a SafeHaul-owned fallback |
| Unsupported claims are refused | A deterministic prohibited-claim check plus a separate AI verification step; if verification cannot run, nothing is published |

## Related files

- [`functions/environmentVault/`](../functions/environmentVault/) — configuration registry, guards, retrieval and audit
- [`functions/edocFieldPlacement.js`](../functions/edocFieldPlacement.js) — AI Field Assistant callable
- [`functions/ai/`](../functions/ai/) — the shared AI platform; provider adapters are the only code that knows a vendor wire format
- [`functions/storageSecure.js`](../functions/storageSecure.js) — upload path reservation
- [`functions/getSignedGuestUploadUrl.js`](../functions/getSignedGuestUploadUrl.js) — guest file preview URLs
- [`functions/guestApplication.js`](../functions/guestApplication.js) — guest submit
- [`src/storage.rules`](../src/storage.rules) — guest upload rules
- [`src/firestore.rules`](../src/firestore.rules) — fallback guest write rules

## Firebase Console (operations)

After deploy, ensure **App Check enforcement is Unenforced** (or disabled) for Storage, Cloud Functions, and Firestore so production traffic is not rejected for missing tokens.
