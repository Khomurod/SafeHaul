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
const prepared = require('../shared/companyPreparedDraft');
const { docId } = require('./identity');

/** The most rows one list holds: the most recently active, newest first. */
const LIST_LIMIT = 200;
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
 *
 * ## Why this is the ONLY list
 *
 * The unified workspace reads this one, and every row it shows is one document
 * from one query. **Deduplication is structural rather than a merge step somebody
 * has to keep correct** — there is no union of two result sets to reconcile, and no
 * key to match them on wrongly. `toCompanySummary` supplies the shape: the
 * answer-free summary, which also resolves `origin` for driver-authored drafts.
 *
 * A list is not a security boundary: it returns contact-and-progress, never an
 * answer. The read rule lives in `getCompanyPreparedDraft` (`companyMayReadAnswers`,
 * plus an outright refusal of any draft the carrier did not author), unaffected by
 * who lists what.
 *
 * It holds the `LIST_LIMIT` most recently active and reads one more, so that
 * `truncated` says when older ones exist: the page then says it shows the most
 * recent rather than counting what it was not given.
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
            .limit(LIST_LIMIT + 1)
            .get();

        return {
            // One document in, one row out. `toCompanySummary` reads the name from
            // the draft's own answers, where the applicant typed it — the
            // normalized contact copies beside it exist for matching, not display —
            // and carries no answers of any kind.
            drafts: snapshot.docs.slice(0, LIST_LIMIT).map((doc) => prepared.toCompanySummary(doc)),
            truncated: snapshot.docs.length > LIST_LIMIT,
            retentionDays: draft.RETENTION_DAYS,
            generatedAt: new Date().toISOString(),
        };
    } catch (error) {
        console.error(`[listApplicationDrafts] ${error?.message || 'unknown error'}`);
        throw new HttpsErrorV2('internal', 'The list could not be loaded.');
    }
});
