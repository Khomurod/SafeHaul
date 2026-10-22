/**
 * What the recruiter is told when a sent request's PDF is missing somewhere it
 * should be: `sendVerificationRequest` returns where it stored the PDF
 * (`requestPdfPath`, null when none could be made) and whether it filed it in
 * the DQ file (`requestPdfFiled`; absent from servers that predate filing).
 *
 * @param {{ requestPdfPath?: string | null, requestPdfFiled?: boolean }} reply
 * @returns {string | null}
 */
export function requestPdfWarning(reply) {
    if (!reply?.requestPdfPath) return 'The request went out, but its PDF could not be made, so none was attached or filed.';
    if (reply.requestPdfFiled === false) {
        return 'The request went out with its PDF, but the PDF could not be filed in the DQ file. It opens from the verification history.';
    }
    return null;
}
