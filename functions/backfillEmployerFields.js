const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}
const firestore = admin.firestore();

const BATCH_LIMIT = 200;
const WRITE_BATCH_LIMIT = 400;

function normalizeEmployer(emp = {}) {
    return {
        companyName: emp.companyName || emp.name || emp.company || '',
        address: emp.address || emp.street || emp.location || emp.addr || '',
        city: emp.city || emp.town || '',
        state: emp.state || '',
        phone: emp.phone || emp.phoneNumber || emp.contact || '',
        position: emp.position || emp.title || '',
        startDate: emp.startDate || emp.from || null,
        endDate: emp.endDate || emp.to || null,
        reasonForLeaving: emp.reasonForLeaving || emp.reason || '',
        supervisorName: emp.supervisorName || emp.supervisor || '',
        mayContact: (typeof emp.mayContact === 'boolean') ? emp.mayContact : (emp.mayContact === 'yes' || emp.mayContact === true)
    };
}

async function processBatch(snapshot, dryRun) {
    let updated = 0;
    const batch = firestore.batch();
    let writes = 0;

    for (const doc of snapshot.docs) {
        const dataDoc = doc.data();
        let employers = dataDoc.employers || dataDoc.employment || dataDoc.employer || [];
        if (employers && !Array.isArray(employers) && typeof employers === 'object') employers = [employers];
        if (!Array.isArray(employers)) employers = [];

        const normalized = employers.map(normalizeEmployer);
        let needsUpdate = false;

        if (normalized.length > 0) {
            for (let i = 0; i < normalized.length; i++) {
                const orig = employers[i] || {};
                const norm = normalized[i];
                if ((!orig.companyName && norm.companyName) ||
                        (!orig.address && norm.address) ||
                        (!orig.reasonForLeaving && norm.reasonForLeaving) ||
                        (!orig.supervisorName && norm.supervisorName)) {
                    needsUpdate = true;
                    break;
                }
            }
        }

        if (needsUpdate) {
            updated++;
            if (!dryRun) {
                batch.update(doc.ref, { employers: normalized, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                writes++;
                if (writes >= WRITE_BATCH_LIMIT) {
                    await batch.commit();
                    // start a fresh batch
                    writes = 0;
                }
            }
        }
    }

    if (!dryRun && writes > 0) {
        await batch.commit();
    }

    return updated;
}

exports.backfillEmployerFields = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }
    const roles = context.auth.token.roles || {};
    const globalRole = context.auth.token.globalRole || roles.globalRole;
    if (globalRole !== 'super_admin') {
        throw new functions.https.HttpsError('permission-denied', 'Only super_admin can run backfill');
    }

    const dryRun = !!data.dryRun;
    const maxDocs = (Number.isInteger(data.maxDocs) && data.maxDocs > 0) ? data.maxDocs : Infinity;

    let processed = 0;
    let updated = 0;
    let errors = 0;
    let lastDoc = null;
    let finished = false;

    try {
        while (!finished && processed < maxDocs) {
            let q = firestore.collectionGroup('applications').orderBy('__name__').limit(BATCH_LIMIT);
            if (lastDoc) q = q.startAfter(lastDoc);

            const snap = await q.get();
            if (snap.empty) break;

            try {
                const u = await processBatch(snap, dryRun);
                updated += u;
            } catch (err) {
                console.error('processBatch error', err);
                errors++;
            }

            processed += snap.size;
            lastDoc = snap.docs[snap.docs.length - 1];
            if (snap.size < BATCH_LIMIT) finished = true;
        }
    } catch (err) {
        console.error('backfill loop error', err);
        throw new functions.https.HttpsError('internal', 'Backfill failed: ' + (err.message || err));
    }

    return { processed, updated, errors, dryRun };
});

