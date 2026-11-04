/**
 * The company signature: an image the company places on a template or a
 * document, which the signer sees as it is and never fills.
 *
 * Its field is stored with the others (`templateFieldSerializer.js`) in the
 * shape the server reads, `companySignaturePath` naming the image in the
 * company's originals. Every document carries its own path, so a document sent
 * from a template starts with the template's image and may be given its own
 * without touching the template; an image is never deleted for that reason.
 * The signing room gets a short-lived link to it from `getPublicEnvelope`, never
 * the path. Pure: no Firebase here (`companySignatureUpload.js` uploads).
 */

export const COMPANY_SIGNATURE_TYPE = 'company_signature';
export const COMPANY_SIGNATURE_LABEL = 'Company Signature';

/** The largest image accepted: 2 MB. Storage allows 20 MB under `originals`; this is the product's own limit. */
export const COMPANY_SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;

/** The image types accepted, and the extension each is stored under. */
const EXTENSIONS = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg' });
export const COMPANY_SIGNATURE_ACCEPT = Object.keys(EXTENSIONS).join(',');

/** What a sender is told when a document would go out without its company signature. */
export const COMPANY_SIGNATURE_MISSING_MESSAGE =
    'Upload the company signature image before sending. A company signature on this document has no image yet.';

export function isCompanySignatureField(field) {
    return field?.type === COMPANY_SIGNATURE_TYPE;
}

const hasImage = (field) => String(field?.companySignaturePath ?? '').trim() !== '';

/** Why an image cannot be the company signature, or null when it can. */
export function companySignatureImageError(file) {
    if (!file || !EXTENSIONS[file.type]) return 'Choose a PNG or JPEG image.';
    if (file.size > COMPANY_SIGNATURE_MAX_BYTES) return 'The image is larger than 2 MB. Choose a smaller one.';
    return null;
}

/** Where an image is stored: the company's originals, under its own random name. */
export function companySignatureStoragePath(companyId, file, name) {
    return `secure_documents/${companyId}/originals/company-signatures/${name}.${EXTENSIONS[file.type]}`;
}

/** The company signatures that have no image yet; a document with one is not sent. */
export function fieldsMissingCompanySignature(fields) {
    return (Array.isArray(fields) ? fields : []).filter((field) => isCompanySignatureField(field) && !hasImage(field));
}

/**
 * The fields with this document's own images, by field id, in place of the
 * ones they carry. New objects: the fields given (a template's) are untouched.
 */
export function withCompanySignaturePaths(fields, pathsById = {}) {
    return (Array.isArray(fields) ? fields : []).map((field) => (
        isCompanySignatureField(field) && Object.prototype.hasOwnProperty.call(pathsById, field.id)
            ? { ...field, companySignaturePath: pathsById[field.id] }
            : field
    ));
}

/** The signer's values without any for a company signature, which is never submitted. */
export function withoutCompanySignatureValues(fields, values = {}) {
    const fixed = new Set((Array.isArray(fields) ? fields : []).filter(isCompanySignatureField).map((field) => field.id));
    return Object.fromEntries(Object.entries(values).filter(([id]) => !fixed.has(id)));
}
