/**
 * An application a recruiter prepared (`companyApplications/prepare.js`) is
 * theirs once the driver submits it: `submitGuestApplication` assigns it to
 * them in the write that files it, unless someone is already assigned, and
 * they are told in the bell, once per application.
 *
 * The preparer is read from the draft on the server, never from what the
 * browser sent, and is assigned or told only while a member of the company's
 * team, checked as the recruiter links check it (`recruiterAssignment.js`).
 * Neither step can cost the driver an application they signed: each logs a
 * failure and moves on.
 */
const { isCompanyPrepared } = require('./companyPreparedDraft');
const { teamMemberName } = require('./recruiterAssignment');
const { createNotification } = require('./createNotification');
const { clipText } = require('./plainText');

/** `{ assignedTo, assignedToName }` for the preparer of `draft` while on the team, else null. */
async function preparerAssignment(db, companyId, draft) {
    const uid = isCompanyPrepared(draft) ? draft.preparedBy?.uid : null;
    if (typeof uid !== 'string' || !uid) return null;
    try {
        const name = await teamMemberName(db, companyId, uid);
        return name === null ? null : { assignedTo: uid, assignedToName: name };
    } catch (err) {
        console.error(`[preparedApplication] Could not check the preparer of a draft in ${companyId}; left unassigned:`, err.message);
        return null;
    }
}

/** Tells the preparer (from `preparerAssignment`) that the driver submitted. */
async function notifyPreparer(db, companyId, { preparer, applicationId, assigned, formData }) {
    if (!preparer) return;
    try {
        const driver = clipText(`${formData?.firstName || ''} ${formData?.lastName || ''}`, 80) || 'The driver';
        await createNotification(db, companyId, {
            type: 'prepared_application_submitted',
            title: 'Prepared application submitted',
            message: `${driver} submitted the application you prepared${assigned ? '; it is assigned to you' : ''}`,
            recipientId: preparer.assignedTo,
            relatedType: 'application',
            relatedId: applicationId,
        }, { id: `prepared_submitted_${applicationId}` });
    } catch (err) {
        console.error(`[preparedApplication] Could not notify about ${applicationId}:`, err.message);
    }
}

module.exports = { notifyPreparer, preparerAssignment };
