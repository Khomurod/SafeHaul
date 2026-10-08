/**
 * The files a driver uploads into an application, whether they are still there,
 * and which of them a submitted application keeps.
 *
 * Every application upload, the driver's own and a Company Admin's, goes through
 * `getSignedUploadUrl` (`storageSecure.js`), which hands out exactly one shape of
 * path: `companies/{companyId}/(applications|autofill)/guest_uploads/{one name}`.
 * The answers that point at those files arrive from a browser, so nothing reads a
 * path out of them as a file to delete, or to vouch for, unless it has that shape
 * for that company: a crafted answer cannot name a DQ file, a PEV document or
 * another company's upload.
 *
 * A path is no proof of whose file it is, though: an answer can name a file an
 * application someone else submitted uses. So a submission marks every upload it
 * files (`SUBMITTED_MARK`), and a draft's deletion takes none that is marked, or
 * older than the marks (`deletableUpload`).
 */

const { resolveGate } = require('./applicationDefinition');
const { withinStep } = require('./withinStep');

const FOLDERS = Object.freeze(['applications', 'autofill']);
/** What `getSignedUploadUrl` writes after the folder: `{ms}_{random}_{cleaned name}`. */
const NAME = /^[A-Za-z0-9._-]+$/;
/** Deep enough for any answer the wizard stores; a draft is already bounded at 6. */
const MAX_DEPTH = 8;
/** The custom metadata a submission sets on each upload it files. */
const SUBMITTED_MARK = 'safehaulSubmitted';
/** More uploads than an application holds; a crafted one naming more marks only these. */
const MAX_MARKED = 50;
/**
 * Submissions mark their uploads from this release on. A file created before it
 * may belong to an application submitted unmarked, so no draft's deletion takes it.
 */
const MARKS_SINCE = Date.parse('2026-10-12T00:00:00Z');
/**
 * The longest a submission waits for its marks, well inside its 30 seconds:
 * Storage's own retries can take longer than the whole submission.
 */
const MARK_MS = 8000;

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

/**
 * When `getSignedUploadUrl` named this upload, from the milliseconds its name
 * starts with; NaN for a name that does not start with them.
 */
function uploadNamedAt(path) {
    const name = typeof path === 'string' ? path.slice(path.lastIndexOf('/') + 1) : '';
    const millis = /^\d{1,15}_/.test(name) ? Number(name.slice(0, name.indexOf('_'))) : NaN;
    return Number.isSafeInteger(millis) ? millis : NaN;
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
 * May a draft's deletion take this Storage object? Only one no submission marked,
 * created since the marks began.
 *
 * @param {{ metadata?: object, timeCreated?: string }} metadata the object's, as Storage reports it
 */
function deletableUpload(metadata, since = MARKS_SINCE) {
    return !metadata?.metadata?.[SUBMITTED_MARK] && Date.parse(metadata?.timeCreated) >= since;
}

/**
 * Marks every upload a submission files, and refuses the submission when one
 * the driver could upload again is gone.
 *
 * The mark keeps the file from any draft's deletion (`drafts/draftFiles.js`),
 * whatever else points at it, and that deletion takes a file only while it is
 * unmarked, so the two cannot cross: whichever comes second finds the other done.
 *
 * A copy of an application kept on the driver's device can outlive its files: a
 * Company Admin may have deleted the unfinished application with everything in
 * it. Filed as it is, the application would show the carrier documents that open
 * nothing. So the driver is sent back to the page the file was on, to upload it
 * again, with the same `issues` every other refusal names a page with.
 *
 * Only a file Storage says is not there refuses. A mark that could not be set
 * otherwise lets the submission through: a signed application is not refused
 * over a call that failed, nor held up past `waitMs` by one that is slow. Each
 * call has `waitMs` of its own, so one that does not answer cannot hide another
 * file's answer that it is gone.
 */
async function markSubmittedUploads({ storage, companyId, formData, applicationConfig, customQuestions, HttpsError, waitMs = MARK_MS }) {
    const paths = guestUploadPathsIn(formData, companyId).slice(0, MAX_MARKED);
    if (paths.length === 0) return;
    let results;
    try {
        const bucket = storage.bucket();
        results = await Promise.allSettled(paths.map((path) => withinStep(bucket.file(path).setMetadata({
            metadata: { [SUBMITTED_MARK]: 'true' },
        }), waitMs)));
    } catch (error) {
        console.error(`[guestUploads] Could not mark the uploads of a submission to ${companyId}: ${error?.message || 'unknown'}`);
        return;
    }
    const gone = new Set(paths.filter((_, index) => results[index].reason?.code === 404));
    const unmarked = results.filter((result, index) => result.status === 'rejected' && !gone.has(paths[index]));
    if (unmarked.length > 0) {
        // Codes only: a Storage message can carry the file's name, which is the driver's.
        const codes = [...new Set(unmarked.map((result) => String(result.reason?.code ?? 'unknown')))].join(',');
        console.error(`[guestUploads] Could not mark ${unmarked.length} upload(s) of a submission to ${companyId} (code ${codes})`);
    }
    const missing = reuploadableEntries(formData, companyId, { applicationConfig, customQuestions })
        .filter(({ path }) => gone.has(path));
    if (missing.length === 0) return;
    const one = missing.length === 1;
    throw new HttpsError(
        'invalid-argument',
        `${one ? 'One of your uploaded files is' : 'Some of your uploaded files are'} no longer saved. Upload ${one ? 'it' : 'them'} again, then submit.`,
        { issues: missing.map(({ fieldId, semanticStep }) => ({ code: 'upload-missing', semanticStep, fieldId })) },
    );
}

module.exports = {
    MARKS_SINCE, MARK_MS, SUBMITTED_MARK, deletableUpload, guestUploadPathsIn, isGuestUploadPath, markSubmittedUploads,
    reuploadableEntries, uploadNamedAt,
};
