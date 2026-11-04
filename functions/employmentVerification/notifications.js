/**
 * Employment Verification — outbound notification senders
 * =======================================================
 * Extracted verbatim from employmentVerification.js.
 * Reminder emails to previous employers, status notifications
 * to the requesting carrier's admin, and the bell for the request's sender.
 */

const { db } = require("../firebaseAdmin");
const { sendDynamicEmail } = require("../emailService");
const {
    buildReminderEmailHTML,
    buildCarrierCompleteEmailHTML,
    buildCarrierNoResponseEmailHTML,
} = require("./emailTemplates");
const { reminderAttachments } = require("./requestAttachment");
const { requestIdOf } = require("./requestLifecycle");
const { createNotification } = require("../shared/createNotification");
const { plainGuestText } = require("../shared/plainText");

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
async function notifyCarrierVerificationComplete(verificationData, formResponse, { filedInDq = false } = {}) {
    const companyDoc = await db.collection('companies').doc(verificationData.companyId).get();
    if (!companyDoc.exists) return;

    const adminEmail = carrierEmail(companyDoc.data());
    if (!adminEmail) return;

    const html = buildCarrierCompleteEmailHTML(verificationData, formResponse, { filedInDq });

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

// ============================================================
// HELPER: Bell notification for whoever sent the request
// ============================================================
const SENDER_NOTICES = {
    completed: {
        type: 'pev_completed',
        title: 'Verification answered',
        message: (employer, applicant) => `${employer} answered the employment verification for ${applicant}`,
    },
    no_response: {
        type: 'pev_no_response',
        title: 'Verification not answered',
        message: (employer, applicant) => `${employer} did not answer the employment verification for ${applicant} within 30 days`,
    },
};

/**
 * Tells the request's sender (`createdBy`) in the bell; a request older than
 * that field tells the team. Created once per event (`pev_<event>_<requestId>`),
 * so a repeated delivery adds nothing. The whole team can read notifications,
 * so it names the employer and the driver only, never an answer.
 *
 * @param {'completed'|'no_response'} event
 */
async function notifyRequestSender(verificationData, token, event) {
    const notice = SENDER_NOTICES[event];
    const employer = plainGuestText(verificationData.employerName, 80) || 'The employer';
    const applicant = plainGuestText(verificationData.applicantName, 80) || 'the applicant';
    const recipientId = typeof verificationData.createdBy === 'string' && verificationData.createdBy
        ? verificationData.createdBy
        : null;
    return createNotification(db, verificationData.companyId, {
        type: notice.type,
        title: notice.title,
        message: notice.message(employer, applicant),
        relatedType: verificationData.collectionName === 'leads' ? 'lead' : 'application',
        relatedId: verificationData.applicationId,
        ...(recipientId ? { recipientId } : {}),
    }, { id: `pev_${event}_${requestIdOf(verificationData, token)}` });
}

module.exports = {
    sendReminderEmail,
    notifyCarrierVerificationComplete,
    notifyCarrierNoResponse,
    notifyRequestSender,
};
