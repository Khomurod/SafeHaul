// Documents workspace metric and filter rules. Every document, template and
// recipient below is artificial.
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_FILTERS,
    attentionDocuments,
    filterDocuments,
    formatTimestamp,
    deliveryFailure,
    deliveryNote,
    hasDeliveryFailure,
    hasSealingFailure,
    isAwaitingSignature,
    isCompleted,
    isDefaultFilters,
    isLinkExpired,
    isTemplateDuplicable,
    needsAttention,
    openDeliveryFailure,
    searchTemplates,
    sentHeaderCount,
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

    it('counts a text that failed as a failed delivery too', () => {
        const smsFailed = doc({ status: 'sent', smsStatus: 'failed', smsError: 'line unavailable' });
        expect(hasDeliveryFailure(smsFailed)).toBe(true);
        expect(needsAttention(smsFailed)).toBe(true);
        expect(isAwaitingSignature(smsFailed)).toBe(false);
        expect(deliveryFailure(smsFailed)).toEqual({ channel: 'SMS', error: 'line unavailable' });
        expect(deliveryFailure(doc({ emailStatus: 'failed', emailError: 'SMTP 550', smsStatus: 'failed' })))
            .toEqual({ channel: 'Email', error: 'SMTP 550' });
        expect(deliveryFailure(doc({ status: 'sent', emailStatus: 'sent', smsStatus: 'sent' }))).toBeNull();
    });
});

describe('a failed send counts only while the document is still with its signer', () => {
    it.each(['sent', 'opened'])('a %s document whose send failed needs attention', (status) => {
        const failed = doc({ status, emailStatus: 'failed', emailError: 'SMTP 550' });
        expect(needsAttention(failed)).toBe(true);
        expect(hasDeliveryFailure(failed)).toBe(true);
        expect(openDeliveryFailure(failed)).toEqual({ channel: 'Email', error: 'SMTP 550' });
    });

    it.each(['voided', 'signed', 'sealed', 'completed', 'pending_seal', 'processing'])(
        'a %s document whose send failed does not, and still says what happened',
        (status) => {
            const failed = doc({ status, emailStatus: 'failed', emailError: 'SMTP 550', smsStatus: 'failed' });
            expect(needsAttention(failed)).toBe(false);
            expect(hasDeliveryFailure(failed)).toBe(false);
            expect(openDeliveryFailure(failed)).toBeNull();
            expect(deliveryFailure(failed)).toEqual({ channel: 'Email', error: 'SMTP 550' });
        },
    );

    it('a failed seal needs attention as a seal, whatever its delivery', () => {
        const sealFailed = doc({ status: 'error_sealing', emailStatus: 'failed' });
        expect(needsAttention(sealFailed)).toBe(true);
        expect(hasDeliveryFailure(sealFailed)).toBe(false);
    });

    it('counts a document still sealing as awaiting, whatever its delivery, and an opened one as awaiting', () => {
        expect(isAwaitingSignature(doc({ status: 'pending_seal', smsStatus: 'failed' }))).toBe(true);
        expect(isAwaitingSignature(doc({ status: 'opened' }))).toBe(true);
        expect(isAwaitingSignature(doc({ status: 'opened', smsStatus: 'failed' }))).toBe(false);
    });

    it('leaves a voided or signed document whose send failed out of the counts of failures', () => {
        const summary = summarizeDocuments([
            doc({ id: 'open', status: 'sent', emailStatus: 'failed' }),
            doc({ id: 'void', status: 'voided', emailStatus: 'failed' }),
            doc({ id: 'signed', status: 'signed', smsStatus: 'failed' }),
        ]);
        expect(summary).toMatchObject({ deliveryFailures: 1, needsAttention: 1, voided: 1, completed: 1 });
        expect(attentionDocuments([
            doc({ id: 'void', status: 'voided', emailStatus: 'failed' }),
            doc({ id: 'open', status: 'sent', emailStatus: 'failed' }),
        ]).map((d) => d.id)).toEqual(['open']);
    });
});

describe('a text skipped for an opted-out number', () => {
    const skipped = doc({
        status: 'sent', deliveryMethod: 'both', emailStatus: 'sent',
        smsStatus: 'skipped', smsNote: 'Not texted: this number opted out of texts.',
    });

    it('is no failure, and no reason for attention', () => {
        expect(deliveryFailure(skipped)).toBeNull();
        expect(hasDeliveryFailure(skipped)).toBe(false);
        expect(needsAttention(skipped)).toBe(false);
        expect(isAwaitingSignature(skipped)).toBe(true);
    });

    it('is a note that says why', () => {
        expect(deliveryNote(skipped)).toEqual({ channel: 'SMS', note: 'Not texted: this number opted out of texts.' });
        expect(deliveryNote(doc({ smsStatus: 'skipped' }))).toEqual({ channel: 'SMS', note: 'SMS not sent.' });
        expect(deliveryNote(doc({ smsStatus: 'failed', smsError: 'line unavailable' }))).toBeNull();
        expect(deliveryNote(doc({ smsStatus: 'sent' }))).toBeNull();
    });
});

describe('a link that ran out', () => {
    const NOW = Date.UTC(2026, 10, 4, 12);
    const day = (days) => ({ toMillis: () => NOW + days * 24 * 60 * 60 * 1000 });

    it('is an unsigned document whose expiresAt has passed, derived and never stored', () => {
        expect(isLinkExpired(doc({ status: 'sent', expiresAt: day(-0.01) }), NOW)).toBe(true);
        expect(isLinkExpired(doc({ status: 'sent', expiresAt: { seconds: (NOW - 1000) / 1000 } }), NOW)).toBe(true);
        expect(isLinkExpired(doc({ status: 'sent', expiresAt: day(1) }), NOW)).toBe(false);
        expect(isLinkExpired(doc({ status: 'sent', expiresAt: null }), NOW)).toBe(false);
        expect(isLinkExpired(doc({ status: 'sent' }), NOW)).toBe(false);
    });

    it.each(['signed', 'pending_seal', 'error_sealing', 'voided', 'processing'])('is never a %s document', (status) => {
        expect(isLinkExpired(doc({ status, expiresAt: day(-3) }), NOW)).toBe(false);
    });

    it('is found by the Link expired filter, and stays among those awaiting a signature', () => {
        const documents = [
            doc({ id: 'live', expiresAt: day(2) }),
            doc({ id: 'expired', expiresAt: day(-2) }),
            doc({ id: 'signed', status: 'signed', expiresAt: day(-2) }),
        ];
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, status: 'expired' }, NOW).map((d) => d.id)).toEqual(['expired']);
        expect(filterDocuments(documents, { ...DEFAULT_FILTERS, status: 'sent' }, NOW).map((d) => d.id)).toEqual(['live', 'expired']);
        // The server's counts cannot tell an expired link without an index, so
        // the browser's numbers count it as awaiting too, and the two agree.
        expect(summarizeDocuments(documents)).toMatchObject({ awaitingSignature: 2, needsAttention: 0 });
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

describe('attention list', () => {
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
        // The copy keeps the company signature's image path, as it keeps the PDF's.
        expect(isTemplateDuplicable(template({ fields: [{ type: 'signature' }, { type: 'company_signature' }] }))).toBe(true);
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

describe('sentHeaderCount', () => {
    const loaded = [
        doc({ id: 'a', title: 'Offer Letter' }),
        doc({ id: 'b', title: 'W-9', status: 'signed' }),
        doc({ id: 'c', emailStatus: 'failed' }),
    ];
    const attentionRows = [doc({ id: 'c', emailStatus: 'failed' })];
    const summary = { total: 412, awaitingSignature: 53, completed: 300, needsAttention: 19 };
    const partial = { complete: false };
    const filters = (patch = {}) => ({ ...DEFAULT_FILTERS, ...patch });

    it('counts the loaded rows while every document is loaded', () => {
        expect(sentHeaderCount({ filters: filters(), documents: loaded, list: { complete: true }, summary })).toBe(3);
    });

    it('treats a missing list or attention as complete', () => {
        expect(sentHeaderCount({ filters: filters(), documents: loaded })).toBe(3);
        expect(sentHeaderCount({ filters: filters({ needsAttention: true }), documents: loaded })).toBe(1);
    });

    it('gives the server total while the list is not complete', () => {
        expect(sentHeaderCount({ filters: filters(), documents: loaded, list: partial, summary })).toBe(412);
    });

    it('gives the needs-attention total while that list is not complete', () => {
        const attention = { documents: attentionRows, complete: false, isLoading: false, error: null };
        expect(sentHeaderCount({ filters: filters({ needsAttention: true }), documents: loaded, list: partial, attention, summary })).toBe(19);
        const complete = { ...attention, complete: true };
        expect(sentHeaderCount({ filters: filters({ needsAttention: true }), documents: loaded, list: partial, attention: complete, summary })).toBe(1);
    });

    it('counts the loaded rows that match once a search or filter narrows a partial list', () => {
        expect(sentHeaderCount({ filters: filters({ search: 'w-9' }), documents: loaded, list: partial, summary })).toBe(1);
        expect(sentHeaderCount({ filters: filters({ status: 'signed' }), documents: loaded, list: partial, summary })).toBe(1);
        expect(sentHeaderCount({ filters: filters({ delivery: 'sms' }), documents: loaded, list: partial, summary })).toBe(0);
    });

    it('shows no count while the total is unknown or the attention list is loading or failed', () => {
        expect(sentHeaderCount({ filters: filters(), documents: loaded, list: partial, summary: null })).toBeUndefined();
        const attention = { documents: [], complete: true, total: null };
        expect(sentHeaderCount({ filters: filters({ needsAttention: true }), documents: loaded, attention: { ...attention, isLoading: true } })).toBeUndefined();
        expect(sentHeaderCount({ filters: filters({ needsAttention: true }), documents: loaded, attention: { ...attention, error: 'failed' } })).toBeUndefined();
    });
});
