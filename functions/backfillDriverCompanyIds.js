// functions/backfillDriverCompanyIds.js
//
// SEC-002 follow-up: one-time (idempotent) backfill that populates
// drivers/{id}.companyIds from EXISTING applications and leads.
//
// WHY: the SEC-002 rules let same-company staff read a driver profile only when
// the caller's companyTeamIds claim intersects drivers/{id}.companyIds. Going
// forward, driverSync.processDriverData stamps companyIds via arrayUnion. This
// callable seeds existing driver docs so a driver who applied/was-imported
// before the fix is also visible to their company's staff.
//
// Approach: scan the `applications` and `leads` collection groups, map each doc
// to (companyId-from-path) + the driver ids it references, then arrayUnion those
// company ids onto driver docs THAT ALREADY EXIST (never creates a driver doc).
//
// Safe to run multiple times. Super-admin only. Rate limited.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("./firebaseAdmin");
const { checkRateLimit } = require("./shared/rateLimiter");

const PAGE_SIZE = 500;
const GETALL_CHUNK = 250;
const UPDATE_BATCH = 400;

function hasSuperAdminRole(claims = {}) {
    const globalRole = claims.globalRole || claims.roles?.globalRole;
    return globalRole === 'super_admin';
}

/** companyId is the 2nd path segment: companies/{companyId}/(applications|leads)/{id}. */
function companyIdFromPath(path) {
    const parts = String(path || '').split('/');
    if (parts[0] !== 'companies' || !parts[1]) return null;
    return parts[1];
}

/** Driver ids an application/lead may reference (auth uid, deterministic id, legacy userId). */
function candidateDriverIds(data = {}) {
    return [data.driverId, data.applicantId, data.userId]
        .filter((v) => typeof v === 'string' && v.length > 0);
}

/** Full collection-group scan (documentId-paginated) accumulating driverId -> Set(companyId). */
async function accumulate(collectionName, map) {
    let lastDoc = null;
    let scanned = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        let q = db.collectionGroup(collectionName)
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(PAGE_SIZE);
        if (lastDoc) q = q.startAfter(lastDoc);

        const snap = await q.get();
        if (snap.empty) break;

        for (const d of snap.docs) {
            const companyId = companyIdFromPath(d.ref.path);
            if (!companyId) continue;
            for (const driverId of candidateDriverIds(d.data())) {
                if (!map.has(driverId)) map.set(driverId, new Set());
                map.get(driverId).add(companyId);
            }
            scanned++;
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < PAGE_SIZE) break;
    }
    return scanned;
}

exports.backfillDriverCompanyIds = onCall(
    { cors: true, timeoutSeconds: 540, memory: '1GiB' },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

        const userRecord = await admin.auth().getUser(request.auth.uid);
        const claims = userRecord.customClaims || {};
        if (!hasSuperAdminRole(claims)) {
            throw new HttpsError('permission-denied', 'Super admin access required.');
        }

        const isAllowed = await checkRateLimit(`backfill_driver_companyids_${request.auth.uid}`, 3, 3600, 'closed');
        if (!isAllowed) throw new HttpsError('resource-exhausted', 'Too many backfill requests. Please wait.');

        const { dryRun = true } = request.data || {};

        // 1. Build driverId -> [companyId] from applications + leads.
        const map = new Map();
        const appsScanned = await accumulate('applications', map);
        const leadsScanned = await accumulate('leads', map);

        // 2. Stamp companyIds onto EXISTING driver docs only (never create one).
        const driverIds = Array.from(map.keys());
        let driversUpdated = 0;
        let driversMissing = 0;

        for (let i = 0; i < driverIds.length; i += GETALL_CHUNK) {
            const chunk = driverIds.slice(i, i + GETALL_CHUNK);
            const refs = chunk.map((id) => db.collection('drivers').doc(id));
            const snaps = await db.getAll(...refs);

            let batch = db.batch();
            let pending = 0;
            for (const snap of snaps) {
                if (!snap.exists) { driversMissing++; continue; }
                const companyIds = Array.from(map.get(snap.id));
                if (!dryRun) {
                    batch.set(
                        snap.ref,
                        { companyIds: admin.firestore.FieldValue.arrayUnion(...companyIds) },
                        { merge: true },
                    );
                    pending++;
                    if (pending >= UPDATE_BATCH) {
                        await batch.commit();
                        batch = db.batch();
                        pending = 0;
                    }
                }
                driversUpdated++;
            }
            if (!dryRun && pending > 0) await batch.commit();
        }

        console.log(`[backfillDriverCompanyIds] ${dryRun ? 'DRY-RUN' : 'LIVE'} — apps=${appsScanned} leads=${leadsScanned} driversUpdated=${driversUpdated} driversMissing=${driversMissing}`);
        return {
            success: true,
            dryRun,
            applicationsScanned: appsScanned,
            leadsScanned,
            driverProfilesUpdated: driversUpdated,
            referencedDriverIdsWithoutProfile: driversMissing,
            message: `${dryRun ? 'Would stamp' : 'Stamped'} companyIds on ${driversUpdated} existing driver profiles.`,
        };
    }
);
