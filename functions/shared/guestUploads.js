/**
 * The files a driver uploads into an application, and whether they are still there.
 *
 * Every application upload, the driver's own and a Company Admin's, goes through
 * `getSignedUploadUrl` (`storageSecure.js`), which hands out exactly one shape of
 * path: `companies/{companyId}/(applications|autofill)/guest_uploads/{one name}`.
 * The answers that point at those files arrive from a browser, so nothing reads a
 * path out of them as a file to delete, or to vouch for, unless it has that shape
 * for that company: a crafted answer cannot name a DQ file, a PEV document or
 * another company's upload.
 */

const { resolveGate } = require('./applicationDefinition');

const FOLDERS = Object.freeze(['applications', 'autofill']);
/** What `getSignedUploadUrl` writes after the folder: `{ms}_{random}_{cleaned name}`. */
const NAME = /^[A-Za-z0-9._-]+$/;
/** Deep enough for any answer the wizard stores; a draft is already bounded at 6. */
const MAX_DEPTH = 8;

/**
 * The licence page's uploads, each with the company setting that hides it. These
 * and a company's own file questions are every upload the wizard shows a driver.
 */
const LICENCE_PAGE_UPLOADS = Object.freeze({
    'cdl-front': 'cdlUpload',
    'cdl-back': 'cdlUpload',
    'medical-card-upload': 'medCardUpload',
    'mvr-consent-upload': 'mvrConsent',
    'twic-card-upload': null,
});

/** Is this a driver upload of this company, as `getSignedUploadUrl` issues them? */
function isGuestUploadPath(path, companyId) {
    if (typeof path !== 'string' || typeof companyId !== 'string' || !companyId) return false;
    return FOLDERS.some((folder) => {
        const prefix = `companies/${companyId}/${folder}/guest_uploads/`;
        if (!path.startsWith(prefix)) return false;
        const name = path.slice(prefix.length);
        return NAME.test(name) && name !== '.' && name !== '..';
    });
}

const storagePathOf = (value) => (
    value && typeof value === 'object' && typeof value.storagePath === 'string' ? value.storagePath : null
);

/**
 * Every upload path anywhere in a stored record, once each.
 *
 * Any string of the upload shape counts, not only a `storagePath`, so a copy kept
 * under another name (a DQ file's, a snapshot's) is found as well.
 */
function guestUploadPathsIn(value, companyId) {
    const found = new Set();
    const walk = (node, depth) => {
        if (depth > MAX_DEPTH || node === null || node === undefined) return;
        if (typeof node === 'string') {
            if (isGuestUploadPath(node, companyId)) found.add(node);
            return;
        }
        if (typeof node !== 'object') return;
        for (const item of Array.isArray(node) ? node : Object.values(node)) walk(item, depth + 1);
    };
    walk(value, 0);
    return [...found];
}

/**
 * The uploads in these answers that the driver could upload again: those on the
 * licence page that the company shows, and those answering one of its current
 * file questions. A document the carrier attached that the wizard never shows
 * (a PSP report, say) is not among them, because the driver could not replace it.
 *
 * @returns {Array<{fieldId: string, path: string, semanticStep: string}>}
 */
function reuploadableEntries(formData, companyId, { applicationConfig, customQuestions } = {}) {
    const answers = formData && typeof formData === 'object' ? formData : {};
    const entries = [];
    const add = (fieldId, value, semanticStep) => {
        const path = storagePathOf(value);
        if (path && isGuestUploadPath(path, companyId)) entries.push({ fieldId, path, semanticStep });
    };
    for (const [fieldId, gate] of Object.entries(LICENCE_PAGE_UPLOADS)) {
        const shown = gate ? !resolveGate(applicationConfig, gate).hidden : answers['has-twic'] === 'yes';
        if (shown) add(fieldId, answers[fieldId], 'license');
    }
    const custom = answers.customAnswers && typeof answers.customAnswers === 'object' ? answers.customAnswers : {};
    for (const question of Array.isArray(customQuestions) ? customQuestions : []) {
        if (question?.id && (question.type === 'file' || question.type === 'fileUpload')) {
            add(question.id, custom[question.id], 'custom_questions');
        }
    }
    return entries;
}

/**
 * Refuses a submission whose uploads are no longer in Storage.
 *
 * A copy of an application kept on the driver's device can outlive its files: a
 * Company Admin may have deleted the unfinished application with everything in
 * it. Filed as it is, the application would show the carrier documents that open
 * nothing. So the driver is sent back to the page the file was on, to upload it
 * again, with the same `issues` every other refusal names a page with.
 *
 * Only a file Storage says is not there refuses. A check that could not be made
 * lets the submission through: a signed application is not refused over a lookup
 * that failed.
 */
async function assertUploadsExist({ storage, companyId, formData, applicationConfig, customQuestions, HttpsError }) {
    const entries = reuploadableEntries(formData, companyId, { applicationConfig, customQuestions });
    if (entries.length === 0) return;
    let missing;
    try {
        const bucket = storage.bucket();
        const present = await Promise.all(entries.map(async ({ path }) => (await bucket.file(path).exists())[0]));
        missing = entries.filter((_, index) => present[index] === false);
    } catch (error) {
        console.error(`[guestUploads] Could not check the uploads of a submission to ${companyId}: ${error?.message || 'unknown'}`);
        return;
    }
    if (missing.length === 0) return;
    const one = missing.length === 1;
    throw new HttpsError(
        'invalid-argument',
        `${one ? 'One of your uploaded files is' : 'Some of your uploaded files are'} no longer saved. Upload ${one ? 'it' : 'them'} again, then submit.`,
        { issues: missing.map(({ fieldId, semanticStep }) => ({ code: 'upload-missing', semanticStep, fieldId })) },
    );
}

module.exports = { assertUploadsExist, guestUploadPathsIn, isGuestUploadPath, reuploadableEntries };
