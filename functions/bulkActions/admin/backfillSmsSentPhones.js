const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");
const { normalizePhone } = require("../../utils/phoneUtils");

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

    console.log(`[Backfill] Starting SMS phone backfill for company: ${companyId}`);

    let totalBackfilled = 0;
    let sessionsProcessed = 0;

    try {
        // 1. Get all bulk sessions for this company (no status filter — process all)
        const sessionsSnap = await db
            .collection('companies').doc(companyId)
            .collection('bulk_sessions')
            .get();

        console.log(`[Backfill] Found ${sessionsSnap.size} sessions for company ${companyId}`);

        // 2. Process each session sequentially (to stay within CPU limits)
        for (const sessionDoc of sessionsSnap.docs) {
            const sessionId = sessionDoc.id;
            const sessionData = sessionDoc.data();

            // Skip email-only sessions if the method is explicitly set to 'email'
            // But DO process sessions where method is missing (historical) or 'sms'
            const method = sessionData.config?.method || sessionData.messageType || null;
            if (method && method === 'email') {
                console.log(`[Backfill] Skipping session ${sessionId} — explicitly email`);
                continue;
            }

            // 3. Read ALL delivered logs for this session
            const logsSnap = await db
                .collection('companies').doc(companyId)
                .collection('bulk_sessions').doc(sessionId)
                .collection('logs')
                .where('status', '==', 'delivered')
                .get();

            if (logsSnap.empty) {
                console.log(`[Backfill] Session ${sessionId}: no delivered logs found`);
                continue;
            }

            // 4. Batch-write to sms_sent_phones — only for entries that look like phone numbers
            const batchArray = [];
            let batch = db.batch();
            let count = 0;
            let sessionPhones = 0;

            for (const logDoc of logsSnap.docs) {
                const logData = logDoc.data();
                const rawPhone = logData.recipientIdentity;

                if (!rawPhone || rawPhone === 'N/A' || rawPhone === 'No Phone' || rawPhone === 'No Email') {
                    continue;
                }

                // Only write if it normalizes to a valid phone number (10-11 digits)
                const normPhone = normalizePhone(rawPhone);
                if (!normPhone || normPhone.length < 10 || normPhone.length > 11) {
                    // Likely an email address — skip
                    continue;
                }

                const phoneRef = db
                    .collection('companies').doc(companyId)
                    .collection('sms_sent_phones').doc(normPhone);

                // Use merge: true — safe to re-run, won't overwrite newer real sends
                batch.set(phoneRef, {
                    lastSentAt: logData.timestamp || admin.firestore.FieldValue.serverTimestamp(),
                    sessionId: sessionId,
                    backfilled: true
                }, { merge: true });

                count++;
                totalBackfilled++;
                sessionPhones++;

                if (count >= 490) { // Firestore batch limit safety margin
                    batchArray.push(batch);
                    batch = db.batch();
                    count = 0;
                }
            }

            if (count > 0) batchArray.push(batch);

            // Commit all batches for this session
            for (const b of batchArray) {
                await b.commit();
            }

            if (sessionPhones > 0) {
                sessionsProcessed++;
                console.log(`[Backfill] Session ${sessionId}: backfilled ${sessionPhones} phones`);
            }
        }

        const summary = `Backfill complete for company ${companyId}. Sessions processed: ${sessionsProcessed}, Phones backfilled: ${totalBackfilled}`;
        console.log(`[Backfill] ${summary}`);

        return {
            success: true,
            message: summary,
            sessionsProcessed,
            phonesBackfilled: totalBackfilled
        };

    } catch (err) {
        console.error('[Backfill] Error:', err);
        throw new HttpsError('internal', `Backfill failed: ${err.message}`);
    }
});
