#!/usr/bin/env node
// scripts/backfill-activity-log-expiry.mjs
//
// B2 one-off backfill: stamp `expiresAt` (= createTime + 90d) on existing
// activity-log documents that predate the stampActivityLogExpiry trigger, so the
// eventual Firestore TTL policy ages them out too.
//
// SAFETY: dry-run by default — prints what it WOULD stamp and writes nothing.
// Re-run with `--commit` to write. It only ADDS `expiresAt` where missing; it
// never deletes anything. Run AFTER the BigQuery export is confirmed (see
// docs/production-readiness-runbook.md) and BEFORE enabling the TTL delete.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json \
//   FIREBASE_PROJECT=<projectId> node scripts/backfill-activity-log-expiry.mjs [--commit]

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve firebase-admin + the retention core from the functions package.
const require = createRequire(path.join(__dirname, '../functions/index.js'));

const { db } = require('./firebaseAdmin');
const { backfillExpiry, ACTIVITY_LOG_RETENTION_DAYS } = require('./shared/retention');

const commit = process.argv.includes('--commit');

(async () => {
    console.log(
        `[backfill] activity-log expiresAt (${ACTIVITY_LOG_RETENTION_DAYS}d) — ${commit ? 'COMMIT (writing)' : 'DRY RUN (no writes)'}`,
    );
    let totalStamped = 0;
    for (const collectionId of ['activity_logs', 'activities']) {
        const res = await backfillExpiry({ db, collectionId, commit, log: (m) => console.log(m) });
        totalStamped += res.stamped;
        console.log(`[backfill] ${collectionId}: ${JSON.stringify(res)}`);
    }
    console.log(
        commit
            ? `[backfill] done — stamped ${totalStamped} document(s).`
            : `[backfill] dry run complete — would stamp ${totalStamped} document(s). Re-run with --commit to write.`,
    );
    process.exit(0);
})().catch((e) => {
    console.error('[backfill] FAILED:', e);
    process.exit(1);
});
