# SafeHaul core architecture

Technical reference for the patterns a change is most likely to get wrong.

**Read [`docs/APP_BRIEF.md`](docs/APP_BRIEF.md) first** — it owns what the
application is, its business rules, permissions, background jobs and preserved
decisions. This file covers only the mechanisms that need more depth than the
brief carries, and does not repeat it.

---

## 1. Frontend ↔ backend communication

Three patterns, used deliberately.

### A. Real-time listeners (Firestore SDK)

Dashboards, lead lists and application feeds use `onSnapshot`. Access control is
enforced entirely by `src/firestore.rules`, scoped by `companyId`.

### B. Direct SDK reads and writes

Several features read and write Firestore directly rather than through a
callable, to cut latency and function cost. The security rule is the whole
control in each case:

| Feature | Pattern | Enforced by |
|---|---|---|
| Templates | `addDoc` / `updateDoc` | `isCompanyTeam()` |
| Public slug resolution | `getDocs` over `public_profiles` where `appSlug == x` | Public read on the sanitized `public_profiles` mirror — **not** on `companies` |
| Unified search | Parallel `getDocs` queries | `isSuperAdmin()` |
| Performance data | Raw read from `stats_daily` | `isCompanyAdmin()` |
| Campaign status | `updateDoc` on `bulk_sessions` | `isCompanyTeam()` |

`public_profiles` is a projection that deliberately strips `features`,
`featureSchedules` and internal fields. If a company setting has no effect on
`/apply/:slug`, the projection allowlist is the first place to look.

### C. Callable Cloud Functions

Used only where a security rule cannot express the requirement: guest intake,
third-party API calls, credential handling and cross-tenant admin work. Mixed
`firebase-functions/v1` (callables) and `v2` (Firestore triggers, scheduled
functions). Both are production-stable; a full v2 migration is planned and not
urgent.

### D. Background triggers

Firestore triggers drive stats aggregation, PDF sealing, notifications and
driver-profile sync. See the App Brief for the full inventory.

---

## 2. Lead sourcing

Leads live entirely inside the owning company's `companies/{companyId}/leads`
subcollection and enter through three channels:

1. **Manual entry / Quick Add** — recruiters, from the company workspace.
2. **CSV / spreadsheet bulk import** — staged through `useCompanyLeadUpload`.
3. **Facebook Lead Ads webhook** — `functions/integrations/facebook.js` writes
   directly to the matched company subcollection.

> The earlier platform-wide **Lead Distribution Engine**, which fanned leads out
> on a daily cron, was **fully removed**. There is no `isPlatformLead`,
> `distributedAt`, `visitedCompanyIds` or `dailyLeadQuota` field. Do not
> reintroduce it, and do not treat its absence as a defect.

---

## 3. SMS credential resolution

A company has one messaging account but many recruiters, so credentials and the
sending number are resolved at call time, never inline.

### Adapter factory (`SMSAdapterFactory`)

1. Fetch the encrypted credentials from
   `companies/{id}/integrations/sms_provider`.
2. Decrypt them server-side with `SMS_ENCRYPTION_KEY`.
3. Instantiate the right provider adapter (RingCentral primary, 8x8 alternate).

Credentials are never sent to the client, and the encryption key exists only in
the Cloud Functions environment.

### The keychain (per-user routing)

`companies/{id}/integrations/sms_provider/keychain/{userId}` maps a recruiter to
their own "From" number. When `sendSMS` is called with a `userId`, the adapter
looks the number up here.

### Automatic fallback

A recruiter's direct line is often misconfigured or lacks SMS permission. Rather
than fail the send:

1. Attempt the send from the recruiter's assigned direct number.
2. If RingCentral returns a permission error (`FeatureNotAvailable`, or an
   invalid `From` number), retry from the **company main number**.
3. Only a failure of both surfaces an error to the user.

Implemented in `functions/integrations/adapters/ringcentral.js`.

---

## 4. Bulk campaign worker

`functions/bulkActions/` processes thousands of messages without hitting the
function timeout, using a recursive worker rather than one long-running call.

### Batching

`processBulkBatch` handles **50 recipients per invocation**
(`BATCH_SIZE` in `functions/bulkActions/workers/batchWorker.js`), advancing a
`currentPointer` and re-enqueuing itself through **Google Cloud Tasks**
(`functions/bulkActions/services/queueService.js`) until the audience is
exhausted.

### Zombie-worker prevention

A user can press Stop at any point, including while a batch is mid-flight, so
the worker re-reads session state repeatedly rather than trusting the state it
started with. Each of these reads is load-bearing — none is a redundant fetch:

1. **Entry check** — `status !== 'active'` exits before any work.
2. **Stale-generation check** — if the task payload carries a `workerGeneration`
   that no longer matches the session's, a newer Resume has already spawned a
   replacement worker and this one exits. Without it, resuming a paused campaign
   can leave two workers walking the same audience.
3. **Claim-transaction re-check** — the batch range is claimed inside a
   transaction that re-asserts `status === 'active'`.
4. **Per-recipient check** — the session document is re-read **before every
   send**, including the first, so a pause or cancel cannot slip one more
   message through after the batch has started. It breaks the loop rather than
   failing.
5. **Exit check** — after the batch, before writing the final progress and
   before re-enqueuing, the status is re-read. `cancelled` or `paused` stops
   here, and the next batch is enqueued only while the status is still `active`.

Removing any of these reintroduces a campaign that keeps sending after Stop.

### Session identity

Pause and Stop need the `companyId` and `sessionId`. The frontend takes them
from the global `DataContext` (`currentCompanyProfile.id`), **not** from URL
parameters, which are not reliably present on every entry path.

---

## 5. Where to read more

| Topic | Document |
|---|---|
| What the app is, business rules, preserved decisions | [`docs/APP_BRIEF.md`](docs/APP_BRIEF.md) |
| Collections, fields, access summary | [`docs/firestore-data-model.md`](docs/firestore-data-model.md) |
| Callable ↔ frontend map | [`docs/callable-frontend-map.md`](docs/callable-frontend-map.md) |
| Guest and public security posture | [`docs/security-posture.md`](docs/security-posture.md) |
| Shared AI platform | [`docs/ai-platform.md`](docs/ai-platform.md) |
| Hosting, releases, promotion | [`docs/FIREBASE_HOSTING_RUNBOOK.md`](docs/FIREBASE_HOSTING_RUNBOOK.md) |
