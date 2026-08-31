/**
 * The company view of unfinished applications.
 *
 * 2nd generation, unlike the guest callables beside it — matching `submitGuestApplication`
 * and the rest of the staff-facing surface rather than the intake one.
 *
 * Part of the guest application-draft surface. The runtime options and limits
 * are in `./runtime`; `applicationDrafts.js` is the deployment surface that
 * re-exports the handlers by name.
 */

const { onCall: onCallV2, HttpsError: HttpsErrorV2 } = require('firebase-functions/v2/https');
const { assertCompanyAccessForRequest } = require('../shared/companyAccess');
const draft = require('../shared/applicationDraft');
const { docId } = require('./identity');
// ---------------------------------------------------------------------------
// Recruiter view
// ---------------------------------------------------------------------------

/**
 * Unfinished applications, for the company's own staff.
 *
 * This is the half of the feature that turns "the data is not lost" into
 * something a carrier can act on. Without it a draft is only ever useful to the
 * applicant who returns on their own, and a recruiter watching applications drop
 * off at the licence page still has nothing to call.
 *
 * ## What it shows, and what it does not
 *
 * Enough to recognise and contact someone: name, email, phone, how far they got
 * and when. Not the answers themselves. A recruiter has no need to read a
 * half-finished DOT questionnaire, and an unfinished application is not a record
 * the applicant has agreed to file — they have signed nothing and consented to
 * nothing. Reading one is a decision the applicant has not yet made, so the
 * summary is deliberately a contact list rather than a preview.
 *
 * There is no Social Security Number to withhold: drafts never store one.
 *
 * A second generation callable, unlike the guest-facing ones, because it is an
 * authenticated staff read with no rate-limit-by-IP consideration.
 */
exports.listApplicationDrafts = onCallV2({ cors: true }, async (request) => {
    const companyId = docId(request.data?.companyId, 100);
    if (!companyId) {
        throw new HttpsErrorV2('invalid-argument', 'companyId is required.');
    }

    await assertCompanyAccessForRequest(request, companyId, 'listApplicationDrafts');

    try {
        const snapshot = await draft.draftsCollection(companyId)
            .orderBy('updatedAt', 'desc')
            .limit(200)
            .get();

        return {
            drafts: snapshot.docs.map((doc) => {
                const data = doc.data() || {};
                const form = data.formData || {};
                return {
                    applicantKey: doc.id,
                    // From the draft's own answers, which is where the applicant
                    // typed them; the normalized contact copies alongside exist
                    // for matching, not for display.
                    firstName: typeof form.firstName === 'string' ? form.firstName.slice(0, 80) : '',
                    lastName: typeof form.lastName === 'string' ? form.lastName.slice(0, 80) : '',
                    email: data.contactEmail || '',
                    phone: data.contactPhone || '',
                    lastSemanticStep: data.lastSemanticStep || null,
                    lastStep: Number.isInteger(data.lastStep) ? data.lastStep : 0,
                    startedAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
                    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
                };
            }),
            retentionDays: draft.RETENTION_DAYS,
            generatedAt: new Date().toISOString(),
        };
    } catch (error) {
        console.error(`[listApplicationDrafts] ${error?.message || 'unknown error'}`);
        throw new HttpsErrorV2('internal', 'The list could not be loaded.');
    }
});
