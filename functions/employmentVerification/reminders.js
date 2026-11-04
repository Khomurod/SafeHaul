/**
 * PEV — scheduled reminders.
 * Every 24h: sends 5/15/20-day reminder emails and, at 30 days, documents the
 * good-faith effort by marking no_response and notifying the carrier.
 *
 * Only live requests take part (./requestLifecycle.js): one whose first email
 * failed, that a newer request replaced, or whose result is in is never
 * reminded or marked. Each status write moves only a request that is still
 * live, so an answer that lands while a reminder is being sent stays completed.
 *
 * Every reminder, sent or not, and the mark go into the request's attempt log
 * (./attemptLog.js); a reminder also onto the employer row. A reminder that did
 * not go out leaves the count where it was, so the next run tries again. The
 * mark also prints the log as a PDF filed in the DQ file (./attemptRecord.js).
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { admin, db } = require("../firebaseAdmin");
const { logger } = require("firebase-functions");
const {
    sendReminderEmail,
    notifyCarrierNoResponse,
    notifyRequestSender,
} = require("./notifications");
const { LIVE_STATUSES, requestIdOf, updateWhileStatus } = require("./requestLifecycle");
const { mirrorOntoEmployer, recordRefOf } = require("./employerMirror");
const { attemptEntry, mirrorAttempt, recordAttempt, withAttempt } = require("./attemptLog");
const { fileAttemptRecord } = require("./attemptRecord");

/** The row status day 30 writes. The wording awaits the owner's compliance review; unchanged here. */
const NO_RESPONSE_STATUS = 'No Response (Good Faith Documented)';

/**
 * Emails one reminder and records it, whether it went out or not.
 *
 * @returns {Promise<boolean>} whether it went out
 */
async function sendReminder(ref, v, reminder, emailParams) {
    try {
        await sendReminderEmail(v.companyId, v.employerEmail, emailParams, reminder.type, v.applicantName, v.requestPdfPath);
    } catch (error) {
        logger.error(`[PEV Reminders] A ${reminder.type} did not go out; the next run tries again.`, error?.message);
        const failed = attemptEntry('reminder', { ok: false, step: reminder.count, error });
        await recordAttempt(ref, failed);
        await mirrorAttempt(v, failed);
        return false;
    }
    const sent = attemptEntry('reminder', { step: reminder.count });
    const moved = await updateWhileStatus(ref, LIVE_STATUSES, withAttempt({
        reminderCount: reminder.count,
        lastReminderAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'reminder_sent',
    }, sent));
    // Answered while the email went out: the request stays as it is, the email is still on the record.
    if (!moved) await recordAttempt(ref, sent);
    await mirrorAttempt(v, sent);
    return true;
}

// ============================================================
// 5. AUTOMATED REMINDERS (Scheduled — runs every 24 hours)
// ============================================================
// The secret decrypts an SMTP password stored encrypted (emailService.js).
exports.processVerificationReminders = onSchedule({ schedule: 'every 24 hours', secrets: ['SMS_ENCRYPTION_KEY'] }, async () => {
    logger.info('[PEV Reminders] Starting reminder processing...');

    try {
        // Query all non-completed verification requests
        const snapshot = await db.collection('verification_requests')
            .where('status', 'in', LIVE_STATUSES)
            .get();

        if (snapshot.empty) {
            logger.info('[PEV Reminders] No pending verifications found.');
            return;
        }

        let remindersProcessed = 0;
        let marked30Day = 0;

        for (const doc of snapshot.docs) {
            const v = doc.data();
            const daysSinceSent = Math.floor((Date.now() - v.createdAt.toMillis()) / (1000 * 60 * 60 * 24));
            const token = doc.id;

            // The company: its app URL for the links, its team for the record of attempts.
            let company = {};
            try {
                const companyDoc = await db.collection('companies').doc(v.companyId).get();
                if (companyDoc.exists) company = companyDoc.data() || {};
            } catch (e) { /* use default */ }
            const baseUrl = company.appUrl || 'https://app.safehaul.io';

            const deadlineDate = v.expiresAt ? new Date(v.expiresAt.toMillis()).toISOString().split('T')[0] : 'N/A';
            const emailParams = {
                applicantName: v.applicantName,
                employerName: v.employerName,
                companyName: v.companyName,
                employmentDates: `${v.employmentStartDate} to ${v.employmentEndDate}`,
                token,
                baseUrl,
                deadlineDate,
            };

            try {
                if (daysSinceSent >= 30) {
                    // Mark as no_response — document good-faith effort
                    const marked = await updateWhileStatus(doc.ref, LIVE_STATUSES, withAttempt({
                        status: 'no_response',
                        markedNoResponseAt: admin.firestore.FieldValue.serverTimestamp(),
                    }, attemptEntry('no_response')));
                    if (!marked) continue;

                    // Update application record; a result already on the row stays.
                    const mirrored = await updateApplicationVerificationStatus(v, NO_RESPONSE_STATUS, token);

                    // Notify the sender in the bell, file the record of attempts, then
                    // tell the carrier by email, unless the row holds the result. The
                    // bell and the record first: neither needs email set up.
                    if (mirrored !== 'kept_completed') {
                        await notifyRequestSender(v, token, 'no_response')
                            .catch((error) => logger.error(`[PEV Reminders] The sender was not notified for request ${requestIdOf(v, token)}:`, error));
                        await fileAttemptRecord(doc.ref, token, company, NO_RESPONSE_STATUS);
                        await notifyCarrierNoResponse(v);
                    }

                    marked30Day++;
                    continue;
                }

                const reminder = daysSinceSent >= 20 && v.reminderCount < 3 ? { type: 'final_notice', count: 3 }
                    : daysSinceSent >= 15 && v.reminderCount < 2 ? { type: 'second_reminder', count: 2 }
                        : daysSinceSent >= 5 && v.reminderCount < 1 ? { type: 'first_reminder', count: 1 }
                            : null;
                if (reminder && v.employerEmail && await sendReminder(doc.ref, v, reminder, emailParams)) {
                    remindersProcessed++;
                }
            } catch (reminderError) {
                logger.error(`[PEV Reminders] Error processing request ${requestIdOf(v, token)}:`, reminderError.message);
            }
        }

        logger.info(`[PEV Reminders] Complete. Reminders sent: ${remindersProcessed}, Marked no-response: ${marked30Day}`);

    } catch (error) {
        logger.error('[PEV Reminders] Fatal error:', error);
    }
});


// ============================================================
// HELPER: Update application verification status
// ============================================================
/**
 * Mirrors a status onto the request's employer row, by identity — see
 * `shared/employerIdentity.js`. A row that already reads "Completed" keeps it:
 * its result came in another way (an upload, or a request this one predates).
 *
 * @returns {Promise<'mirrored'|'kept_completed'|'not_found'|'failed'>}
 */
async function updateApplicationVerificationStatus(verificationData, statusText, token) {
    try {
        const mirrored = await mirrorOntoEmployer(recordRefOf(verificationData), verificationData, (verification) => {
            if (verification.status === 'Completed') return false;
            verification.status = statusText;
            verification.history.push({
                action: statusText,
                timestamp: new Date().toISOString(),
            });
        });
        if (!mirrored) {
            // The request document still records the mark itself, which is what
            // the cycle actually runs on.
            logger.warn(
                `[PEV] Reminder for request ${requestIdOf(verificationData, token)} could not be matched `
                + 'to an employer; the status was not mirrored onto the application.',
            );
            return 'not_found';
        }
        return mirrored.written ? 'mirrored' : 'kept_completed';
    } catch (e) {
        logger.error('[PEV] Failed to update app verification status:', e.message);
        return 'failed';
    }
}
