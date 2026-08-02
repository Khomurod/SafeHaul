const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");
const { assertCompanyAdminStrict } = require("../../shared/companyAccess");
const { normalizePhone } = require("../../utils/phoneUtils");
const { isCanonicalPhoneLedgerKey } = require("../helpers/phoneLedger");

/**
 * Internal: backfill SMS phones for a single company. Does NOT perform auth
 * checks — callers are responsible. Returns counts.
 */
async function _backfillSmsForCompany(companyId) {
    let totalBackfilled = 0;
    let sessionsProcessed = 0;

    const sessionsSnap = await db
        .collection('companies').doc(companyId)
        .collection('bulk_sessions')
        .get();

    for (const sessionDoc of sessionsSnap.docs) {
        const sessionId = sessionDoc.id;
        const sessionData = sessionDoc.data();
        const method = sessionData.config?.method || sessionData.messageType || null;
        if (method && method === 'email') continue;

        const logsSnap = await db
            .collection('companies').doc(companyId)
            .collection('bulk_sessions').doc(sessionId)
            .collection('logs')
            .where('status', '==', 'delivered')
            .get();
        if (logsSnap.empty) continue;

        const batchArray = [];
        let batch = db.batch();
        let count = 0;
        let sessionPhones = 0;

        for (const logDoc of logsSnap.docs) {
            const logData = logDoc.data();
            const rawPhone = logData.recipientIdentity;
            if (!rawPhone || rawPhone === 'N/A' || rawPhone === 'No Phone' || rawPhone === 'No Email') continue;
            const normPhone = normalizePhone(rawPhone);
            if (!isCanonicalPhoneLedgerKey(normPhone)) continue;

            const phoneRef = db
                .collection('companies').doc(companyId)
                .collection('sms_sent_phones').doc(normPhone);
            batch.set(phoneRef, {
                lastSentAt: logData.timestamp || admin.firestore.FieldValue.serverTimestamp(),
                sessionId,
                backfilled: true,
            }, { merge: true });

            count++; totalBackfilled++; sessionPhones++;
            if (count >= 490) { batchArray.push(batch); batch = db.batch(); count = 0; }
        }
        if (count > 0) batchArray.push(batch);
        for (const b of batchArray) await b.commit();
        if (sessionPhones > 0) sessionsProcessed++;
    }

    return { sessionsProcessed, phonesBackfilled: totalBackfilled };
}

/**
 * One-Time Backfill: Populate `sms_sent_phones` from historical bulk_session logs.
 *
 * This function reads all completed bulk sessions and their delivery logs,
 * extracts the phone numbers, and writes them to the `sms_sent_phones` ledger.
 *
 * Run once from the Firebase Console or via a client call after deploying.
 * Safe to re-run — uses merge: true so it never overwrites newer data.
 *
 * FIX (v2): Removed the config.method === 'sms' filter — historical sessions
 * may not have this field set. Instead, we detect phone numbers from the
 * recipientIdentity field by checking if it normalizes to a valid phone number.
 */
exports.backfillSmsSentPhones = onCall({ cors: true, timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');

    const { companyId } = request.data;
    if (!companyId) {
        throw new HttpsError('invalid-argument', 'companyId is required.');
    }
    await assertCompanyAdminStrict(request.auth.uid, companyId);

    console.log(`[Backfill] Starting SMS phone backfill for company: ${companyId}`);

    try {
        const { sessionsProcessed, phonesBackfilled } = await _backfillSmsForCompany(companyId);
        const summary = `Backfill complete for company ${companyId}. Sessions processed: ${sessionsProcessed}, Phones backfilled: ${phonesBackfilled}`;
        console.log(`[Backfill] ${summary}`);
        return { success: true, message: summary, sessionsProcessed, phonesBackfilled };
    } catch (err) {
        console.error('[Backfill] Error:', err);
        throw new HttpsError('internal', `Backfill failed: ${err.message}`);
    }
});

/**
 * BUG-14 FIX: Server-side "fan-out" version of the SMS backfill. Super Admin only.
 *
 * The old workflow asked the browser to loop through every company and fire a
 * callable per company. If the tab was closed (or even backgrounded long enough
 * for the JS event loop to be throttled) the loop would silently stall, leaving
 * the system half-backfilled. This callable does the whole sweep server-side so
 * the operator can fire-and-forget. Returns aggregated counts.
 */
exports.backfillAllSmsSentPhones = onCall(
    { cors: true, timeoutSeconds: 540, memory: '1GiB' },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');

        const roles = request.auth.token?.roles || {};
        if (roles.globalRole !== 'super_admin') {
            throw new HttpsError('permission-denied', 'Super Admin only.');
        }

        const startedAt = Date.now();
        const TIMEOUT_BUDGET_MS = 8 * 60 * 1000; // stop early before Cloud Functions 540s hard kill

        console.log('[Backfill-All] Starting global SMS phone backfill.');

        const companiesSnap = await db.collection('companies').get();
        const summaries = [];
        let totalPhones = 0;
        let totalSessions = 0;
        let processedCompanies = 0;
        let failedCompanies = 0;
        let truncated = false;

        for (const doc of companiesSnap.docs) {
            if (Date.now() - startedAt > TIMEOUT_BUDGET_MS) {
                truncated = true;
                console.warn(`[Backfill-All] Time budget exceeded; deferring remaining ${companiesSnap.size - processedCompanies} companies.`);
                break;
            }
            const companyId = doc.id;
            try {
                const result = await _backfillSmsForCompany(companyId);
                processedCompanies++;
                totalPhones += result.phonesBackfilled;
                totalSessions += result.sessionsProcessed;
                summaries.push({ companyId, ok: true, ...result });
                console.log(`[Backfill-All] ${companyId}: ${result.phonesBackfilled} phones, ${result.sessionsProcessed} sessions.`);
            } catch (err) {
                failedCompanies++;
                summaries.push({ companyId, ok: false, error: err.message });
                console.error(`[Backfill-All] FAILED for ${companyId}:`, err);
            }
        }

        return {
            success: true,
            truncated,
            totalCompanies: companiesSnap.size,
            processedCompanies,
            failedCompanies,
            sessionsProcessed: totalSessions,
            phonesBackfilled: totalPhones,
            summaries,
            message: truncated
                ? `Partial backfill: processed ${processedCompanies}/${companiesSnap.size} companies before timeout. Re-run to finish.`
                : `Backfill complete across ${processedCompanies} companies. ${totalPhones} phones from ${totalSessions} sessions.`,
        };
    }
);

