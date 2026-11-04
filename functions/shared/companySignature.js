/**
 * The company's signature on an e-document: an image a company user uploads and
 * places on a template or a single document (`type: 'company_signature'`). The
 * field names the image itself (`companySignaturePath`), so the sealed PDF draws
 * it from there and never from anything the signer sends.
 *
 * Only an image in the company's own company-signatures folder counts:
 * `secure_documents/{companyId}/originals/company-signatures/<name>.png|.jpg|.jpeg`.
 * The browser uploads it there (the Storage rule lets the team write under
 * `originals`). It is a company file a template and all its documents may
 * share, so nothing deletes it after sealing.
 */

const COMPANY_SIGNATURE_TYPE = 'company_signature';
const IMAGE_NAME = /\.(png|jpe?g)$/i;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function isCompanySignatureField(field) {
    return Boolean(field) && typeof field === 'object' && field.type === COMPANY_SIGNATURE_TYPE;
}

function companySignatureFolder(companyId) {
    return `secure_documents/${companyId}/originals/company-signatures/`;
}

/** The field's image path when it is an image in `companyId`'s company-signatures folder, else null. */
function companySignatureImagePath(companyId, field) {
    const value = field?.companySignaturePath;
    if (typeof companyId !== 'string' || !companyId || typeof value !== 'string') return null;
    const folder = companySignatureFolder(companyId);
    if (!value.startsWith(folder)) return null;
    const segments = value.slice(folder.length).split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
    return IMAGE_NAME.test(value) ? value : null;
}

const startsWith = (bytes, magic) => bytes.length >= magic.length && magic.every((byte, i) => bytes[i] === byte);

/**
 * Embeds image `bytes` in `pdfDoc` as the PNG or JPEG its first bytes say it
 * is, whatever its name says; throws when it is neither.
 */
async function embedImageByBytes(pdfDoc, bytes) {
    // A copy: pdf-lib reads a JPEG from offset 0 of its underlying buffer, and a
    // small Buffer from Storage is a slice of a shared one.
    const data = new Uint8Array(bytes);
    if (startsWith(data, PNG_MAGIC)) return pdfDoc.embedPng(data);
    if (startsWith(data, JPEG_MAGIC)) return pdfDoc.embedJpg(data);
    throw new Error('The company signature is not a PNG or JPEG image.');
}

/**
 * The fields as a signer sees them: no field carries a Storage path, and a
 * company signature whose image is this company's carries a short-lived link to
 * it, made by `signUrl(path)`. No other path is ever signed.
 */
async function withCompanySignatureUrls(fields, companyId, signUrl) {
    return Promise.all(fields.map(async (field) => {
        if (!field || typeof field !== 'object') return field;
        const shown = { ...field };
        delete shown.companySignaturePath;
        delete shown.companySignatureUrl;
        const imagePath = isCompanySignatureField(field) ? companySignatureImagePath(companyId, field) : null;
        if (imagePath) shown.companySignatureUrl = await signUrl(imagePath);
        return shown;
    }));
}

module.exports = {
    COMPANY_SIGNATURE_TYPE,
    companySignatureImagePath,
    embedImageByBytes,
    isCompanySignatureField,
    withCompanySignatureUrls,
};
