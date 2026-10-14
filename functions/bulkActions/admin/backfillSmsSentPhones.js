const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("../../firebaseAdmin");
const { assertCompanyAdminStrict } = require("../../shared/companyAccess");
const { normalizePhone } = require("../../utils/phoneUtils");
const { isCanonicalPhoneLedgerKey } = require("../helpers/phoneLedger");

/** Ledger documents read and written per transaction, under its 500-write limit. */
const LEDGER_CHUNK = 400;

/** Milliseconds of a stored time (a Firestore Timestamp, a Date or a number), or null. */
function timeOf(value) {
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return Number.isFinite(value) ? value : null;
}

/**
 * Internal: backfill SMS phones for a single company. Does NOT perform auth
 * checks — callers are responsible. Returns counts.
 *
 * Each number gets its newest delivery: sessions and their logs come back in
 * id order, not in time order. A delivery with no time is skipped, since it
 * cannot say how recent it was. And the ledger is written only where it holds
 * nothing newer, in a transaction, because the live sender stamps a number as
 * it texts it, and that stamp must never go back to an older delivery.
 */
async function _backfillSmsForCompany(companyId) {
    const company = db.collection('companies').doc(companyId);
    const sessionsSnap = await company.collection('bulk_sessions').get();
    const newest = new Map();

    for (const sessionDoc of sessionsSnap.docs) {
        const sessionId = sessionDoc.id;
        const sessionData = sessionDoc.data();
        const method = sessionData.config?.method || sessionData.messageType || null;
        if (method && method === 'email') continue;

        const logsSnap = await company
            .collection('bulk_sessions').doc(sessionId)
            .collection('logs')
            .where('status', '==', 'delivered')
            .get();
        if (logsSnap.empty) continue;

        for (const logDoc of logsSnap.docs) {
            const logData = logDoc.data();
            const rawPhone = logData.recipientIdentity;
            if (!rawPhone || rawPhone === 'N/A' || rawPhone === 'No Phone' || rawPhone === 'No Email') continue;
            const normPhone = normalizePhone(rawPhone);
            if (!isCanonicalPhoneLedgerKey(normPhone)) continue;
            const sentMs = timeOf(logData.timestamp);
            if (sentMs === null) continue;
            const known = newest.get(normPhone);
            if (!known || sentMs > known.sentMs) newest.set(normPhone, { sentAt: logData.timestamp, sentMs, sessionId });
        }
    }

    const ledger = company.collection('sms_sent_phones');
    const phones = [...newest.keys()];
    const sessions = new Set();
    let phonesBackfilled = 0;
    for (let i = 0; i < phones.length; i += LEDGER_CHUNK) {
        const chunk = phones.slice(i, i + LEDGER_CHUNK);
        const refs = chunk.map((phone) => ledger.doc(phone));
        const written = await db.runTransaction(async (transaction) => {
            const snaps = await transaction.getAll(...refs);
            const ids = [];
            snaps.forEach((snap, index) => {
                const entry = newest.get(chunk[index]);
                const storedMs = snap.exists ? timeOf(snap.data()?.lastSentAt) : null;
                if (storedMs !== null && storedMs >= entry.sentMs) return;
                transaction.set(refs[index], { lastSentAt: entry.sentAt, sessionId: entry.sessionId, backfilled: true }, { merge: true });
                ids.push(entry.sessionId);
            });
            return ids;
        });
        written.forEach((sessionId) => sessions.add(sessionId));
        phonesBackfilled += written.length;
    }

    return { sessionsProcessed: sessions.size, phonesBackfilled };
}

/**
 * One-Time Backfill: Populate `sms_sent_phones` from historical bulk_session logs.
 *
 * This function reads all completed bulk sessions and their delivery logs,
 * extracts the phone numbers, and writes them to the `sms_sent_phones` ledger.
 *
 * Run once from the Firebase Console or via a client call after deploying.
 * Safe to re-run: it never overwrites a newer ledger entry.
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

        // In id order, from the company after the one a cut-short run named, so
        // re-running reaches the companies the last run did not.
        const { startAfterCompanyId } = request.data || {};
        const companies = db.collection('companies').orderBy('__name__');
        const companiesSnap = await (typeof startAfterCompanyId === 'string' && startAfterCompanyId
            ? companies.startAfter(startAfterCompanyId)
            : companies).get();
        const summaries = [];
        let totalPhones = 0;
        let totalSessions = 0;
        let processedCompanies = 0;
        let failedCompanies = 0;
        let truncated = false;
        // Where a re-run continues: after the last company done before the first
        // failure, so a company that failed is tried again rather than skipped.
        let resumeAfter = typeof startAfterCompanyId === 'string' && startAfterCompanyId ? startAfterCompanyId : null;

        for (const doc of companiesSnap.docs) {
            if (Date.now() - startedAt > TIMEOUT_BUDGET_MS) {
                truncated = true;
                console.warn(`[Backfill-All] Time budget exceeded; deferring remaining ${companiesSnap.size - summaries.length} companies.`);
                break;
            }
            const companyId = doc.id;
            try {
                const result = await _backfillSmsForCompany(companyId);
                if (failedCompanies === 0) resumeAfter = companyId;
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
            nextCompanyId: truncated ? resumeAfter : null,
            message: truncated
                ? `Partial backfill: processed ${processedCompanies}/${companiesSnap.size} companies before timeout. Re-run ${resumeAfter ? `with startAfterCompanyId "${resumeAfter}" ` : ''}to finish.`
                : `Backfill complete across ${processedCompanies} companies. ${totalPhones} phones from ${totalSessions} sessions.`,
        };
    }
);

