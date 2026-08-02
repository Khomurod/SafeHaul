/**
 * Employment Verification — outbound notification senders
 * =======================================================
 * Extracted verbatim from employmentVerification.js.
 * Reminder emails to previous employers and status notifications
 * to the requesting carrier's admin.
 */

const { db } = require("../firebaseAdmin");
const { sendDynamicEmail } = require("../emailService");
const {
    buildReminderEmailHTML,
    buildCarrierCompleteEmailHTML,
    buildCarrierNoResponseEmailHTML,
} = require("./emailTemplates");

// ============================================================
// HELPER: Send reminder email
// ============================================================
async function sendReminderEmail(companyId, recipientEmail, emailParams, reminderType, applicantName) {
    const subjects = {
        first_reminder: `Reminder: Employment Verification Pending – ${applicantName}`,
        second_reminder: `2nd Reminder: Employment Verification Required – ${applicantName}`,
        final_notice: `FINAL NOTICE: Employment Verification Required – ${applicantName}`,
    };

    const html = buildReminderEmailHTML({ ...emailParams, reminderType });
    await sendDynamicEmail(companyId, recipientEmail, subjects[reminderType], html);
}

// ============================================================
// HELPER: Notify carrier that verification is complete
// ============================================================
async function notifyCarrierVerificationComplete(verificationData, formResponse) {
    const companyDoc = await db.collection('companies').doc(verificationData.companyId).get();
    if (!companyDoc.exists) return;

    const companyData = companyDoc.data();
    const adminEmail = companyData.adminEmail || companyData.email;
    if (!adminEmail) return;

    const html = buildCarrierCompleteEmailHTML(verificationData, formResponse);

    await sendDynamicEmail(verificationData.companyId, adminEmail, `✅ PEV Complete: ${verificationData.applicantName} — ${verificationData.employerName}`, html);
}

// ============================================================
// HELPER: Notify carrier of no-response (good faith documentation)
// ============================================================
async function notifyCarrierNoResponse(verificationData) {
    const companyDoc = await db.collection('companies').doc(verificationData.companyId).get();
    if (!companyDoc.exists) return;

    const companyData = companyDoc.data();
    const adminEmail = companyData.adminEmail || companyData.email;
    if (!adminEmail) return;

    const html = buildCarrierNoResponseEmailHTML(verificationData);

    await sendDynamicEmail(verificationData.companyId, adminEmail, `⚠️ PEV No Response (30 days): ${verificationData.applicantName} — ${verificationData.employerName}`, html);
}

module.exports = {
    sendReminderEmail,
    notifyCarrierVerificationComplete,
    notifyCarrierNoResponse,
};
