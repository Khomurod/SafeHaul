/**
 * A lead who applies is linked to the application (`onApplicationSubmitted`).
 *
 * The lead is the company's lead with the application's email, compared
 * trimmed and lowercased on both sides and never a placeholder; failing that,
 * the one lead with the application's phone digits, when exactly one has them.
 * Two leads with the email give the one with the lowest id; two with the phone
 * give none. Only a link is written, never a merge:
 *
 * - the lead gets `{ applicationId, appliedAt }` (its status stays), and a
 *   `system` line in its activity log;
 * - the application gets `fromLeadId`, and, while nobody has it, the lead's
 *   recruiter as its assignee when they are on the team
 *   (`recruiterAssignment.js`);
 * - that recruiter is told in the bell, once per application.
 *
 * The lead's email is found by `emailNormalized` (written by every lead
 * creator since; older leads get it from Data cleanup → Old lead fields) and by
 * `email` itself, which finds an older lead typed in lower case. Each candidate
 * is checked against its current email, so a copy left stale by an edit links
 * nothing. A delivery that finds the application already linked changes
 * nothing. Deleting either record (`deleteApplication`) removes the other's
 * half of the link, so a lead whose application is gone is not left out of
 * campaigns.
 */
const { SERVER_NOTIFIED_ACTOR } = require('./notificationAudience');
const { admin, db } = require('../firebaseAdmin');
const { isPlaceholderEmail } = require('./placeholderDomains');
const { normalizeSearchEmail, normalizeSearchPhone } = require('./searchNormalization');
const { teamMemberName } = require('./recruiterAssignment');
const { createNotification } = require('./createNotification');
const { clipText } = require('./plainText');

/** Leads read per email lookup: duplicates of one address, not a list. */
const EMAIL_LOOKUP_LIMIT = 10;
/** Fewer digits than a full number are not a phone to match on. */
const MIN_PHONE_DIGITS = 10;

/** The email both records are compared by: '' for none or a placeholder. */
function canonicalEmail(value) {
    return isPlaceholderEmail(value) ? '' : normalizeSearchEmail(value);
}

function comparablePhone(value) {
    const digits = normalizeSearchPhone(value);
    return digits.length >= MIN_PHONE_DIGITS ? digits : '';
}

/** Whether a lead, as it reads now, is still the one `match` found. */
function stillMatches(lead, match) {
    return match.by === 'email'
        ? canonicalEmail(lead.email) === match.value
        : lead.normalizedPhone === match.value;
}

/** `{ doc, by, value }` for the application's lead in `leads`, or null. */
async function findApplicantLead(leads, application) {
    const email = canonicalEmail(application.emailNormalized || application.email);
    if (email) {
        const found = await Promise.all([
            leads.where('emailNormalized', '==', email).limit(EMAIL_LOOKUP_LIMIT).get(),
            leads.where('email', '==', email).limit(EMAIL_LOOKUP_LIMIT).get(),
        ]);
        const match = found.flatMap((snap) => snap.docs)
            .filter((leadDoc) => canonicalEmail(leadDoc.data()?.email) === email)
            .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
        if (match) return { doc: match, by: 'email', value: email };
    }
    const phone = comparablePhone(application.phoneNormalized || application.phone);
    if (phone) {
        const snap = await leads.where('normalizedPhone', '==', phone).limit(2).get();
        if (snap.size === 1) return { doc: snap.docs[0], by: 'phone', value: phone };
    }
    return null;
}

/** The lead's recruiter's name while on the team, else null; a failed check is null too. */
async function recruiterOnTeam(companyId, owner) {
    if (typeof owner !== 'string' || !owner) return null;
    try {
        return await teamMemberName(db, companyId, owner);
    } catch (err) {
        console.error(`[leadApplicationLink] Could not check the lead's recruiter in ${companyId}; nobody is assigned:`, err.message);
        return null;
    }
}

async function notifyRecruiter({ companyId, applicationId, recruiterId, assigned, application }) {
    try {
        const driver = clipText(`${application.firstName || ''} ${application.lastName || ''}`, 80) || 'Your lead';
        await createNotification(db, companyId, {
            type: 'lead_applied',
            title: 'Your lead applied',
            message: `${driver} submitted an application${assigned ? '; it is assigned to you' : ''}`,
            recipientId: recruiterId,
            relatedType: 'application',
            relatedId: applicationId,
        }, { id: `lead_applied_${applicationId}` });
    } catch (err) {
        console.error(`[leadApplicationLink] Could not tell the recruiter about ${applicationId}:`, err.message);
    }
}

/**
 * Links the application to its driver's lead, if the company has one.
 *
 * @param {{ companyId: string, applicationId: string, application: object }} args
 *   `application` is the submitted document.
 * @returns {Promise<{ leadId: string, by: 'email'|'phone', assigned: boolean, recruiterId: string|null }|null>}
 *   null when no lead matched or the application was already linked.
 */
async function linkApplicantLead({ companyId, applicationId, application }) {
    const company = db.collection('companies').doc(companyId);
    const appRef = company.collection('applications').doc(applicationId);
    const match = await findApplicantLead(company.collection('leads'), application || {});
    if (!match) return null;

    const leadRef = match.doc.ref;
    const owner = match.doc.data()?.assignedTo;
    const ownerName = await recruiterOnTeam(companyId, owner);
    const logRef = leadRef.collection('activity_logs').doc(`applied_${applicationId}`);

    const linked = await db.runTransaction(async (transaction) => {
        const [appSnap, leadSnap] = await Promise.all([transaction.get(appRef), transaction.get(leadRef)]);
        if (!appSnap.exists || !leadSnap.exists) return null;
        const app = appSnap.data() || {};
        const lead = leadSnap.data() || {};
        if (app.fromLeadId || !stillMatches(lead, match)) return null;

        const recruiterId = ownerName !== null && lead.assignedTo === owner ? owner : null;
        const assigned = Boolean(recruiterId) && !app.assignedTo;
        // Already theirs (a recruiter link on submission): the assignment notice told them.
        const alreadyTheirs = Boolean(recruiterId) && app.assignedTo === recruiterId;
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(leadRef, { applicationId, appliedAt: now });
        transaction.update(appRef, {
            fromLeadId: leadRef.id,
            // The recruiter is told below, as "your lead applied": the
            // assignment notice is not sent too (`notificationAudience.js`).
            ...(assigned && {
                assignedTo: recruiterId,
                assignedToName: ownerName,
                assignmentChangedBy: SERVER_NOTIFIED_ACTOR,
                assignmentChangedAt: now,
            }),
        });
        transaction.set(logRef, {
            action: 'Applied',
            details: `Submitted an application, found by the same ${match.by}.`,
            type: 'system',
            companyId,
            applicationId,
            timestamp: now,
        });
        return { assigned, recruiterId, alreadyTheirs };
    });
    if (!linked) return null;

    const { assigned, recruiterId, alreadyTheirs } = linked;
    if (recruiterId && !alreadyTheirs) {
        await notifyRecruiter({ companyId, applicationId, recruiterId, assigned, application });
    }
    return { leadId: leadRef.id, by: match.by, assigned, recruiterId };
}

/**
 * Removes the other record's half of the link after one is deleted: the lead's
 * `applicationId` and `appliedAt`, or the application's `fromLeadId`, while
 * they still name the deleted record. A lead that applied more than once points
 * back at an earlier application that still names it, instead.
 *
 * @param {{ companyId: string, collectionName: 'applications'|'leads', recordId: string, data: object }} args
 *   `data` is the deleted record as it was.
 */
async function unlinkDeletedRecord({ companyId, collectionName, recordId, data }) {
    // An application carries its own id as `applicationId`; only a lead's names a link.
    const otherId = collectionName === 'applications' ? data?.fromLeadId : data?.applicationId;
    if (typeof otherId !== 'string' || !otherId || (collectionName !== 'applications' && collectionName !== 'leads')) return;
    const toLead = collectionName === 'applications';
    const company = db.collection('companies').doc(companyId);
    const otherRef = company.collection(toLead ? 'leads' : 'applications').doc(otherId);
    const remove = admin.firestore.FieldValue.delete();
    // A driver who applied twice: the lead points at the newest application. When
    // that one goes, it points back at another that still names the lead.
    const earlier = toLead
        ? (await company.collection('applications').where('fromLeadId', '==', otherId).limit(5).get())
            .docs.map((d) => d.id).find((id) => id !== recordId) || null
        : null;
    await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(otherRef);
        const other = snap.exists ? snap.data() || {} : null;
        if (!other || (toLead ? other.applicationId : other.fromLeadId) !== recordId) return;
        if (!toLead) {
            transaction.update(otherRef, { fromLeadId: remove });
        } else if (earlier) {
            transaction.update(otherRef, { applicationId: earlier });
        } else {
            transaction.update(otherRef, { applicationId: remove, appliedAt: remove });
        }
    });
}

module.exports = { linkApplicantLead, unlinkDeletedRecord };
