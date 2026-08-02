/**
 * Documents workspace — pure metric and filter rules.
 *
 * Everything here is derived from data the app already writes: signing-request
 * `status`, the `emailStatus`/`emailError` delivery fields, `deliveryMethod`,
 * `createdAt`, and template `fields`. No new business rule is invented, and no
 * metric is shown that the stored data cannot support.
 */

const toMillis = (value) => {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    if (value instanceof Date) return value.getTime();
    return null;
};

const normalize = (value) => (value === null || value === undefined ? '' : String(value));

/** Statuses that mean the signer has finished. */
export const COMPLETED_STATUSES = Object.freeze(['signed', 'sealed', 'completed']);

/** Statuses that mean the document is still with the signer. */
export const AWAITING_STATUSES = Object.freeze(['sent', 'processing', 'pending_seal']);

/** Status filter options. Values are the stored `status` values, unchanged. */
export const STATUS_FILTERS = Object.freeze([
    { value: 'all', label: 'All statuses' },
    { value: 'sent', label: 'Awaiting signature' },
    { value: 'signed', label: 'Signed' },
    { value: 'pending_seal', label: 'Sealing' },
    { value: 'error_sealing', label: 'Seal failed' },
    { value: 'voided', label: 'Voided' },
]);

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
    return AWAITING_STATUSES.includes(status) && document?.emailStatus !== 'failed';
}

export function hasDeliveryFailure(document) {
    return document?.emailStatus === 'failed';
}

export function hasSealingFailure(document) {
    return normalize(document?.status).toLowerCase() === 'error_sealing';
}

/**
 * "Needs attention" is deliberately narrow: something went wrong that a person
 * has to act on. A document simply waiting for a signature is not a problem.
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

/** Most recent documents, already ordered by the live query. */
export function recentDocuments(documents = [], limit = 5) {
    return documents.slice(0, limit);
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

        if (filters.status && filters.status !== 'all') {
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
export const DUPLICABLE_FIELD_TYPES = Object.freeze(['signature', 'initial', 'date', 'text', 'checkbox']);

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
