/**
 * PEV — scheduled reminders.
 * Every 24h: sends 5/15/20-day reminder emails and, at 30 days, documents the
 * good-faith effort by marking no_response and notifying the carrier.
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { admin, db } = require("../firebaseAdmin");
const { logger } = require("firebase-functions");
const {
    sendReminderEmail,
    notifyCarrierNoResponse,
} = require("./notifications");

// ============================================================
// 5. AUTOMATED REMINDERS (Scheduled — runs every 24 hours)
// ============================================================
exports.processVerificationReminders = onSchedule("every 24 hours", async () => {
    logger.info('[PEV Reminders] Starting reminder processing...');

    try {
        // Query all non-completed verification requests
        const snapshot = await db.collection('verification_requests')
            .where('status', 'in', ['sent', 'opened', 'reminder_sent'])
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

            // Determine base URL
            let baseUrl = 'https://app.safehaul.io';
            try {
                const companyDoc = await db.collection('companies').doc(v.companyId).get();
                if (companyDoc.exists) {
                    baseUrl = companyDoc.data().appUrl || baseUrl;
                }
            } catch (e) { /* use default */ }

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
                    await doc.ref.update({
                        status: 'no_response',
                        markedNoResponseAt: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    // Update application record
                    await updateApplicationVerificationStatus(v, 'No Response (Good Faith Documented)');

                    // Notify carrier
                    await notifyCarrierNoResponse(v);

                    marked30Day++;
                    continue;
                }

                if (daysSinceSent >= 20 && v.reminderCount < 3 && v.employerEmail) {
                    await sendReminderEmail(v.companyId, v.employerEmail, emailParams, 'final_notice', v.applicantName);
                    await doc.ref.update({ reminderCount: 3, lastReminderAt: admin.firestore.FieldValue.serverTimestamp(), status: 'reminder_sent' });
                    remindersProcessed++;
                } else if (daysSinceSent >= 15 && v.reminderCount < 2 && v.employerEmail) {
                    await sendReminderEmail(v.companyId, v.employerEmail, emailParams, 'second_reminder', v.applicantName);
                    await doc.ref.update({ reminderCount: 2, lastReminderAt: admin.firestore.FieldValue.serverTimestamp(), status: 'reminder_sent' });
                    remindersProcessed++;
                } else if (daysSinceSent >= 5 && v.reminderCount < 1 && v.employerEmail) {
                    await sendReminderEmail(v.companyId, v.employerEmail, emailParams, 'first_reminder', v.applicantName);
                    await doc.ref.update({ reminderCount: 1, lastReminderAt: admin.firestore.FieldValue.serverTimestamp(), status: 'reminder_sent' });
                    remindersProcessed++;
                }
            } catch (reminderError) {
                logger.error(`[PEV Reminders] Error processing token ${token}:`, reminderError.message);
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
async function updateApplicationVerificationStatus(verificationData, statusText) {
    try {
        const appRef = db.collection('companies')
            .doc(verificationData.companyId)
            .collection(verificationData.collectionName || 'applications')
            .doc(verificationData.applicationId);

        const appSnap = await appRef.get();
        if (!appSnap.exists) return;

        const appData = appSnap.data();
        const employers = [...(appData.employers || [])];
        const idx = verificationData.employerIndex;

        if (employers[idx]) {
            if (!employers[idx].verification) {
                employers[idx].verification = { history: [] };
            }
            employers[idx].verification.status = statusText;
            employers[idx].verification.history = employers[idx].verification.history || [];
            employers[idx].verification.history.push({
                action: statusText,
                timestamp: new Date().toISOString(),
            });

            await appRef.update({ employers });
        }
    } catch (e) {
        logger.error('[PEV] Failed to update app verification status:', e.message);
    }
}
