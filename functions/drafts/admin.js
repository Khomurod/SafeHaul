/**
 * What a Company Admin may do with any unfinished application: read it, and
 * delete it.
 *
 * Part of the guest application-draft surface; `applicationDrafts.js` is the
 * deployment surface that re-exports the handlers by name.
 *
 * ## Why an admin may read a driver's unfinished answers
 *
 * Nobody at the carrier could, before 2026-10-06. `getCompanyPreparedDraft`
 * answers only for the carrier's own prepared work, and only until the driver
 * writes (`companyMayReadAnswers`). The owner decided that a Company Admin sees
 * every unfinished application: the driver typed those answers into this
 * carrier's own form, to apply to this carrier, and a recruiter following up
 * should start from what is there. Recruiters and HR users keep the old rule.
 * Only the strict admin check `deleteApplication` uses opens these two doors.
 *
 * A draft never holds a Social Security Number or a signature
 * (`shared/applicationDraft.js`), so neither can reach anybody through here, and
 * nothing here changes what the driver's link or the prep workspace hand over.
 * Every view and every deletion is audited in `application_draft_audit`, by who
 * and which draft, never by what it says.
 *
 * ## Why deleting removes the document and nothing else
 *
 * The same delete Start Over does. The link the carrier sent stops opening (the
 * exchange finds nothing to open), and the driver's resume token stops writing.
 * A driver still holding the application on their own device keeps that copy:
 * they can submit it, and a later save from there starts a new draft — so a
 * deleted row can come back, and it is the driver who brings it.
 *
 * Their uploads stay in Storage, as they do after Start Over or the 30-day
 * expiry, because that same copy still points at them: deleting the files would
 * break the submission the driver can still make.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db } = require('../firebaseAdmin');
const { assertCompanyAdminStrict } = require('../shared/companyAccess');
const { checkRateLimit } = require('../shared/rateLimiter');
const draft = require('../shared/applicationDraft');
const prepared = require('../shared/companyPreparedDraft');
const { buildDraftRecord } = require('../shared/draftRecord');
const { applicantKeyOf, docId } = require('./identity');

/** Generous: an admin working down the list opens one after another. */
const VIEW_LIMIT = Object.freeze({ limit: 120, windowSeconds: 300 });
/** Deleting is rarer than reading, and a runaway loop should stop soon. */
const DELETE_LIMIT = Object.freeze({ limit: 30, windowSeconds: 300 });

/** One answer for a missing draft, whichever way it went: submitted, deleted or expired. */
const NOT_FOUND = 'That unfinished application could not be found. It may have been submitted or deleted, or it may have expired.';

function auditCollection(companyId) {
    return db.collection('companies').doc(companyId).collection('application_draft_audit');
}

/**
 * Who did what to which draft.
 *
 * The applicant key is already a hash of the company, email and phone, and the
 * actor is a staff account, so the entry holds nothing the driver typed. It
 * expires with the drafts themselves.
 */
function staffAction(action, uid, applicantKey, data) {
    return {
        action,
        outcome: 'ok',
        actorUid: String(uid).slice(0, 128),
        applicantKey,
        origin: prepared.isCompanyPrepared(data) ? prepared.ORIGIN_COMPANY : 'driver',
        status: typeof data?.status === 'string' ? data.status : 'in_progress',
        at: draft.serverTimestamp(),
        expiresAt: draft.expiresAt(),
    };
}

/**
 * The checks both callables share, in the order that discloses least: signed
 * in, a well-formed target, admin of THIS company, within the caller's budget.
 */
async function authorize(request, budgetName, budget) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Login required.');

    const companyId = docId(request.data?.companyId, 100);
    const applicantKey = applicantKeyOf(request.data?.applicantKey);
    if (!companyId || !applicantKey) {
        throw new HttpsError('invalid-argument', 'companyId and applicantKey are required.');
    }

    await assertCompanyAdminStrict(uid, companyId);

    const allowed = await checkRateLimit(
        `${budgetName}_${companyId}_${uid}`, budget.limit, budget.windowSeconds, 'closed',
    );
    if (!allowed) {
        throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a moment and try again.');
    }
    return { uid, companyId, applicantKey };
}

/**
 * The company as the driver's wizard saw it.
 *
 * Identity details from the company document; questions, settings and rules
 * from its public projection, which is what the wizard renders. The same two
 * sources, in the same order, `submitGuestApplication` reads.
 */
async function companyAsTheWizardSawIt(companyId) {
    const [companySnap, publicSnap] = await Promise.all([
        db.collection('companies').doc(companyId).get(),
        db.collection('public_profiles').doc(companyId).get(),
    ]);
    const company = companySnap.exists ? companySnap.data() || {} : {};
    const projection = publicSnap.exists ? publicSnap.data() || {} : {};
    return {
        ...company,
        companyName: projection.companyName || company.companyName || null,
        applicationConfig: projection.applicationConfig ?? company.applicationConfig ?? null,
        applicationRules: projection.applicationRules ?? company.applicationRules ?? null,
        customQuestions: Array.isArray(projection.customQuestions)
            ? projection.customQuestions
            : (Array.isArray(company.customQuestions) ? company.customQuestions : []),
    };
}

/**
 * Any unfinished application in full, read-only, for a Company Admin.
 *
 * Returns the row's summary (`toCompanySummary`, the shape the list already
 * uses) and `record`, the answers laid out as a submitted application reads
 * (`shared/draftRecord.js`). The raw stored answers are not returned: nothing on
 * this path edits them.
 */
exports.getApplicationDraft = onCall({ cors: true }, async (request) => {
    const { uid, companyId, applicantKey } = await authorize(request, 'draft_admin_view', VIEW_LIMIT);

    const doc = await draft.draftsCollection(companyId).doc(applicantKey).get();
    if (!doc.exists) throw new HttpsError('not-found', NOT_FOUND);
    const data = doc.data() || {};

    const record = buildDraftRecord({
        company: await companyAsTheWizardSawIt(companyId),
        formData: data.formData,
    });

    // Recorded, not enforced: the draft holds no SSN, so a view the audit could
    // not write is logged here rather than refused.
    try {
        await auditCollection(companyId).add(staffAction('company_viewed_draft', uid, applicantKey, data));
    } catch (error) {
        console.error(`[getApplicationDraft] Could not record the view of ${companyId}/${applicantKey} by ${uid}: ${error?.message || 'unknown'}`);
    }

    return { ...prepared.toCompanySummary(doc), record };
});

/**
 * Deletes one unfinished application, for a Company Admin.
 *
 * The existence check, the delete and the audit entry share one transaction, so
 * a deletion is never unrecorded and a missing draft is never reported as
 * deleted.
 */
exports.deleteApplicationDraft = onCall({ cors: true }, async (request) => {
    const { uid, companyId, applicantKey } = await authorize(request, 'draft_admin_delete', DELETE_LIMIT);

    const ref = draft.draftsCollection(companyId).doc(applicantKey);
    const auditRef = auditCollection(companyId).doc();
    const deleted = await db.runTransaction(async (transaction) => {
        const fresh = await transaction.get(ref);
        if (!fresh.exists) return false;
        // Read before the delete is queued, so the entry describes what was there.
        const entry = staffAction('company_deleted_draft', uid, applicantKey, fresh.data() || {});
        transaction.delete(ref);
        transaction.set(auditRef, entry);
        return true;
    });
    if (!deleted) throw new HttpsError('not-found', NOT_FOUND);

    console.info(`[deleteApplicationDraft] ${companyId}/${applicantKey} deleted by ${uid}`);
    return { deleted: true, applicantKey };
});

exports.__private = { DELETE_LIMIT, NOT_FOUND, VIEW_LIMIT };
