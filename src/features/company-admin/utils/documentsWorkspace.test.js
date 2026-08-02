// Documents workspace metric and filter rules. Every document, template and
// recipient below is artificial.
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_FILTERS,
    attentionDocuments,
    filterDocuments,
    formatTimestamp,
    hasDeliveryFailure,
    hasSealingFailure,
    isAwaitingSignature,
    isCompleted,
    isDefaultFilters,
    isTemplateDuplicable,
    needsAttention,
    recentDocuments,
    searchTemplates,
    sortTemplates,
    summarizeDocuments,
    supportsDateFilter,
} from './documentsWorkspace';

const secondsAgo = (seconds) => ({ seconds: Math.floor(Date.now() / 1000) - seconds });

const doc = (overrides = {}) => ({
    id: 'req-1',
    title: 'Artificial Form',
    recipientName: 'Artificial Person',
    recipientEmail: 'nobody@example.invalid',
    recipientPhone: '5550000000',
    status: 'sent',
    deliveryMethod: 'email',
    createdAt: secondsAgo(60),
    ...overrides,
});

describe('status predicates', () => {
    it('reads the stored status values, unchanged', () => {
        expect(isAwaitingSignature(doc({ status: 'sent' }))).toBe(true);
        expect(isAwaitingSignature(doc({ status: 'pending_seal' }))).toBe(true);
        expect(isCompleted(doc({ status: 'signed' }))).toBe(true);
        expect(isCompleted(doc({ status: 'sealed' }))).toBe(true);
        expect(isCompleted(doc({ status: 'sent' }))).toBe(false);
    });

    it('does not count a failed delivery as still awaiting a signature', () => {
        expect(isAwaitingSignature(doc({ status: 'sent', emailStatus: 'failed' }))).toBe(false);
    });

    it('recognises the two real failure kinds', () => {
        expect(hasDeliveryFailure(doc({ emailStatus: 'failed' }))).toBe(true);
        expect(hasSealingFailure(doc({ status: 'error_sealing' }))).toBe(true);
        expect(needsAttention(doc({ status: 'sent' }))).toBe(false);
        expect(needsAttention(doc({ status: 'error_sealing' }))).toBe(true);
        expect(needsAttention(doc({ emailStatus: 'failed' }))).toBe(true);
    });
});

describe('summarizeDocuments', () => {
    it('counts only what the stored data supports', () => {
        const summary = summarizeDocuments([
            doc({ id: 'a', status: 'sent' }),
            doc({ id: 'b', status: 'signed' }),
            doc({ id: 'c', status: 'error_sealing' }),
            doc({ id: 'd', status: 'sent', emailStatus: 'failed' }),
            doc({ id: 'e', status: 'voided' }),
        ]);

        expect(summary).toEqual({
            total: 5,
            awaitingSignature: 1,
            completed: 1,
            deliveryFailures: 1,
            sealingFailures: 1,
            voided: 1,
            needsAttention: 2,
        });
    });

    it('returns zeroes for an empty company rather than guessing', () => {
        expect(summarizeDocuments([])).toMatchObject({ total: 0, awaitingSignature: 0, needsAttention: 0 });
    });
});

describe('recent and attention lists', () => {
    it('keeps the query order and caps the list', () => {
        const documents = Array.from({ length: 9 }, (_, index) => doc({ id: `r-${index}` }));
        expect(recentDocuments(documents).map((d) => d.id)).toEqual(['r-0', 'r-1', 'r-2', 'r-3', 'r-4']);
    });

    it('lists only documents that actually failed', () => {
        const documents = [doc({ id: 'ok' }), doc({ id: 'bad', emailStatus: 'failed' })];
        expect(attentionDocuments(documents).map((d) => d.id)).toEqual(['bad']);
    });
});

describe('filterDocuments', () => {
    const documents = [
        doc({ id: 'a', title: 'Offer Letter', recipientName: 'Alex Driver', status: 'sent', deliveryMethod: 'email' }),
        doc({ id: 'b', title: 'Drug Policy', recipientName: 'Blair Hauler', status: 'signed', deliveryMethod: 'sms' }),
        doc({ id: 'c', title: 'W-9', recipientName: 'Casey Freight', status: 'sent', deliveryMethod: 'both', emailStatus: 'failed' }),
        doc({ id: 'd', title: 'Old Form', status: 'voided', deliveryMethod: 'copy', createdAt: secondsAgo(60 * 60 * 24 * 45) }),
    ];

    it('returns everything with the default filters', () => {
        expect(filterDocuments(documents, DEFAULT_FILTERS)).toHaveLength(4);
    });

    it('searches title, recipient name, email and phone', () => {
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, search: 'offer' }).map((d) => d.id)).toEqual(['a']);
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, search: 'blair' }).map((d) => d.id)).toEqual(['b']);
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, search: 'nobody@example' })).toHaveLength(4);
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, search: 'no such thing' })).toEqual([]);
    });

    it('filters by the stored status value', () => {
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, status: 'signed' }).map((d) => d.id)).toEqual(['b']);
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, status: 'voided' }).map((d) => d.id)).toEqual(['d']);
    });

    it('filters by the stored delivery method, including copy', () => {
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, delivery: 'copy' }).map((d) => d.id)).toEqual(['d']);
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, delivery: 'both' }).map((d) => d.id)).toEqual(['c']);
    });

    it('filters by a date window', () => {
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, date: '30d' }).map((d) => d.id)).toEqual(['a', 'b', 'c']);
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, date: '90d' })).toHaveLength(4);
    });

    it('keeps a document with no usable timestamp rather than hiding it', () => {
        const undated = [doc({ id: 'undated', createdAt: null })];
        expect(filterDocuments(undated, { ...DEFAULT_FILTERS, date: '7d' })).toHaveLength(1);
    });

    it('narrows to the real failures with the needs-attention filter', () => {
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, needsAttention: true }).map((d) => d.id)).toEqual(['c']);
    });

    it('combines filters', () => {
        expect(
            filterDocuments(documents, { ...DEFAULT_FILTERS, status: 'sent', delivery: 'email' }).map((d) => d.id),
        ).toEqual(['a']);
    });

    it('knows whether the date filter can be offered at all', () => {
        expect(supportsDateFilter(documents)).toBe(true);
        expect(supportsDateFilter([doc({ createdAt: null })])).toBe(false);
        expect(supportsDateFilter([])).toBe(false);
    });

    it('reports whether any filter is active', () => {
        expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
        expect(isDefaultFilters({ ...DEFAULT_FILTERS, search: 'x' })).toBe(false);
        expect(isDefaultFilters({ ...DEFAULT_FILTERS, needsAttention: true })).toBe(false);
    });
});

describe('template library helpers', () => {
    const template = (overrides = {}) => ({
        id: 't1',
        title: 'Artificial Template',
        storagePath: 'secure_documents/co/templates/1.pdf',
        fields: [{ type: 'signature' }, { type: 'text' }],
        updatedAt: secondsAgo(60),
        ...overrides,
    });

    it('searches by title only', () => {
        const templates = [template({ id: 'a', title: 'Offer Letter' }), template({ id: 'b', title: 'W-9' })];
        expect(searchTemplates(templates, 'offer').map((t) => t.id)).toEqual(['a']);
        expect(searchTemplates(templates, '')).toBe(templates);
    });

    it('sorts by title, field count and recency', () => {
        const templates = [
            template({ id: 'a', title: 'Zeta', fields: [{ type: 'text' }], updatedAt: secondsAgo(500) }),
            template({ id: 'b', title: 'Alpha', fields: [{ type: 'text' }, { type: 'date' }, { type: 'signature' }], updatedAt: secondsAgo(10) }),
        ];
        expect(sortTemplates(templates, 'title').map((t) => t.id)).toEqual(['b', 'a']);
        expect(sortTemplates(templates, 'fields').map((t) => t.id)).toEqual(['b', 'a']);
        expect(sortTemplates(templates, 'updated').map((t) => t.id)).toEqual(['b', 'a']);
    });

    it('sinks templates with no updatedAt to the end instead of the top', () => {
        const templates = [template({ id: 'undated', updatedAt: null }), template({ id: 'dated' })];
        expect(sortTemplates(templates, 'updated').map((t) => t.id)).toEqual(['dated', 'undated']);
    });

    it('only allows duplication when the schema is safe to copy', () => {
        expect(isTemplateDuplicable(template())).toBe(true);
        expect(isTemplateDuplicable(template({ storagePath: '' }))).toBe(false);
        expect(isTemplateDuplicable(template({ fields: [] }))).toBe(false);
        expect(isTemplateDuplicable(template({ fields: [{ type: 'radio_group' }] }))).toBe(false);
        expect(isTemplateDuplicable(template({ fields: [null] }))).toBe(false);
        expect(isTemplateDuplicable(null)).toBe(false);
    });
});

describe('formatTimestamp', () => {
    it('formats Firestore timestamps and falls back for unusable values', () => {
        expect(formatTimestamp({ seconds: 0 })).not.toBe('—');
        expect(formatTimestamp(null)).toBe('—');
        expect(formatTimestamp(undefined)).toBe('—');
        expect(formatTimestamp({})).toBe('—');
    });
});
