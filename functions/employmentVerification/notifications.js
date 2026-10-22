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
const { reminderAttachments } = require("./requestAttachment");

// ============================================================
// HELPER: Send reminder email
// ============================================================
async function sendReminderEmail(companyId, recipientEmail, emailParams, reminderType, applicantName, requestPdfPath = null) {
    const subjects = {
        first_reminder: `Reminder: Employment Verification Pending – ${applicantName}`,
        second_reminder: `2nd Reminder: Employment Verification Required – ${applicantName}`,
        final_notice: `FINAL NOTICE: Employment Verification Required – ${applicantName}`,
    };

    const html = buildReminderEmailHTML({ ...emailParams, reminderType });
    // A reminder carries the request's document again; copies go with the first email only.
    const attachments = await reminderAttachments(requestPdfPath, applicantName);
    await sendDynamicEmail(companyId, recipientEmail, subjects[reminderType], html,
        attachments.length > 0 ? { attachments } : {});
}

/**
 * Where the carrier's PEV notices go: the email Edit Company and Settings save
 * (`contact.email`). An older company document may also hold an `adminEmail`,
 * which no screen edits, and a company the older Create screen made a flat
 * `email`; each is used only when the ones before it are blank.
 */
function carrierEmail(companyData) {
    const text = (value) => (typeof value === 'string' ? value.trim() : '');
    return text(companyData.contact?.email) || text(companyData.adminEmail) || text(companyData.email) || null;
}

// ============================================================
// HELPER: Notify carrier that verification is complete
// ============================================================
async function notifyCarrierVerificationComplete(verificationData, formResponse) {
    const companyDoc = await db.collection('companies').doc(verificationData.companyId).get();
    if (!companyDoc.exists) return;

    const adminEmail = carrierEmail(companyDoc.data());
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

    const adminEmail = carrierEmail(companyDoc.data());
    if (!adminEmail) return;

    const html = buildCarrierNoResponseEmailHTML(verificationData);

    await sendDynamicEmail(verificationData.companyId, adminEmail, `⚠️ PEV No Response (30 days): ${verificationData.applicantName} — ${verificationData.employerName}`, html);
}

module.exports = {
    sendReminderEmail,
    notifyCarrierVerificationComplete,
    notifyCarrierNoResponse,
};
