/**
 * The Storage objects an application owns, and their best-effort removal.
 *
 * Shared by the company-side `deleteApplication` and the Super Admin
 * `deleteSandboxApplication`, so the two deletions cannot drift apart: the
 * sandbox one used to remove only the Firestore record, leaving every test
 * upload and preserved PDF in the bucket Production shares.
 */

const { ORIGINAL_PDF_PREFIX } = require('./preserveApplicationPdf');

const storagePathOf = (value) => (
    value && typeof value === 'object' && typeof value.storagePath === 'string' && value.storagePath
        ? value.storagePath
        : null
);

/**
 * Collect Storage object paths from an application doc's file fields ({ storagePath } objects).
 *
 * A custom file question keeps its upload inside `customAnswers` (since
 * 2026-10-02). Those values are whatever the applicant's browser sent, so only a
 * path in the namespace `getSignedUploadUrl` issues application uploads into is
 * taken from there — `companies/{companyId}/applications/guest_uploads/`. The
 * company prefix alone was not enough: a crafted answer could name one of the
 * same company's DQ or PEV files, and this deletion runs with the Admin SDK.
 */
function collectStoragePaths(data, companyId) {
    const record = data || {};
    const paths = Object.values(record).map(storagePathOf).filter(Boolean);
    const answers = record.customAnswers && typeof record.customAnswers === 'object' ? record.customAnswers : {};
    const uploadPrefix = companyId ? `companies/${companyId}/applications/guest_uploads/` : null;
    for (const value of Object.values(answers)) {
        const path = storagePathOf(value);
        if (path && uploadPrefix && path.startsWith(uploadPrefix)) paths.push(path);
    }
    return paths;
}

/**
 * Delete an application's files: each path given, everything under the
 * application's own folder, and its preserved original PDFs.
 *
 * The originals live outside the `companies/` tree precisely so no Storage rule
 * can reach them, which also means the folder sweep cannot. They may carry a
 * full Social Security Number, so leaving them behind after the record is gone
 * would strand unreachable sensitive documents in the bucket for good.
 *
 * Every delete settles on its own: a missing file must not stop the rest.
 */
function deleteApplicationFiles({ bucket, companyId, collectionName = 'applications', applicationId, paths = [] }) {
    return Promise.allSettled([
        ...paths.map((path) => bucket.file(path).delete()),
        bucket.deleteFiles({ prefix: `companies/${companyId}/${collectionName}/${applicationId}/` }),
        bucket.deleteFiles({ prefix: `${ORIGINAL_PDF_PREFIX}/${companyId}/${applicationId}/` }),
    ]);
}

module.exports = { collectStoragePaths, deleteApplicationFiles };
