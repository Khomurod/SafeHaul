/**
 * The approved signed copy: after the driver signs a document that carries a
 * company signature, an employee reviews it and approves sending; only then
 * does `sendSignedDocumentCopy` email the driver the sealed PDF, once. The
 * server checks everything again and writes what happened on the request as
 * `signedCopy: { state: 'sending' | 'sent' | 'failed', sentTo, sentAt?, … }`.
 *
 * These rules decide only what the Documents workspace offers and says. A
 * document without a company signature has no signed copy at all and is shown
 * exactly as before.
 */
import { isCompanySignatureField } from './companySignature';

const SIGNER_SIGNATURE_TYPES = new Set(['signature', 'initial']);

const fieldsOf = (document) => (Array.isArray(document?.fields) ? document.fields : []);

export function hasCompanySignature(document) {
    return fieldsOf(document).some(isCompanySignatureField);
}

/**
 * What is known about a document's copy. The server's record, except that a
 * send this page saw succeed reads as sent until the live record catches up.
 */
export function signedCopyRecord(document, sentHere) {
    const stored = document?.signedCopy || null;
    if (stored?.state === 'sent' || !sentHere) return stored;
    return sentHere;
}

/**
 * Whether "Send signed copy" is offered: a signed document with a company
 * signature, the driver's signature or initials and an email to send to, and no
 * copy sent or on its way. After a failed copy it is offered again.
 */
export function canSendSignedCopy(document, record) {
    return document?.status === 'signed'
        && hasCompanySignature(document)
        && fieldsOf(document).some((field) => SIGNER_SIGNATURE_TYPES.has(field?.type))
        && String(document?.recipientEmail || '').trim() !== ''
        && !['sending', 'sent'].includes(record?.state);
}

const toMillis = (value) => {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    if (value instanceof Date) return value.getTime();
    const parsed = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
};

/** "Nov 4, 2026", or null without a usable time. */
export function formatCopyDate(value) {
    const millis = toMillis(value);
    if (millis === null) return null;
    return new Date(millis).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The line a row and the details show about the copy, with its tone, or null. */
export function signedCopyLine(record) {
    if (record?.state === 'sent') {
        const date = formatCopyDate(record.sentAt);
        const to = record.sentTo ? ` to ${record.sentTo}` : '';
        return { tone: 'success', text: `Copy sent${to}${date ? ` on ${date}` : ''}` };
    }
    if (record?.state === 'sending') return { tone: 'neutral', text: 'Sending copy…' };
    if (record?.state === 'failed') return { tone: 'danger', text: 'Copy not sent' };
    return null;
}
