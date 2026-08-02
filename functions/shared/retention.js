// functions/shared/retention.js
//
// B2: tiered retention for activity logs. The hot copy lives in Firestore for a
// 90-day in-app window; everything is streamed to BigQuery for durable FCRA /
// compliance audit (a Console step — see docs/production-readiness-runbook.md);
// only AFTER BigQuery is confirmed receiving data may a Firestore TTL policy on
// `expiresAt` delete the hot copy. This module owns the SINGLE server-side
// chokepoint that stamps `expiresAt` so no client/Cloud-Function writer can be
// missed, plus the one-off backfill core (kept dependency-light + testable).

const { admin } = require('../firebaseAdmin');

const ACTIVITY_LOG_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic expiry timestamp = creation time + N days. Deterministic (keyed
 * off the doc's own createTime, not wall-clock now) so retries are idempotent.
 *
 * @param {number} createdMs epoch ms of the doc's creation.
 * @param {number} [days]
 * @returns {FirebaseFirestore.Timestamp}
 */
function computeExpiresAt(createdMs, days = ACTIVITY_LOG_RETENTION_DAYS) {
    return admin.firestore.Timestamp.fromMillis(createdMs + days * DAY_MS);
}

/**
 * Stamp `expiresAt` on a freshly-created activity-log doc, if absent.
 * Idempotent: skips docs that already carry `expiresAt`.
 *
 * @param {{ data?: FirebaseFirestore.DocumentSnapshot }} event onDocumentCreated event.
 * @param {number} [days]
 */
async function stampExpiryOnCreate(event, days = ACTIVITY_LOG_RETENTION_DAYS) {
    const snap = event && event.data;
    if (!snap) return;
    const data = (typeof snap.data === 'function' && snap.data()) || {};
    if (data.expiresAt) return; // already stamped — nothing to do
    const createdMs = snap.createTime ? snap.createTime.toMillis() : Date.now();
    await snap.ref.set({ expiresAt: computeExpiresAt(createdMs, days) }, { merge: true });
}

/**
 * One-off backfill: stamp `expiresAt` on existing collection-group docs that lack
 * it. Dry-run by default — only writes when `commit === true`. Paginates by
 * `__name__` (always available, no composite index) for stable iteration.
 *
 * @param {object} opts
 * @param {FirebaseFirestore.Firestore} opts.db
 * @param {string} opts.collectionId collection-group id (e.g. 'activity_logs').
 * @param {number} [opts.days]
 * @param {boolean} [opts.commit] when false (default) nothing is written.
 * @param {number} [opts.pageSize]
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{collectionId:string, scanned:number, stamped:number, alreadyStamped:number, committed:boolean}>}
 */
async function backfillExpiry({
    db,
    collectionId,
    days = ACTIVITY_LOG_RETENTION_DAYS,
    commit = false,
    pageSize = 400,
    log = () => {},
}) {
    let scanned = 0;
    let stamped = 0;
    let alreadyStamped = 0;
    let last = null;

    for (;;) {
        let q = db.collectionGroup(collectionId).orderBy('__name__').limit(pageSize);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty) break;

        const batch = commit ? db.batch() : null;
        let batchWrites = 0;
        for (const doc of snap.docs) {
            scanned++;
            const d = (typeof doc.data === 'function' && doc.data()) || {};
            if (d.expiresAt) {
                alreadyStamped++;
                continue;
            }
            const createdMs = doc.createTime ? doc.createTime.toMillis() : Date.now();
            if (commit) {
                batch.set(doc.ref, { expiresAt: computeExpiresAt(createdMs, days) }, { merge: true });
                batchWrites++;
            }
            stamped++;
        }
        if (commit && batchWrites > 0) await batch.commit();

        last = snap.docs[snap.docs.length - 1];
        log(`  ${collectionId}: scanned ${scanned}, ${commit ? 'stamped' : 'would stamp'} ${stamped} (skipped ${alreadyStamped})`);
        if (snap.size < pageSize) break;
    }

    return { collectionId, scanned, stamped, alreadyStamped, committed: commit };
}

module.exports = {
    ACTIVITY_LOG_RETENTION_DAYS,
    DAY_MS,
    computeExpiresAt,
    stampExpiryOnCreate,
    backfillExpiry,
};
