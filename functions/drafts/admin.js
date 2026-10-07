/**
 * What a Company Admin may do with any unfinished application: read it, correct
 * it, and delete it.
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
 * Every view, edit and deletion is audited in `application_draft_audit`, by who
 * and which draft, never by what it says.
 *
 * ## Why an admin's edit reaches the driver
 *
 * The driver fills the application in on their own device, and every save sends
 * their whole copy. So an edit is recorded as one (`shared/companyEdits.js`): the
 * driver's page takes the edited answers, names them above every step, and asks
 * for the signature again when one changed. An answer the driver changed after
 * the admin opened the application is refused rather than overwritten, so the
 * admin sees it before deciding again. The carrier's own prepared application,
 * before the driver has saved it, is the preparation workspace's to edit.
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
const {
    EDITABLE_FIELDS, clientCompanyEdits, companyEditsOf, fitsField, nextCompanyRevision, sameAnswer,
} = require('../shared/companyEdits');
const { buildDraftRecord } = require('../shared/draftRecord');
const { applicantKeyOf, docId } = require('./identity');

/** Generous: an admin working down the list opens one after another. */
const VIEW_LIMIT = Object.freeze({ limit: 120, windowSeconds: 300 });
/** Deleting is rarer than reading, and a runaway loop should stop soon. */
const DELETE_LIMIT = Object.freeze({ limit: 30, windowSeconds: 300 });
/** An admin correcting an application saves often, section by section. */
const EDIT_LIMIT = Object.freeze({ limit: 60, windowSeconds: 300 });

const EDITABLE = new Set(EDITABLE_FIELDS);

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

/** The stored answers an admin may change, and nothing else the draft keeps. */
function editableAnswers(formData) {
    const answers = formData && typeof formData === 'object' ? formData : {};
    return Object.fromEntries(Object.entries(answers).filter(([field]) => EDITABLE.has(field)));
}

/**
 * One unfinished application, as a Company Admin reads and edits it.
 *
 * The row's summary (`toCompanySummary`, the shape the list already uses);
 * `record`, the answers laid out as a submitted application reads
 * (`shared/draftRecord.js`); and for the editor, the answers it may change, the
 * company's form as the wizard showed it, whether this draft is the admin's to
 * edit at all, and its record of edits so far.
 */
async function adminView(companyId, doc) {
    const data = doc.data() || {};
    const company = await companyAsTheWizardSawIt(companyId);
    return {
        ...prepared.toCompanySummary(doc),
        record: buildDraftRecord({ company, formData: data.formData }),
        editable: !prepared.companyMayReadAnswers(data),
        answers: editableAnswers(data.formData),
        lockedEmployers: Array.isArray(data.lockedEmployers) ? data.lockedEmployers : [],
        form: {
            applicationConfig: company.applicationConfig,
            applicationRules: company.applicationRules,
            customQuestions: company.customQuestions,
        },
        ...clientCompanyEdits(data),
        companyEditedAt: data.companyEditedAt?.toDate?.()?.toISOString?.() || null,
    };
}

/** Any unfinished application in full, for a Company Admin; see `adminView`. */
exports.getApplicationDraft = onCall({ cors: true }, async (request) => {
    const { uid, companyId, applicantKey } = await authorize(request, 'draft_admin_view', VIEW_LIMIT);

    const doc = await draft.draftsCollection(companyId).doc(applicantKey).get();
    if (!doc.exists) throw new HttpsError('not-found', NOT_FOUND);

    // Recorded, not enforced: the draft holds no SSN, so a view the audit could
    // not write is logged here rather than refused.
    try {
        await auditCollection(companyId).add(staffAction('company_viewed_draft', uid, applicantKey, doc.data() || {}));
    } catch (error) {
        console.error(`[getApplicationDraft] Could not record the view of ${companyId}/${applicantKey} by ${uid}: ${error?.message || 'unknown'}`);
    }

    return adminView(companyId, doc);
});

/**
 * The editor's request: each changed answer's new value (`changes`), and the
 * value it held when the editor loaded it (`base`). Refused whole when any
 * answer is one only the driver gives, or is not the shape the wizard stores.
 */
function editRequest(data) {
    const changes = data?.changes;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).length === 0) {
        throw new HttpsError('invalid-argument', 'There are no changes to save.');
    }
    const base = data?.base && typeof data.base === 'object' && !Array.isArray(data.base) ? data.base : {};
    if (!draft.withinPayloadBudget(changes) || !draft.withinPayloadBudget(base)) {
        throw new HttpsError('invalid-argument', 'That is too much data for one application.');
    }

    const fields = Object.keys(changes);
    const driverOnly = fields.filter((field) => !EDITABLE.has(field));
    if (driverOnly.length > 0) {
        throw new HttpsError('invalid-argument', 'Only the driver can change some of these answers.', { fields: driverOnly });
    }
    const misshapen = fields.filter((field) => !fitsField(field, changes[field]));
    if (misshapen.length > 0) {
        throw new HttpsError('invalid-argument', 'Some of these answers are not in the form the application stores.', { fields: misshapen });
    }

    const clean = (source) => Object.fromEntries(
        fields.map((field) => [field, draft.sanitizeDraftData(source[field])]),
    );
    return { changes: clean(changes), base: clean(base) };
}

/**
 * Saves a Company Admin's changes to an unfinished application the driver owns.
 *
 * Only what actually changes is written and recorded as an edit, at a new
 * revision (`shared/companyEdits.js`). An answer the driver changed since the
 * editor loaded it is refused rather than overwritten (`aborted`, naming the
 * answers), and so is the carrier's own prepared application before the driver
 * has saved it. The read, the checks, the write and the audit entry share one
 * transaction. Answers with the draft's view, as `getApplicationDraft` does.
 */
exports.saveApplicationDraftEdits = onCall({ cors: true }, async (request) => {
    const { uid, companyId, applicantKey } = await authorize(request, 'draft_admin_edit', EDIT_LIMIT);
    const { changes, base } = editRequest(request.data);

    const ref = draft.draftsCollection(companyId).doc(applicantKey);
    const auditRef = auditCollection(companyId).doc();
    const outcome = await db.runTransaction(async (transaction) => {
        const fresh = await transaction.get(ref);
        if (!fresh.exists) return { missing: true };
        const data = fresh.data() || {};
        if (prepared.companyMayReadAnswers(data)) return { preparing: true };

        const stored = data.formData || {};
        const fields = Object.keys(changes);
        const conflicts = fields.filter((field) => !sameAnswer(stored[field], base[field]));
        if (conflicts.length > 0) return { conflicts };

        const changed = fields.filter((field) => !sameAnswer(stored[field], changes[field]));
        if (changed.length === 0) return { changed, revision: null };

        const formData = { ...stored };
        for (const field of changed) formData[field] = changes[field];
        if (!draft.withinPayloadBudget(formData)) return { tooLarge: true };

        const revision = nextCompanyRevision(data);
        const companyEdits = companyEditsOf(data);
        for (const field of changed) companyEdits[field] = revision;
        const update = {
            formData,
            companyRevision: revision,
            companyEdits,
            companyEditedAt: draft.serverTimestamp(),
            updatedAt: draft.serverTimestamp(),
            expiresAt: draft.expiresAt(),
        };
        // A lock names an employer row. One the edit removed would stay behind as
        // a requirement the driver is held to at submission and cannot meet.
        if (changed.includes('employers') && Array.isArray(data.lockedEmployers)) {
            update.lockedEmployers = prepared.reconcileLockedEmployers(data.lockedEmployers, formData);
        }
        // `update`, not a merging `set`: the answers are replaced whole, so an
        // answer the admin cleared from a map is cleared, not merged back.
        transaction.update(ref, update);
        transaction.set(auditRef, {
            ...staffAction('company_edited_draft', uid, applicantKey, data),
            fields: changed,
            revision,
        });
        return { changed, revision };
    });

    if (outcome.missing) throw new HttpsError('not-found', NOT_FOUND);
    if (outcome.preparing) {
        throw new HttpsError('failed-precondition', 'Your company is still preparing this application. Edit it in the preparation workspace.');
    }
    if (outcome.conflicts) {
        throw new HttpsError(
            'aborted',
            'The driver changed some of these answers after you opened the application. Reload it to see their answers, then make your change again.',
            { fields: outcome.conflicts },
        );
    }
    if (outcome.tooLarge) throw new HttpsError('invalid-argument', 'That is too much data for one application.');

    const doc = await ref.get();
    if (!doc.exists) throw new HttpsError('not-found', NOT_FOUND);
    return { ...(await adminView(companyId, doc)), changed: outcome.changed, revision: outcome.revision };
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

exports.__private = { DELETE_LIMIT, EDIT_LIMIT, NOT_FOUND, VIEW_LIMIT };
