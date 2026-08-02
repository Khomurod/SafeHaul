/**
 * One-time / repeatable backfill of persisted normalized search fields on
 * application documents (see shared/searchNormalization.js).
 *
 * Safe to run multiple times: documents already carrying an up-to-date
 * fullNameNormalized/phoneNormalized set are rewritten with identical values
 * (idempotent merge). Super-admin only, mirroring backfillPublicProfiles.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db } = require('./firebaseAdmin');
const { buildApplicationSearchFields } = require('./shared/searchNormalization');

const BATCH_LIMIT = 400;

function assertSuperAdmin(request) {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const roles = request.auth.token.roles || {};
    const globalRole = request.auth.token.globalRole || roles.globalRole;
    if (globalRole !== 'super_admin') {
        throw new HttpsError('permission-denied', 'Only Super Admins can run backfills.');
    }
}

async function backfillCompanyApplications(companyId) {
    const appsRef = db.collection('companies').doc(companyId).collection('applications');
    const snapshot = await appsRef.get();

    let updated = 0;
    let batch = db.batch();
    let batchCount = 0;

    for (const docSnap of snapshot.docs) {
        const data = docSnap.data() || {};
        const fields = buildApplicationSearchFields({
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            phone: data.phone || data.phoneNumber,
            confirmationNumber: data.confirmationNumber,
            applicationId: data.applicationId || docSnap.id,
        });

        const needsUpdate = Object.entries(fields).some(([key, value]) => data[key] !== value);
        if (!needsUpdate) continue;

        batch.set(docSnap.ref, fields, { merge: true });
        updated++;
        batchCount++;

        if (batchCount >= BATCH_LIMIT) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }
    if (batchCount > 0) await batch.commit();

    return { scanned: snapshot.size, updated };
}

exports.backfillApplicationSearchFields = onCall({
    cors: true, region: 'us-central1', maxInstances: 1,
    timeoutSeconds: 540, memory: '512MiB',
}, async (request) => {
    assertSuperAdmin(request);

    const requestedCompanyId = request.data?.companyId;
    if (requestedCompanyId !== undefined && typeof requestedCompanyId !== 'string') {
        throw new HttpsError('invalid-argument', 'companyId must be a string when provided.');
    }

    try {
        const companyIds = requestedCompanyId
            ? [requestedCompanyId]
            : (await db.collection('companies').select().get()).docs.map((d) => d.id);

        let totalScanned = 0;
        let totalUpdated = 0;
        for (const companyId of companyIds) {
            const { scanned, updated } = await backfillCompanyApplications(companyId);
            totalScanned += scanned;
            totalUpdated += updated;
        }

        console.log(
            `[backfillApplicationSearchFields] companies=${companyIds.length} scanned=${totalScanned} updated=${totalUpdated}`
        );
        return {
            success: true,
            companies: companyIds.length,
            scanned: totalScanned,
            updated: totalUpdated,
        };
    } catch (error) {
        console.error('[backfillApplicationSearchFields] Error:', error);
        throw new HttpsError('internal', 'Backfill failed. Check function logs.');
    }
});

exports.__private = { backfillCompanyApplications };
