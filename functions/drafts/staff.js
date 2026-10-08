/**
 * What every Company Admin action on an unfinished application shares: who may
 * ask, the answer for a draft that is not there, and the audit entry.
 *
 * Used by `admin.js` (read, correct, delete one) and `purge.js` (delete with
 * everything in it), so the two ask the same questions in the same order.
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { db } = require('../firebaseAdmin');
const { assertCompanyAdminStrict } = require('../shared/companyAccess');
const { checkRateLimit } = require('../shared/rateLimiter');
const draft = require('../shared/applicationDraft');
const prepared = require('../shared/companyPreparedDraft');
const { applicantKeyOf, docId } = require('./identity');

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
 * The checks every Company Admin callable shares, in the order that discloses
 * least: signed in, a well-formed target, admin of THIS company, within the
 * caller's budget.
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

module.exports = { NOT_FOUND, auditCollection, authorize, staffAction };
