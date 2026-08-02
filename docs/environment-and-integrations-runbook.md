# Environment & Integrations operations runbook

The Super Admin **Environment & Integrations** view is the single inventory of
every environment variable, deployment secret, runtime configuration value and
stored integration credential SafeHaul uses. This document is its operational
companion: what is listed, where each value actually lives, what can be read
back, what can be changed, and what to do when something goes wrong.

- Screen: Super Admin → Operations → **Environment & Integrations**
- Registry (source of truth): [`functions/environmentVault/registry.js`](../functions/environmentVault/registry.js)
- Callables: [`functions/environmentVault/index.js`](../functions/environmentVault/index.js)
- Audit collection: `environment_audit_log` (server-written, client-unreadable)

---

## 1. What is listed, and what is deliberately not

The inventory covers keys that are **referenced by SafeHaul**, **stored for a
SafeHaul integration**, or **used by SafeHaul deployment and operations**.
Unrelated operating-system variables are excluded, and so are Vite's own
built-ins (`DEV`, `PROD`, `MODE`, `BASE_URL`, `SSR`, `VITEST`) — they are build
metadata, not configuration.

Two guards keep the list honest, both in
[`functions/test/unit/environmentRegistry.inventory.test.js`](../functions/test/unit/environmentRegistry.inventory.test.js):

- the repository is scanned for `process.env.X`, `import.meta.env.X`,
  `defineSecret("X")`, `secrets: ['X']` and `${{ secrets.X }}`, and **any key
  that is not registered fails the build**;
- **any registered key that nothing references also fails the build**, unless it
  is declared in `UNREFERENCED_BY_DESIGN` with a stated reason. Two rows are
  synthetic by design: `firebase.default_project` (describes `.firebaserc`) and
  `signing.envelope_token_store` (describes the per-envelope token store, which
  is runtime data rather than configuration and is not enumerated per envelope).

`src/features/super-admin/config/browserVisibleEnvironment.test.js` is the
mirror-image guard on the client: a `VITE_*` variable the app reads but the
browser map cannot resolve fails there.

### Counts at the time of writing

| Area | Rows |
| --- | --- |
| Global registry entries | **73** |
| — browser / build (`vite-build`) | 16 |
| — Cloud Functions env (`functions-env`) | 12 |
| — Secret Manager (`secret-manager`) | 4 |
| — GitHub Actions secrets (`github-actions-secret`) | 20 |
| — Firebase runtime (`firebase-runtime`) | 4 |
| — workflow variable (`github-actions-variable`) | 1 |
| — repository config (`repo-config`) | 1 |
| — deployment / operations tooling (`local-tooling`) | 14 |
| — other infrastructure stores | 1 |
| Per-company credential **field templates** | **20** |
| — SMS provider configuration | 11 |
| — SMS dedicated-line keychain | 3 |
| — company SMTP email configuration | 4 |
| — connected Facebook page | 2 |

Company rows are expanded per tenant at list time, so the number of company rows
on screen is `fields × configured integrations`, not a fixed number.

### Why some keys appear twice

A `VITE_*` key is stored in **two** places with **different** permissions: as a
GitHub Actions repository secret, and inlined into the browser bundle at build
time. Those are genuinely different sources — one cannot be read back at all,
the other is already public in the shipped JavaScript — so each gets its own
row rather than one row that would be wrong about both.

---

## 2. The complete inventory

Value availability values:

| Value | Meaning |
| --- | --- |
| `browser-visible` | Already inlined in the shipped bundle; resolved in the browser. |
| `server-runtime` | Read from `process.env` inside the reveal callable. |
| `known-literal` | Non-secret value committed in the repository. |
| `firestore-encrypted` | Decrypted server-side from Firestore. |
| `firestore-plaintext` | Read server-side from an access-restricted Firestore document. |
| `not-retrievable` | **The source does not permit reading the saved value.** |

### 1. Browser / build variables (`source: vite-build`)

| Key | Integration | Sensitivity | Value availability | Reveal / Edit / Delete | Deploy needed |
| --- | --- | --- | --- | --- | --- |
| `VITE_DRIVER_APP_URL` | SafeHaul platform | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_E2E_TEST_MODE` | SafeHaul platform | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_FACEBOOK_APP_ID` | Facebook Lead Ads | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_FIREBASE_API_KEY` | Firebase | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_FIREBASE_APP_ID` | Firebase | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_FIREBASE_PROJECT_ID` | Firebase | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_RELEASE_SHA` | Sentry | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_SENTRY_DSN` | Sentry | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | Sentry | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_SOCRATA_APP_TOKEN` | Socrata (FMCSA) | internal | `browser-visible` | reveal / — / — | Yes |
| `VITE_SUPER_ADMIN_EMAIL` | SafeHaul platform | internal | `browser-visible` | reveal / — / — | Yes |
| `VITE_USE_DASHBOARD_SUMMARY` | SafeHaul platform | public | `browser-visible` | reveal / — / — | Yes |
| `VITE_USE_REAL_FIREBASE_IN_TESTS` | SafeHaul platform | public | `browser-visible` | reveal / — / — | Yes |

### 2. Cloud Functions environment variables (`source: functions-env`)

| Key | Integration | Sensitivity | Value availability | Reveal / Edit / Delete | Deploy needed |
| --- | --- | --- | --- | --- | --- |
| `APP_BASE_URL` | SafeHaul platform | public | `server-runtime` | reveal / — / — | Yes |
| `BULK_SESSION_MAX_SENDS` | SafeHaul platform | internal | `server-runtime` | reveal / — / — | Yes |
| `BULK_WORKER_SECRET` | SafeHaul platform | critical | `server-runtime` | reveal / — / — | Yes |
| `DOCUMENT_VISION_PROVIDER` | Groq (AI) | internal | `server-runtime` | reveal / — / — | Yes |
| `FACEBOOK_APP_SECRET_VALUE` | Facebook Lead Ads | critical | `server-runtime` | reveal / — / — | Yes |
| `FACEBOOK_VERIFY_TOKEN_VALUE` | Facebook Lead Ads | sensitive | `server-runtime` | reveal / — / — | Yes |
| `FUNCTION_REGION` | Google Cloud Tasks | internal | `server-runtime` | reveal / — / — | Yes |
| `GCP_REGION` | Google Cloud Tasks | internal | `server-runtime` | reveal / — / — | Yes |
| `GROQ_API_KEY` | Groq (AI) | critical | `server-runtime` | reveal / — / — | Yes |
| `GROQ_DOCUMENT_VISION_MODEL` | Groq (AI) | internal | `server-runtime` | reveal / — / — | Yes |
| `GROQ_VISION_MODEL` | Groq (AI) | internal | `server-runtime` | reveal / — / — | Yes |
| `PROCESS_BULK_BATCH_URL` | SafeHaul platform | internal | `server-runtime` | reveal / — / — | Yes |

### 3. Secret Manager-backed values (`source: secret-manager`)

| Key | Integration | Sensitivity | Value availability | Reveal / Edit / Delete | Deploy needed |
| --- | --- | --- | --- | --- | --- |
| `FACEBOOK_APP_ID` | Facebook Lead Ads | sensitive | `server-runtime` | reveal / — / — | Yes |
| `FACEBOOK_APP_SECRET` | Facebook Lead Ads | critical | `server-runtime` | reveal / — / — | Yes |
| `FACEBOOK_VERIFY_TOKEN` | Facebook Lead Ads | sensitive | `server-runtime` | reveal / — / — | Yes |
| `SMS_ENCRYPTION_KEY` | SafeHaul platform | critical | `server-runtime` | reveal / — / — | Yes |

### 4. GitHub Actions secrets (`source: github-actions-secret`)

| Key | Integration | Sensitivity | Value availability | Reveal / Edit / Delete | Deploy needed |
| --- | --- | --- | --- | --- | --- |
| `BULK_WORKER_SECRET` | SafeHaul platform | critical | `not-retrievable` | reveal / — / — | Yes |
| `FIREBASE_SERVICE_ACCOUNT_TRUCKERAPP_SYSTEM` | Firebase | critical | `not-retrievable` | reveal / — / — | Yes |
| `GITHUB_TOKEN` | GitHub Actions | sensitive | `not-retrievable` | reveal / — / — | Yes |
| `GROQ_API_KEY` | Groq (AI) | critical | `not-retrievable` | reveal / — / — | Yes |
| `PROCESS_BULK_BATCH_URL` | SafeHaul platform | internal | `not-retrievable` | reveal / — / — | Yes |
| `SENTRY_AUTH_TOKEN` | Sentry | critical | `not-retrievable` | reveal / — / — | Yes |
| `SENTRY_ORG` | Sentry | internal | `not-retrievable` | reveal / — / — | Yes |
| `SENTRY_PROJECT` | Sentry | internal | `not-retrievable` | reveal / — / — | Yes |
| `VITE_DRIVER_APP_URL` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | Yes |
| `VITE_FACEBOOK_APP_ID` | Facebook Lead Ads | public | `not-retrievable` | reveal / — / — | Yes |
| `VITE_FIREBASE_API_KEY` | Firebase | public | `not-retrievable` | reveal / — / — | Yes |
| `VITE_FIREBASE_APP_ID` | Firebase | public | `not-retrievable` | reveal / — / — | Yes |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase | public | `not-retrievable` | reveal / — / — | Yes |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase | public | `not-retrievable` | reveal / — / — | Yes |
| `VITE_FIREBASE_PROJECT_ID` | Firebase | public | `not-retrievable` | reveal / — / — | Yes |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase | public | `not-retrievable` | reveal / — / — | Yes |
| `VITE_SENTRY_DSN` | Sentry | public | `not-retrievable` | reveal / — / — | Yes |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | Sentry | public | `not-retrievable` | reveal / — / — | Yes |
| `VITE_SOCRATA_APP_TOKEN` | Socrata (FMCSA) | internal | `not-retrievable` | reveal / — / — | Yes |
| `VITE_SUPER_ADMIN_EMAIL` | SafeHaul platform | internal | `not-retrievable` | reveal / — / — | Yes |

### 5. Firebase runtime configuration (`source: firebase-runtime`)

| Key | Integration | Sensitivity | Value availability | Reveal / Edit / Delete | Deploy needed |
| --- | --- | --- | --- | --- | --- |
| `FIREBASE_CONFIG` | Firebase | internal | `server-runtime` | reveal / — / — | No |
| `FUNCTIONS_EMULATOR` | Firebase | public | `server-runtime` | reveal / — / — | No |
| `GCLOUD_PROJECT` | Firebase | public | `server-runtime` | reveal / — / — | No |
| `GCP_PROJECT` | Firebase | public | `server-runtime` | reveal / — / — | No |

### 6. Workflow variables (`source: github-actions-variable`)

| Key | Integration | Sensitivity | Value availability | Reveal / Edit / Delete | Deploy needed |
| --- | --- | --- | --- | --- | --- |
| `FIREBASE_PROJECT_ID` | Firebase | public | `known-literal` | reveal / — / — | No |

### 7. Repository configuration (`source: repo-config`)

| Key | Integration | Sensitivity | Value availability | Reveal / Edit / Delete | Deploy needed |
| --- | --- | --- | --- | --- | --- |
| `firebase.default_project` | Firebase | public | `known-literal` | reveal / — / — | No |

### 8. Deployment and operations tooling (`source: local-tooling`)

| Key | Integration | Sensitivity | Value availability | Reveal / Edit / Delete | Deploy needed |
| --- | --- | --- | --- | --- | --- |
| `CI` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `DEPLOY_FUNCTIONS_ALWAYS_INCLUDE` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `DEPLOY_FUNCTIONS_DRY_RUN` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `DEPLOY_FUNCTIONS_FORCE_FULL` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `DEPLOY_FUNCTIONS_SLEEP_SEC` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `DEPLOY_GIT_BASE` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `DEPLOY_GIT_HEAD` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `FIREBASE_STORAGE_EMULATOR_HOST` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `FIRESTORE_EMULATOR_HOST` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `GITHUB_PUSH_BEFORE` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `GITHUB_SHA` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `npm_execpath` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `PW_CHROMIUM_EXECUTABLE` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |
| `RULES_STRESS_LOOPS` | SafeHaul platform | public | `not-retrievable` | reveal / — / — | No |

### 9. Other infrastructure stores

| Key | Integration | Sensitivity | Value availability | Reveal / Edit / Delete | Deploy needed |
| --- | --- | --- | --- | --- | --- |
| `signing.envelope_token_store` | SafeHaul e-signature | critical | `not-retrievable` | reveal / — / — | No |
### 10. Per-company integration credentials

Company rows are expanded from four templates. Each **field** is its own row with
its own permission policy — an integration document is never treated as one
secret.

#### `companies/{companyId}/integrations/sms_provider`

| Field | Stored as | Sensitivity | Reveal | Edit / Replace | Delete |
| --- | --- | --- | --- | --- | --- |
| `provider` | plaintext | public | Yes | No — cannot change while referenced | No |
| `config.clientId` (RingCentral) | encrypted | sensitive | Yes | Yes | No — referenced |
| `config.clientSecret` (RingCentral) | encrypted | critical | Yes | Yes | No — referenced |
| `config.jwt` (RingCentral) | encrypted | critical | Yes | Yes | Yes |
| `config.apiKey` (8x8) | encrypted | critical | Yes | Yes | No — referenced |
| `config.apiSecret` (8x8) | encrypted | critical | Yes | Yes | Yes |
| `config.subAccountId` (8x8) | encrypted | internal | Yes | Yes | Yes |
| `config.phoneNumber` | encrypted | internal | Yes | Yes | Yes |
| `config.senderId` | encrypted | internal | Yes | Yes (add supported) | Yes |
| `config.isSandbox` | plaintext boolean | public | Yes | Yes | No — referenced |
| `defaultPhoneNumber` | plaintext | internal | Yes | No — generated | No — referenced |

Provider-specific credentials are only listed when that provider is the company's
active one, so a RingCentral tenant does not accumulate phantom "missing" 8x8
rows. The `provider` row additionally carries the **Test integration** action,
which connects with the stored credentials through the same adapters the product
sends with and reports identity only.

#### `companies/{companyId}/integrations/sms_provider/keychain/{line}`

| Field | Stored as | Sensitivity | Reveal | Edit | Delete |
| --- | --- | --- | --- | --- | --- |
| `jwt` | encrypted | critical | Yes | No — replace the line through the Digital Wallet so its JWT is re-verified | No — referenced |
| `clientId` | encrypted | sensitive | Yes | No — same | No — referenced |
| `clientSecret` | encrypted | critical | Yes | No — same | No — referenced |

#### `companies/{companyId}/system_settings/email_config`

| Field | Stored as | Sensitivity | Reveal | Edit | Delete |
| --- | --- | --- | --- | --- | --- |
| `smtpHost` | plaintext | internal | Yes | No — edit in Company Settings so the connection is re-tested | No — referenced |
| `smtpPort` | plaintext | public | Yes | No — same | No — referenced |
| `smtpUser` | plaintext | internal | Yes | No — same | No — referenced |
| `smtpPass` | plaintext | critical | Yes | No — same | No — referenced |

`smtpPass` is plaintext at rest by a deliberate earlier decision recorded in
[`functions/saveEmailSettings.js`](../functions/saveEmailSettings.js): the
subcollection is admin-only, and encryption had caused double-encryption
corruption. This vault does not change that; it inventories it.

#### `integrations_index/{pageId}` — connected Facebook page

| Field | Stored as | Sensitivity | Reveal | Edit | Delete |
| --- | --- | --- | --- | --- | --- |
| `accessToken` | plaintext | critical | Yes | No — read-only generated value | No — referenced |
| `pageName` | plaintext | public | Yes | No — same | No — referenced |

---

## 3. Reveal: what happens, in order

1. The operator presses the eye on one row. The accessible name says which key —
   "Reveal `SMS_ENCRYPTION_KEY`" / "Hide `SMS_ENCRYPTION_KEY`".
2. The browser calls `revealEnvironmentValue` with **one** entry identifier.
3. The callable requires an authenticated caller with **exactly**
   `globalRole === 'super_admin'`. Company admins and ordinary users are
   rejected, not degraded.
4. It requires the caller to have authenticated within the last **15 minutes**
   (`auth_time`). A stale session raises `REAUTH_REQUIRED`; the UI asks for the
   password, re-authenticates, and retries the same reveal. A silent token
   refresh does not satisfy this — only a real credential check moves
   `auth_time`.
5. A fail-closed rate limit applies (30 reveals per 5 minutes per caller).
6. The entry identifier is resolved **against the frozen registry**. An
   unregistered name is rejected with `not-found`; `process.env` is never
   enumerated and never serialised.
7. The value is retrieved per source (see the table in §2). Encrypted Firestore
   fields are decrypted server-side; **ciphertext is never returned to the
   browser**.
8. An audit record is written with the actor, action, key, integration, scope,
   company, source and result — and **no value**.
9. The value renders in that row only, with a visible "Hides automatically in
   *n*s" countdown.
10. It is cleared after 30 seconds, or immediately on: a second press of the eye,
    revealing another row, switching Super Admin view, the browser tab becoming
    hidden, the row unmounting, sign-out, or a page refresh.

Only the row being revealed has its control disabled, so a second reveal can be
started while the first is still in flight. Every request carries a generation
number and a response that is no longer current is discarded — otherwise a slow
first response could land last and put an already-evicted value back on screen,
attached to the wrong row. An explicit hide bumps the generation too, so a
request already in the air cannot undo it.

If the prompt in step 4 is **dismissed**, the operation never ran. Nothing is
revealed, nothing is written, no success is reported and no error is shown: a
cancelled action is not a failed one. A mutation dialog stays open with the
entered value intact so it can be retried.

Nothing is copied to the clipboard automatically. A revealed value lives in React
state and nowhere else — not `localStorage`, `sessionStorage`, IndexedDB, a data
attribute, the URL, a console line, an error, an analytics event or a Sentry
breadcrumb.

### The one source that cannot answer

**GitHub Actions never returns a stored secret's plaintext through its API.**
Those rows keep their eye control and, when pressed, report:

> The source does not permit reading the saved value.

They are **not** omitted, and no value is invented, reconstructed or substituted.
Their status is reported as *Not retrievable* rather than a guess.

---

## 4. Permissions model

Every row states which of Reveal, Edit, Replace, Add, Delete and Test are
available, and every unavailable one stays on screen with its reason. The
controls use `aria-disabled` rather than `disabled` so that reason — carried in
the accessible name and repeated as a tooltip — stays reachable by keyboard and
screen reader.

| Reason shown | Applies to |
| --- | --- |
| Managed by deployment | `vite-build`, most `functions-env` |
| Protected infrastructure key | `secret-manager`, `BULK_WORKER_SECRET`, Facebook legacy env copies |
| Source does not support editing | `github-actions-secret`, `local-tooling` |
| Injected by the platform at runtime | `firebase-runtime`, `repo-config` |
| Cannot be deleted while referenced | credentials the active integration needs |
| Read-only generated value | `defaultPhoneNumber`, Facebook page token |

**Sensitivity never removes the eye.** `SMS_ENCRYPTION_KEY` and
`BULK_WORKER_SECRET` are revealable; what they lose is Edit, Replace, Add and
Delete.

The server re-derives all of this from the registry and the live document on
every mutation, so a client that edits its own payload cannot widen what it may
do.

---

## 5. Editing, adding and deleting

**Editing** is supported only for company SMS provider configuration fields. The
dialog:

- opens with an **empty** field — the current value is never preloaded, which
  would put a secret on screen with no reveal, no timer and no audit record, and
  would risk the double-encryption failure the SMS form documents;
- names the key and its known consumers;
- validates server-side, writes **only** that field (siblings, `inventory`,
  `assignments`, `defaultPhoneNumber` and the keychain are untouched), then
  re-reads and compares the round-tripped value before reporting success;
- refuses the `__PRESERVE__` sentinel, which the SMS form uses to mean "keep what
  is stored" and which would otherwise be written as a literal credential;
- writes an audit record carrying the value's **length** and nothing else.

**Adding** is allowed only where the source genuinely supports it — currently
optional SMS provider fields that have no stored value. Key names are validated
against a reserved-namespace list (`FIREBASE_`, `GOOGLE_`, `GCLOUD_`, `GCP_`,
`GITHUB_`, `NODE_`, `NPM_`, `FUNCTION_`, `FUNCTIONS_`, `K_SERVICE`, `PATH`,
`HOME`, …). Adding a name to the registry alone does **not** make SafeHaul
consume it, and the UI does not claim otherwise.

**Deleting** requires the exact key name typed back. The server independently
re-checks the typed string against the key it is about to delete, so a stale
dialog cannot remove the wrong field. Only that field is removed.

**Deployment-required entries** (`vite-build`, `functions-env`,
`secret-manager`, `github-actions-secret`) are read-only here and are marked
*Needs deployment*. The UI never claims the live application changed before a
deployment completes.

---

## 6. Audit trail

`environment_audit_log`, written only by the Admin SDK. `src/firestore.rules`
denies all client reads and writes — including Super Admins — so the record
cannot be forged or read around the callable. The page shows recent activity
through `listEnvironmentAndIntegrations`.

Each record carries: actor UID, actor email (when it is a real address), action,
result, key identifier, integration, scope, company ID, source, category,
sensitivity, availability, an optional reason, an optional value **length**, and
a server timestamp.

It never carries plaintext, ciphertext, a partial value, a token fragment, a
password or a private key. `sanitizeMetadata` in
[`functions/environmentVault/audit.js`](../functions/environmentVault/audit.js)
is an allowlist filter, not a convention: a future caller cannot widen the record
by passing an extra property.

Denials are recorded too — an unauthenticated call, a company admin, a stale
session, a rate-limit rejection and a confirmation mismatch all leave a trace.

---

## 7. Operational recovery

**"Every Secret Manager row says Missing."**
The vault callables must bind the secrets to see them. Check that
`functions/environmentVault/index.js` still declares
`secrets: ['SMS_ENCRYPTION_KEY', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_VERIFY_TOKEN']`
— `functions/test/unit/smsSecretBindings.test.js` guards this — and redeploy.

**"A company credential will not decrypt."**
`SMS_ENCRYPTION_KEY` has changed. Every existing ciphertext was encrypted with
the previous key and is unrecoverable without it. Restore the previous key
version in Secret Manager; if it is genuinely lost, each affected company must
re-enter its credentials through the existing SMS Integrations workflow. This is
why the key is Reveal-only and has no Edit, Replace or Delete control here.

**"A GitHub Actions secret shows as Not retrievable."**
That is correct and expected — GitHub does not return stored secrets. To confirm
what is set, look at the repository's Actions secrets page; to change one, rotate
it there and re-run the deploy workflow.

**"A build-time value is wrong in production."**
Update the corresponding GitHub Actions secret and re-run
`CI/CD Pipeline` on `main`. The value only reaches the browser through a new
build; the vault marks these rows *Needs deployment* and does not pretend
otherwise.

**"Reveal returns `resource-exhausted`."**
The fail-closed rate limiter tripped (30 reveals or 10 mutations per 5 minutes
per caller). Wait for the window to pass. Repeated hits from one operator are
worth investigating in `environment_audit_log`.

**"Every action asks me to re-authenticate."**
The 15-minute recency window has lapsed. Enter the password when prompted; the
original action is retried automatically, exactly once. Dismissing the prompt
cancels the action cleanly — nothing is written and nothing is claimed. If
re-authentication itself fails, the signed-in account may not have a password
credential (federated sign-in); in that case sign out and sign in again.

**"Company rows are missing but global rows are fine."**
The inventory reports a partial failure rather than blanking the page. The
Firestore collection-group reads failed; check Firestore availability and the
Cloud Functions service account's read permissions, then Retry.

---

## 8. Deliberate limitations

- **The server cannot see build-time browser values.** Status and value for
  `vite-build` rows are resolved in the browser, from the bundle that actually
  carries them. That is the only correct answer available, and the row says so.
- **Per-envelope signing tokens are not enumerated.** They are runtime data
  minted and destroyed per signing request, not configuration. One synthetic row
  documents the store.
- **Company rows are only emitted for integrations that exist.** A company with
  no SMS provider configured has no credentials to inventory; emitting a dozen
  "missing" rows per tenant would bury real gaps. Fields absent *on an existing*
  integration document do get a `missing` row.
- **`listEnvironmentAndIntegrations` reads company names with a 1000-document
  cap.** Beyond that, rows fall back to showing the company ID.
