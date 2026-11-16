/**
 * A document sent from a template to an applicant or lead the recruiter picked:
 * the record it is filed under and what it fills.
 *
 * It fills only the listed fields (`functions/shared/applicationTokenFields.json`,
 * the one list the server fills a post-application document from too,
 * `APPLICATION_TOKEN_FIELDS` in `functions/shared/postApplicationRequest.js`). A sealed document is read by the whole team, so
 * the SSN, the signature, consents, ids, links and uploads never fill one. The
 * email is the recipient field's, which the recruiter may correct; so are the
 * name and phone (`buildPrefillContext`).
 *
 * The request links its record as `sourceApplicationId` (an application, as a
 * post-application document does) or `sourceLeadId` (a lead), which files the
 * sealed copy in that record's DQ file (`functions/sealedDocumentDq.js`). The
 * link holds only while the recipient is still that record: a recruiter who
 * types another name is sending to someone else.
 */
import APPLICATION_TOKEN_FIELDS from '../../../../functions/shared/applicationTokenFields.json';

const LINK_FIELDS = Object.freeze({ applications: 'sourceApplicationId', leads: 'sourceLeadId' });
const KINDS = Object.freeze({ applications: 'Applicant', leads: 'Lead' });
/** The recipient's own fields fill these, not the record. */
const RECIPIENT_TOKENS = new Set(['email']);

const scalarText = (value) => (
    typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
);
const sameName = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** "Applicant" or "Lead": how the picker and the review name a record. */
export function recordKind(collectionName) {
    return KINDS[collectionName] || '';
}

/** The tokens a record fills, from the listed fields only. */
export function recordPrefill(record) {
    const source = record && typeof record === 'object' ? record : {};
    const prefill = {};
    for (const [token, field] of Object.entries(APPLICATION_TOKEN_FIELDS)) {
        const value = scalarText(source[field]);
        if (value && !RECIPIENT_TOKENS.has(token)) prefill[token] = value;
    }
    return prefill;
}

/** A picker row as the wizard keeps it, or null for a row that is no applicant or lead. */
export function pickedRecord(record) {
    if (!record?.id || !LINK_FIELDS[record.collectionName]) return null;
    return {
        collectionName: record.collectionName,
        id: record.id,
        name: `${scalarText(record.firstName)} ${scalarText(record.lastName)}`.trim(),
        prefill: recordPrefill(record),
    };
}

/** The picked record while the recipient is still it, else null. */
export function linkedRecordFor(picked, recipientName) {
    return picked && sameName(picked.name) === sameName(recipientName) ? picked : null;
}

/** The signing request's link to its record: `{ sourceApplicationId }`, `{ sourceLeadId }` or nothing. */
export function recordLink(linked) {
    const field = linked && LINK_FIELDS[linked.collectionName];
    return field ? { [field]: linked.id } : {};
}
