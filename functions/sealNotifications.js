/**
 * The bell's word that a signing request was sealed (`'signed'`) or could not
 * be (`'error_sealing'`), for whoever waits on it: the team member who sent it
 * (`senderId`); for a post-application document, which nobody sent (or the
 * system did: a `system:` sender, the automatic send after submission), the
 * recruiter its application is assigned to, else the whole team.
 *
 * One notification per request and outcome (`seal_<id>`, `seal_failed_<id>`),
 * however often the trigger delivers the event; a later successful seal of a
 * failed request still says "signed". It holds the document's title and the
 * signer's name only, since the whole team may read every notification. A
 * document linked to an application (`sourceApplicationId`: a post-application
 * document, or a template sent to a picked applicant) opens that application in
 * the bell; any other names its request, which the bell opens in E-Docs.
 *
 * Never throws: a notification that cannot be written is logged, and the seal
 * stays exactly as it was.
 */
const { createNotification } = require('./shared/createNotification');
const { clipText } = require('./shared/plainText');

const idOf = (value) => (typeof value === 'string' && value ? value : null);

/** A sender that is a person: not the system (`system:…`), which nobody reads as. */
const personOf = (value) => (idOf(value) && !value.startsWith('system:') ? value : null);

/** Who is told: the sender, else the assignee of the document's application, else nobody in particular (the team). */
async function recipientFor(db, companyId, request, applicationId) {
    const senderId = personOf(request.senderId);
    if (senderId || !applicationId) return senderId;
    try {
        const application = await db.collection('companies').doc(companyId)
            .collection('applications').doc(applicationId).get();
        return idOf(application.exists ? (application.data() || {}).assignedTo : null);
    } catch (err) {
        console.error(`[Seal] Could not read application ${applicationId} for its assignee; telling the team:`, err.message);
        return null;
    }
}

async function notifySealOutcome(db, companyId, requestId, request, outcome) {
    try {
        const signed = outcome === 'signed';
        const applicationId = idOf(request.sourceApplicationId);
        const title = clipText(request.title, 80) || 'A document';
        const signer = clipText(request.recipientName, 80) || 'The signer';
        const recipientId = await recipientFor(db, companyId, request, applicationId);
        await createNotification(db, companyId, {
            type: signed ? 'document_signed' : 'document_seal_failed',
            title: signed ? 'Document signed' : 'Seal failed',
            message: signed ? `${signer} signed ${title}` : `${title}, signed by ${signer}, could not be sealed`,
            ...(recipientId && { recipientId }),
            relatedType: applicationId ? 'application' : 'signing_request',
            relatedId: applicationId || requestId,
        }, { id: `${signed ? 'seal' : 'seal_failed'}_${requestId}` });
    } catch (err) {
        console.error(`[Seal] Could not notify about ${requestId} (${outcome}):`, err.message);
    }
}

module.exports = { notifySealOutcome };
