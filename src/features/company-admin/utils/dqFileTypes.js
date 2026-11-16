/**
 * What a DQ file entry is, for the DQ tab and its checklist.
 *
 * `DQ_FILE_TYPES` are the types the tab offers for a team upload, in this
 * order and with none chosen until the team picks one (the server files the
 * application itself); a record keeps the chosen one as its `fileType`. The server files the driver's uploads, the preserved original and
 * the PEV and signing PDFs under a `type` of its own (`functions/shared/dqUploads.js`,
 * `preserveApplicationPdf.js`, `employmentVerification/requestAttachment.js`,
 * `sealedDocumentDq.js`), so an entry is named by that first, then by the type
 * the team chose. An older entry the browser filed is known by its `fileType`
 * alone.
 */

export const DQ_FILE_TYPES = Object.freeze([
    'Application for Employment',
    'Previous Employer Inquiry (3yr)',
    'MVR (Annual)',
    'Medical Card',
    'CDL',
    'Road Test Certificate',
    'PSP Report',
    'Clearinghouse Report (Full)',
    'Clearinghouse Report (Annual)',
    'Certificate of Violations (Annual)',
    'Annual Review',
    'Other',
]);

/** The team-upload types that may carry a valid-until date. */
export const DATED_FILE_TYPES = Object.freeze(['MVR (Annual)', 'Medical Card', 'CDL']);

/** The server's own record types. */
const KIND_BY_TYPE = Object.freeze({
    license_front: 'cdl',
    license_back: 'cdl',
    medical_card: 'medical_card',
    twic_card: 'twic',
    mvr: 'mvr',
    mvr_consent: 'mvr_consent',
    drug_test_consent: 'drug_test_consent',
    ssn_card: 'ssn_card',
    psp_report: 'psp',
    pev_request: 'pev_request',
    pev_result: 'pev_result',
    pev_attempts: 'pev_attempts',
    signed_document: 'signed_document',
});

/** The types the team chooses, and the labels older browser-filed records carry. */
const KIND_BY_FILE_TYPE = Object.freeze({
    'application for employment': 'application',
    'previous employer inquiry (3yr)': 'pev_inquiry',
    'mvr (annual)': 'mvr',
    mvr: 'mvr',
    'medical card': 'medical_card',
    cdl: 'cdl',
    'cdl front': 'cdl',
    'cdl back': 'cdl',
    'twic card': 'twic',
    'road test certificate': 'road_test',
    'psp report': 'psp',
    'clearinghouse report (full)': 'clearinghouse_full',
    'clearinghouse report (annual)': 'clearinghouse_annual',
    'certificate of violations (annual)': 'violations_annual',
    'annual review': 'annual_review',
});

/** The kinds whose record may carry a valid-until date. */
const DATED_KINDS = new Set(['cdl', 'medical_card', 'mvr', 'twic']);

/**
 * What a DQ entry is: `'application'`, `'cdl'`, `'medical_card'`, `'mvr'`,
 * `'pev_result'`, … or null for "Other" and anything unknown.
 */
export function dqKindOf(file) {
    if (!file || typeof file !== 'object') return null;
    if (file.source === 'preserved_submission' || file.requiresAuditedAccess) return 'application';
    if (KIND_BY_TYPE[file.type]) return KIND_BY_TYPE[file.type];
    return KIND_BY_FILE_TYPE[String(file.fileType || '').trim().toLowerCase()] || null;
}

/** Whether a DQ entry may carry a valid-until date (a CDL, medical card, MVR or TWIC card). */
export function takesExpiration(file) {
    return DATED_KINDS.has(dqKindOf(file));
}
