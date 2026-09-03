/**
 * Creating and updating a carrier-prepared driver application.
 *
 * Part of the company-prepared application surface; `companyApplications.js` is
 * the deployment surface that re-exports the handlers by name. See
 * `shared/companyPreparedDraft.js` for why this stages a draft rather than
 * creating an application, and what `origin`/`status` mean.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db } = require('../firebaseAdmin');
const { checkRateLimit } = require('../shared/rateLimiter');
const { assertCompanyAccessForRequest } = require('../shared/companyAccess');
const { generateApplicantKey } = require('../shared/buildApplicationDoc');
const draft = require('../shared/applicationDraft');
const prepared = require('../shared/companyPreparedDraft');
const { docId, text } = require('../drafts/identity');

/** Generous: a recruiter proofreading a long application saves repeatedly. */
const SAVE_LIMIT = Object.freeze({ limit: 60, windowSeconds: 300 });

/**
 * Stage a driver application the carrier filled in.
 *
 * The document id is the same deterministic applicant key a driver's own draft
 * would get — `sha256(companyId:email:phone)` — because the draft, the invite the
 * driver opens and the application it becomes must all be one identity. That is
 * why the carrier is asked for the driver's email and phone before anything else:
 * they are not contact details here, they are the key.
 *
 * Refuses outright when a driver already has their own unfinished application at
 * that key. Overwriting it would delete work the driver did, in favour of a
 * carrier's guess at the same answers, with nothing to merge back — so the carrier
 * is told to follow up on the existing one instead.
 */
exports.saveCompanyPreparedApplication = onCall({ cors: true }, async (request) => {
    const companyId = docId(request.data?.companyId, 100);
    if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');

    await assertCompanyAccessForRequest(request, companyId, 'saveCompanyPreparedApplication');

    const email = text(request.data?.email, 200);
    const phone = text(request.data?.phone, 40);
    if (!email && !phone) {
        throw new HttpsError('invalid-argument', "Enter the driver's email or phone first — it identifies the application.");
    }

    const formData = request.data?.formData && typeof request.data.formData === 'object'
        ? request.data.formData
        : {};
    if (!draft.withinPayloadBudget(formData)) {
        throw new HttpsError('invalid-argument', 'That is too much data for one application.');
    }

    const allowed = await checkRateLimit(
        `company_prepare_${companyId}_${request.auth.uid}`,
        SAVE_LIMIT.limit, SAVE_LIMIT.windowSeconds, 'closed',
    );
    if (!allowed) {
        throw new HttpsError('resource-exhausted', 'Too many saves. Please wait a moment and try again.');
    }

    const { applicantKey, applicantKeyFull } = generateApplicantKey(companyId, email, phone);
    const lockedEmployers = prepared.normalizeLockedEmployers(request.data?.lockedEmployers);
    const ref = draft.draftsCollection(companyId).doc(applicantKey);

    /**
     * Read and write together, so two recruiters preparing the same driver cannot
     * each observe "nothing here" and overwrite one another — and so a save cannot
     * land on a draft the driver started between the read and the write.
     */
    const result = await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(ref);
        const data = existing.exists ? existing.data() || {} : null;

        if (data && !prepared.isCompanyPrepared(data)) {
            return { conflict: 'driver_draft' };
        }
        if (data && data.status === prepared.PREPARED_STATUSES.DRIVER_IN_PROGRESS) {
            // The driver has taken it over; the carrier's copy is no longer the
            // live one, and writing over their answers is exactly what the
            // read-cutoff rule exists to prevent.
            return { conflict: 'driver_editing' };
        }

        const update = {
            companyId,
            applicantKey,
            applicantKeyFull,
            origin: prepared.ORIGIN_COMPANY,
            status: data?.status === prepared.PREPARED_STATUSES.SENT
                ? prepared.PREPARED_STATUSES.SENT
                : prepared.PREPARED_STATUSES.PREPARED,
            contactEmail: email.toLowerCase(),
            contactPhone: phone.replace(/\D/g, ''),
            // No identity HMAC: it is built from the driver's own last name, date
            // of birth and SSN, and a draft never holds an SSN. The driver's first
            // save supplies it, which is also when cross-device resume starts to
            // matter.
            formData: draft.sanitizeDraftData(formData),
            lockedEmployers,
            lastStep: 0,
            lastSemanticStep: null,
            preparedBy: {
                uid: text(request.auth.uid, 128),
                name: text(request.auth.token?.name || request.auth.token?.email, 120),
                at: draft.serverTimestamp(),
            },
            updatedAt: draft.serverTimestamp(),
            expiresAt: draft.expiresAt(),
        };
        if (!existing.exists) update.createdAt = draft.serverTimestamp();

        transaction.set(ref, update, { merge: true });
        return { conflict: null };
    });

    if (result.conflict === 'driver_draft') {
        throw new HttpsError(
            'already-exists',
            'This driver already has an application in progress. Follow up on it from Unfinished applications instead of starting a new one.',
        );
    }
    if (result.conflict === 'driver_editing') {
        throw new HttpsError(
            'failed-precondition',
            'The driver has started filling this in, so it can no longer be edited here.',
        );
    }

    return { saved: true, applicantKey, lockedEmployers };
});

exports.__private = { SAVE_LIMIT };
