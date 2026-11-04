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

/**
 * How long a `sending` claim holds: after this the server takes it as a crashed
 * attempt and lets the copy be approved again. Keep in step with
 * `CLAIM_LIFETIME_MS` in `functions/signedCopyDelivery.js`.
 */
export const CLAIM_LIFETIME_MS = 10 * 60 * 1000;

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
export function canSendSignedCopy(document, record, now = Date.now()) {
    return document?.status === 'signed'
        && hasCompanySignature(document)
        && fieldsOf(document).some((field) => SIGNER_SIGNATURE_TYPES.has(field?.type))
        && String(document?.recipientEmail || '').trim() !== ''
        && record?.state !== 'sent'
        && (record?.state !== 'sending' || isStaleSendingClaim(record, now));
}

/**
 * A `sending` claim the server would let go: approved ten minutes ago or more,
 * or with no approval time, as `sendSignedDocumentCopy` reads it. The attempt
 * crashed, and it may or may not have reached the driver.
 */
export function isStaleSendingClaim(record, now = Date.now()) {
    if (record?.state !== 'sending') return false;
    const approvedAt = toMillis(record.approvedAt);
    return approvedAt === null || now - approvedAt >= CLAIM_LIFETIME_MS;
}

/** Whether the action reads "Try again": after a failed copy, or one whose send never finished. */
export function isSignedCopyRetry(record, now = Date.now()) {
    return record?.state === 'failed' || isStaleSendingClaim(record, now);
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
export function signedCopyLine(record, now = Date.now()) {
    if (record?.state === 'sent') {
        const date = formatCopyDate(record.sentAt);
        const to = record.sentTo ? ` to ${record.sentTo}` : '';
        return { tone: 'success', text: `Copy sent${to}${date ? ` on ${date}` : ''}` };
    }
    if (isStaleSendingClaim(record, now)) return { tone: 'danger', text: 'Copy may not have been sent' };
    if (record?.state === 'sending') return { tone: 'neutral', text: 'Sending copy…' };
    if (record?.state === 'failed') return { tone: 'danger', text: 'Copy not sent' };
    return null;
}
