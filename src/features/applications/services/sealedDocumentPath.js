/**
 * A sealed e-document the server filed in a DQ file (`functions/sealedDocumentDq.js`):
 * `secure_documents/{companyId}/completed/{requestId}_signed.pdf`, the one PDF the
 * seal wrote. `getSignedDocumentUrl` signs it, for the company's team only.
 */
export function isSealedDocumentPath(path) {
    return typeof path === 'string' && /^secure_documents\/[^/]+\/completed\/[^/]+_signed\.pdf$/.test(path);
}
