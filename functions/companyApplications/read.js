/**
 * Reading back what the carrier prepared.
 *
 * Part of the company-prepared application surface; `companyApplications.js` is
 * the deployment surface. The read rule — full answers while the carrier is still
 * the author, contact-and-progress once the driver has written — is stated and
 * justified in `shared/companyPreparedDraft.js`.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { assertCompanyAccessForRequest } = require('../shared/companyAccess');
const draft = require('../shared/applicationDraft');
const prepared = require('../shared/companyPreparedDraft');
const { applicantKeyOf, docId } = require('../drafts/identity');

/**
 * One prepared application, as much of it as the carrier may still see.
 *
 * A driver-authored draft is never returned here whatever it is asked for: this
 * callable answers for the carrier's own work, and `listApplicationDrafts` is
 * where an unfinished driver application is looked at (as a contact, not a
 * preview).
 */
exports.getCompanyPreparedDraft = onCall({ cors: true }, async (request) => {
    const companyId = docId(request.data?.companyId, 100);
    const applicantKey = applicantKeyOf(request.data?.applicantKey);
    if (!companyId || !applicantKey) {
        throw new HttpsError('invalid-argument', 'companyId and applicantKey are required.');
    }

    await assertCompanyAccessForRequest(request, companyId, 'getCompanyPreparedDraft');

    const doc = await draft.draftsCollection(companyId).doc(applicantKey).get();
    if (!doc.exists || !prepared.isCompanyPrepared(doc.data())) {
        throw new HttpsError('not-found', 'No prepared application was found.');
    }

    return prepared.companyMayReadAnswers(doc.data())
        ? prepared.toCompanyDraft(doc)
        // The driver is editing it now. Its progress is still the carrier's
        // business; its contents are the driver's.
        : { ...prepared.toCompanySummary(doc), formData: null, lockedEmployers: [], readable: false };
});
