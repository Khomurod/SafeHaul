# Production Readiness Runbook

This runbook defines operations ownership, alerting responses, quota controls, and rollback steps required for production hardening.

## Ownership Matrix

- Frontend incidents: Web Platform team
- Cloud Functions incidents: Backend Platform team
- Auth/RBAC incidents: Security owner
- Messaging incidents (SMS/Email): Integrations owner

## Alert Triggers

- Function error rate > 5% for 10 minutes
- `permission-denied` spikes on sensitive callables
- SMS send failures > 20% for 10 minutes
- Queue backlog growth without drain for 15 minutes

## Immediate Incident Actions

1. Triage severity and assign incident commander.
2. Confirm blast radius (single tenant vs multi-tenant).
3. Freeze deployments if severity is high.
4. Apply rollback if latest deploy is implicated.
5. Publish stakeholder update every 15 minutes until stabilized.

## Rollback Procedure

1. Identify previous successful workflow run and release SHA.
2. Redeploy previous known-good Hosting + Functions revisions.
3. Validate smoke checks:
   - Auth login
   - `initBulkSession`
   - `sendSMS` (non-production dry-run tenant)
   - `submitGuestApplication`
4. Reopen traffic once errors return to baseline.

## Quotas and Rate Caps

- SMS/test SMS: per-company and per-user rate limits (server-side).
- Public verification endpoints: fail-closed rate limiting.
- Guest upload/submit: callable rate limits + path validation (see [security-posture.md](security-posture.md); App Check not used).

## Bulk SMS / email campaigns

Campaign launch (`initBulkSession`) enqueues work to `processBulkBatch` via Google Cloud Tasks.

### Required Cloud Functions environment variables

Set on **both** `initBulkSession` and `processBulkBatch` (same values):

| Variable | Description |
|----------|-------------|
| `PROCESS_BULK_BATCH_URL` | HTTPS trigger URL for `processBulkBatch` (Cloud Run). Example shape: `https://processbulkbatch-<hash>-uc.a.run.app` — copy from Firebase Console → Functions → `processBulkBatch`. |
| `BULK_WORKER_SECRET` | Shared secret sent as header `X-SafeHaul-Internal-Auth`; must match on worker and enqueue path. Use 32+ random characters. |

CI deploy writes these from GitHub Actions secrets `PROCESS_BULK_BATCH_URL` and `BULK_WORKER_SECRET` into `functions/.env` (see `.github/workflows/main.yml`). Local emulator: copy [`functions/.env.example`](../functions/.env.example) to `functions/.env`.

### Cloud Tasks queue

- **Project:** `truckerapp-system`
- **Region:** `us-central1`
- **Queue name:** `bulk-actions-queue` (must match [`functions/bulkActions/services/queueService.js`](../functions/bulkActions/services/queueService.js))

Create if missing:

```bash
gcloud tasks queues create bulk-actions-queue --location=us-central1 --project=truckerapp-system
```

The Functions runtime service account needs permission to create tasks on this queue (`roles/cloudtasks.enqueuer` or broader).

### Post-deploy verification

1. Launch a campaign from Company Admin → Campaigns.
2. Firebase logs for `initBulkSession` should include `[enqueueWorker] Task created for session …` (not `PROCESS_BULK_BATCH_URL env var is missing`).
3. Firestore: `companies/{companyId}/bulk_sessions/{sessionId}` with `status: 'active'`.
4. Optional: `progress.processedCount` increases and `logs` subcollection receives entries (requires valid SMS integration).

## B2 — `activity_logs` tiered retention (90-day hot + BigQuery durable)

**Decision (made):** keep **90 days** of activity logs hot in Firestore for in-app
history; stream **everything** to BigQuery for durable FCRA / compliance audit;
TTL-delete the hot copy **only after** BigQuery is confirmed receiving data.
Losing hiring audit records is unacceptable, so the destructive TTL step is gated
behind a verified, live export.

### Already shipped in code (non-destructive)

- Collection-group triggers `stampActivityLogExpiry` / `stampLegacyActivityExpiry`
  (`functions/activityLogRetention.js`) stamp `expiresAt = createTime + 90d` on
  every new activity-log doc under
  `companies/{companyId}/{applications|leads}/{parentId}/{activity_logs|activities}/{logId}`.
  Idempotent; skips docs already stamped. (`ACTIVITY_LOG_RETENTION_DAYS` lives in
  `functions/shared/retention.js`.)
- One-off backfill for pre-existing docs: `scripts/backfill-activity-log-expiry.mjs`
  (**dry-run by default**; `--commit` to write; only ever ADDS `expiresAt`).

> `expiresAt` does **nothing** on its own — Firestore deletes only when a TTL
> **policy** is enabled on the field (step 4). Shipping the trigger + backfill is
> therefore safe and reversible.

### Ordered ops steps (perform in this exact order)

> **GATE 0 — stakeholder sign-off.** Obtain a one-line written confirmation that
> the **90-day** in-app window is acceptable for compliance before step 4. For a
> longer window, change `ACTIVITY_LOG_RETENTION_DAYS`, redeploy, and re-run the
> backfill first.

1. **Install the BigQuery export extension** (durable copy): Firebase Console →
   Extensions → **Stream Firestore to BigQuery** (`firestore-bigquery-export`) for
   the activity-log collection groups (`activity_logs` and legacy `activities`).
   Dataset e.g. `firestore_export`.
2. **Verify rows land in BigQuery for ≥ the hot window.** Query the changelog
   table (e.g. `firestore_export.activity_logs_raw_changelog`) and confirm new
   writes appear and counts match Firestore. **Do not proceed until confirmed for
   several days of real traffic.**
3. **Run the backfill** so old docs also carry `expiresAt`:
   ```bash
   cd functions   # provides firebase-admin + the retention core
   GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json node ../scripts/backfill-activity-log-expiry.mjs        # dry run
   GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json node ../scripts/backfill-activity-log-expiry.mjs --commit
   ```
4. **Enable the Firestore TTL policy** on `expiresAt` (**destructive — only after
   1–3 + GATE 0**):
   ```bash
   gcloud firestore fields ttls update expiresAt --collection-group=activity_logs --enable-ttl --project=truckerapp-system
   gcloud firestore fields ttls update expiresAt --collection-group=activities   --enable-ttl --project=truckerapp-system
   ```
5. **Repoint long-range admin reports at BigQuery** — any report reading history
   older than 90 days must query the BigQuery dataset (the hot copy no longer has
   it). In-app history for the 90-day window is unaffected.

### Rollback

- Disable the TTL policy (`gcloud firestore fields ttls update expiresAt
  --collection-group=activity_logs --disable-ttl`) to stop deletions immediately.
- Trigger/backfill only add a field; with the policy off, `expiresAt` is inert.
  Data already TTL-deleted is recoverable only from BigQuery — hence the gate on
  step 2.

## Post-Incident Review

- Complete root cause analysis within 48 hours.
- Add regression test and monitoring rule for the failure mode.
- Track action items until closure.
