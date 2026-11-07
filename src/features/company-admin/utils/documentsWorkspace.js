/**
 * Documents workspace — pure metric and filter rules.
 *
 * Everything here is derived from data the app already writes: signing-request
 * `status`, the `emailStatus`/`emailError` and `smsStatus`/`smsError` delivery
 * fields, `deliveryMethod`, `createdAt`, `expiresAt`, and template `fields`. No
 * new business rule is invented, and no metric is shown that the stored data
 * cannot support.
 */

import { millisOf as toMillis } from '@shared/utils/millisOf';

const normalize = (value) => (value === null || value === undefined ? '' : String(value));

/** Statuses that mean the signer has finished. */
export const COMPLETED_STATUSES = Object.freeze(['signed', 'sealed', 'completed']);

/**
 * Statuses of a document its signer has not signed yet: `sent`, and the older
 * `opened` the dossier always read (no writer stores it now). A failed send
 * matters only on these (`openDeliveryFailure`).
 */
export const OPEN_STATUSES = Object.freeze(['sent', 'opened']);

/** Statuses counted as awaiting a signature: the open ones, and those being submitted or sealed. */
export const AWAITING_STATUSES = Object.freeze([...OPEN_STATUSES, 'processing', 'pending_seal']);

/**
 * What each stored status is called on screen, in the filter, the history's
 * badge and the details dialog alike. `opened` (older documents) is still
 * awaiting a signature.
 */
export const STATUS_NAMES = Object.freeze({
    sent: 'Awaiting signature',
    opened: 'Awaiting signature',
    processing: 'Processing',
    signed: 'Signed',
    pending_seal: 'Sealing',
    error_sealing: 'Seal failed',
    voided: 'Voided',
});

/**
 * Status filter options. Values are the stored `status` values, unchanged, and
 * `expired`, a document awaiting signature whose link ran out (`isLinkExpired`).
 */
export const STATUS_FILTERS = Object.freeze([
    { value: 'all', label: 'All statuses' },
    { value: 'sent', label: STATUS_NAMES.sent },
    { value: 'expired', label: 'Link expired' },
    { value: 'signed', label: STATUS_NAMES.signed },
    { value: 'pending_seal', label: STATUS_NAMES.pending_seal },
    { value: 'error_sealing', label: STATUS_NAMES.error_sealing },
    { value: 'voided', label: STATUS_NAMES.voided },
]);

/** A stored status's name on screen, or the value as stored when it has none. */
export function statusLabel(status) {
    return Object.hasOwn(STATUS_NAMES, status) ? STATUS_NAMES[status] : status;
}

/**
 * Delivery filter options. The values are the exact stored `deliveryMethod`
 * values — `email`, `sms`, `both`, `copy` — plus the post-application value
 * the backend writes, so nothing already in Firestore becomes unfilterable.
 */
export const DELIVERY_FILTERS = Object.freeze([
    { value: 'all', label: 'All delivery methods' },
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
    { value: 'both', label: 'Email + SMS' },
    { value: 'copy', label: 'Copy link' },
    { value: 'in_app_post_submit', label: 'After application' },
]);

export const DATE_FILTERS = Object.freeze([
    { value: 'all', label: 'Any date' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
]);

export const DEFAULT_FILTERS = Object.freeze({
    search: '',
    status: 'all',
    delivery: 'all',
    date: 'all',
    needsAttention: false,
});

export function isCompleted(document) {
    return COMPLETED_STATUSES.includes(normalize(document?.status).toLowerCase());
}

export function isAwaitingSignature(document) {
    const status = normalize(document?.status).toLowerCase();
    return AWAITING_STATUSES.includes(status) && !hasDeliveryFailure(document);
}

/**
 * The channel whose send failed and the error it recorded, or null, whatever
 * the status: the record of what happened, kept after a document is signed or
 * voided. The server's senders record each channel on the request; a text has
 * no other way to tell its sender it did not go out.
 */
export function deliveryFailure(document) {
    if (document?.emailStatus === 'failed') return { channel: 'Email', error: document.emailError || '' };
    if (document?.smsStatus === 'failed') return { channel: 'SMS', error: document.smsError || '' };
    return null;
}

const isOpen = (document) => OPEN_STATUSES.includes(normalize(document?.status).trim().toLowerCase());

/**
 * A failed send that still matters: the document is open (`OPEN_STATUSES`), so
 * its signer may not have the link. Once it is signed, sealing or voided there
 * is nothing to deliver, and `deliveryFailure` alone tells what happened.
 */
export function openDeliveryFailure(document) {
    return isOpen(document) ? deliveryFailure(document) : null;
}

/** Whether an open document's send failed (`openDeliveryFailure`); the server's filters match it. */
export function hasDeliveryFailure(document) {
    return openDeliveryFailure(document) !== null;
}

/**
 * A text left out on purpose, or null: the server skips an opted-out number
 * when the email goes too (`smsStatus: 'skipped'`, the reason in `smsNote`).
 * A note, never a failure.
 */
export function deliveryNote(document) {
    if (document?.smsStatus !== 'skipped') return null;
    return { channel: 'SMS', note: normalize(document.smsNote).trim() || 'SMS not sent.' };
}

/**
 * An open document (`OPEN_STATUSES`) whose link has run out: derived here,
 * never stored, so no server count or index knows it, and the numbers count it
 * as awaiting a signature (`signingRequestQueries.js`). The dossier's list
 * reads it too.
 */
export function isLinkExpired(document, now = Date.now()) {
    if (!isOpen(document)) return false;
    const expires = toMillis(document?.expiresAt);
    return expires !== null && expires < now;
}

export function hasSealingFailure(document) {
    return normalize(document?.status).toLowerCase() === 'error_sealing';
}

/**
 * "Needs attention" is deliberately narrow: something went wrong that a person
 * has to act on, a failed send while the document is open or a failed seal. A
 * document simply waiting for a signature is not a problem, and one signed or
 * voided leaves by itself.
 */
export function needsAttention(document) {
    return hasDeliveryFailure(document) || hasSealingFailure(document);
}

/** Metrics for the Overview view. All counts, no estimates. */
export function summarizeDocuments(documents = []) {
    const summary = {
        total: documents.length,
        awaitingSignature: 0,
        completed: 0,
        deliveryFailures: 0,
        sealingFailures: 0,
        voided: 0,
        needsAttention: 0,
    };

    for (const document of documents) {
        if (isAwaitingSignature(document)) summary.awaitingSignature += 1;
        if (isCompleted(document)) summary.completed += 1;
        if (hasDeliveryFailure(document)) summary.deliveryFailures += 1;
        if (hasSealingFailure(document)) summary.sealingFailures += 1;
        if (normalize(document.status).toLowerCase() === 'voided') summary.voided += 1;
        if (needsAttention(document)) summary.needsAttention += 1;
    }

    return summary;
}

export function attentionDocuments(documents = [], limit = 5) {
    return documents.filter(needsAttention).slice(0, limit);
}

const withinDateWindow = (document, dateFilter, now) => {
    if (dateFilter === 'all') return true;
    const created = toMillis(document?.createdAt);
    // A document with no usable timestamp is kept: hiding real records because
    // of a missing field would silently shrink the list.
    if (created === null) return true;
    const days = { '7d': 7, '30d': 30, '90d': 90 }[dateFilter];
    if (!days) return true;
    return created >= now - days * 24 * 60 * 60 * 1000;
};

/** True when the stored dataset can support the date filter at all. */
export function supportsDateFilter(documents = []) {
    return documents.some((document) => toMillis(document?.createdAt) !== null);
}

export function filterDocuments(documents = [], filters = DEFAULT_FILTERS, now = Date.now()) {
    const search = normalize(filters.search).trim().toLowerCase();

    return documents.filter((document) => {
        if (filters.needsAttention && !needsAttention(document)) return false;

        if (filters.status === 'expired') {
            if (!isLinkExpired(document, now)) return false;
        } else if (filters.status && filters.status !== 'all') {
            if (normalize(document.status).toLowerCase() !== filters.status) return false;
        }

        if (filters.delivery && filters.delivery !== 'all') {
            if (normalize(document.deliveryMethod) !== filters.delivery) return false;
        }

        if (!withinDateWindow(document, filters.date || 'all', now)) return false;

        if (search) {
            const haystack = [
                document.title,
                document.recipientName,
                document.recipientEmail,
                document.recipientPhone,
            ]
                .map(normalize)
                .join(' ')
                .toLowerCase();
            if (!haystack.includes(search)) return false;
        }

        return true;
    });
}

/**
 * The Sent Documents heading count. While the active list (all documents, or
 * those that need attention) is fully loaded, or a search or filter narrows it,
 * it counts the loaded rows that match; otherwise the server total, and
 * `undefined` (no count shown) while that total is unknown or the attention
 * list is loading or failed. A missing `list` or `attention` means complete.
 */
export function sentHeaderCount({ filters = DEFAULT_FILTERS, documents = [], list, attention, summary }) {
    const useAttention = Boolean(filters.needsAttention);
    if (useAttention && (attention?.isLoading || attention?.error)) return undefined;
    const source = useAttention && attention ? attention.documents : documents;
    const complete = useAttention ? (attention?.complete ?? true) : (list?.complete ?? true);
    const narrowed = normalize(filters.search).trim() !== ''
        || ['status', 'delivery', 'date'].some((key) => (filters[key] || 'all') !== 'all');
    if (complete || narrowed) return filterDocuments(source, filters).length;
    return (useAttention ? summary?.needsAttention : summary?.total) ?? undefined;
}

export function isDefaultFilters(filters = DEFAULT_FILTERS) {
    return (
        normalize(filters.search).trim() === '' &&
        (filters.status || 'all') === 'all' &&
        (filters.delivery || 'all') === 'all' &&
        (filters.date || 'all') === 'all' &&
        !filters.needsAttention
    );
}

/** Template library sorting. Only fields templates actually carry. */
export const TEMPLATE_SORTS = Object.freeze([
    { value: 'updated', label: 'Recently updated' },
    { value: 'title', label: 'Title (A–Z)' },
    { value: 'fields', label: 'Most fields' },
]);

export function sortTemplates(templates = [], sort = 'updated') {
    const copy = [...templates];
    if (sort === 'title') {
        return copy.sort((a, b) =>
            normalize(a.title).localeCompare(normalize(b.title), undefined, { sensitivity: 'base' }),
        );
    }
    if (sort === 'fields') {
        return copy.sort((a, b) => (b.fields?.length || 0) - (a.fields?.length || 0));
    }
    // `updated` preserves the query's `updatedAt desc` ordering, with templates
    // that have no timestamp sinking to the end rather than jumping to the top.
    return copy.sort((a, b) => (toMillis(b.updatedAt) ?? -Infinity) - (toMillis(a.updatedAt) ?? -Infinity));
}

export function searchTemplates(templates = [], search = '') {
    const needle = normalize(search).trim().toLowerCase();
    if (!needle) return templates;
    return templates.filter((template) => normalize(template.title).toLowerCase().includes(needle));
}

/**
 * A template may only be duplicated when its schema is safe to copy: it needs
 * the stored PDF and a field array the serializer can round-trip. Duplicating
 * a template with no `storagePath` would create a template that can never be
 * sent, and duplicating unknown field shapes would persist them unchanged.
 */
export const DUPLICABLE_FIELD_TYPES = Object.freeze(['signature', 'initial', 'date', 'text', 'checkbox', 'company_signature']);

export function isTemplateDuplicable(template) {
    if (!template) return false;
    if (!normalize(template.storagePath).trim()) return false;
    if (!Array.isArray(template.fields) || template.fields.length === 0) return false;
    return template.fields.every(
        (field) => field && DUPLICABLE_FIELD_TYPES.includes(normalize(field.type)),
    );
}

/** Human-readable timestamp, or an em dash when the value is unusable. */
export function formatTimestamp(value) {
    const millis = toMillis(value);
    if (millis === null) return '—';
    return new Date(millis).toLocaleDateString();
}

/** "Oct 23, 2026", the date a request was sent (the history table's Date sent), or null without one. */
export function formatSentDate(createdAt) {
    if (typeof createdAt?.seconds !== 'number') return null;
    return new Date(createdAt.seconds * 1000)
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
