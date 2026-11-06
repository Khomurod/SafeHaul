import { describe, expect, it, vi } from 'vitest';

// The filter builders are recorded instead of sent, so each server-side rule
// can be read and compared with the browser's. All values are artificial.
vi.mock('firebase/firestore', () => ({
    where: (field, op, value) => ({ kind: 'where', field, op, value }),
    or: (...filters) => ({ kind: 'or', filters }),
    and: (...filters) => ({ kind: 'and', filters }),
    orderBy: (field, direction = 'asc') => ({ kind: 'orderBy', field, direction }),
    query: (ref, ...constraints) => ({ kind: 'query', ref, constraints }),
}));

import {
    awaitingFailedFilter,
    awaitingFilter,
    completedFilter,
    deliveryFailedFilter,
    needsAttentionFilter,
    needsAttentionListQuery,
} from './signingRequestQueries';
import {
    AWAITING_STATUSES,
    COMPLETED_STATUSES,
    OPEN_STATUSES,
    isAwaitingSignature,
    isCompleted,
    needsAttention,
} from './documentsWorkspace';

/**
 * The number of disjunctions a filter has in disjunctive normal form, as
 * Firestore counts them against its limit of 30: an `in` of n values is n, an
 * OR adds its branches, an AND multiplies them.
 */
function normalFormSize(filter) {
    if (filter.kind === 'where') return filter.op === 'in' ? filter.value.length : 1;
    const sizes = filter.filters.map(normalFormSize);
    return filter.kind === 'or' ? sizes.reduce((a, b) => a + b, 0) : sizes.reduce((a, b) => a * b, 1);
}

/** Whether stored document `data` matches a recorded filter, as Firestore would read it. */
function matches(filter, data) {
    if (filter.kind === 'where') {
        if (filter.op === '==') return data[filter.field] === filter.value;
        if (filter.op === 'in') return filter.value.includes(data[filter.field]);
        throw new Error(`No rule for ${filter.op}`);
    }
    const results = filter.filters.map((inner) => matches(inner, data));
    return filter.kind === 'or' ? results.some(Boolean) : results.every(Boolean);
}

const where = (field, op, value) => ({ kind: 'where', field, op, value });

/** Every stored status with every delivery outcome, including a text skipped for an opted-out number. */
const STATUSES = ['sent', 'opened', 'processing', 'pending_seal', 'signed', 'sealed', 'completed', 'error_sealing', 'voided'];
const DELIVERIES = [
    {},
    { emailStatus: 'sent' },
    { emailStatus: 'failed' },
    { smsStatus: 'failed' },
    { smsStatus: 'skipped' },
    { emailStatus: 'failed', smsStatus: 'failed' },
    { emailStatus: 'sent', smsStatus: 'skipped' },
];
const EVERY_DOCUMENT = STATUSES.flatMap((status) => DELIVERIES.map((delivery) => ({ status, ...delivery })));

describe('signing request filters', () => {
    it('match a failed send on either channel', () => {
        expect(deliveryFailedFilter()).toEqual({
            kind: 'or',
            filters: [where('emailStatus', '==', 'failed'), where('smsStatus', '==', 'failed')],
        });
    });

    it('match what needs attention: a failed send while the signer has the document, or a failed seal', () => {
        expect(awaitingFailedFilter()).toEqual({
            kind: 'and',
            filters: [where('status', 'in', [...OPEN_STATUSES]), deliveryFailedFilter()],
        });
        expect(needsAttentionFilter()).toEqual({
            kind: 'or',
            filters: [awaitingFailedFilter(), where('status', '==', 'error_sealing')],
        });
    });

    it('take the awaiting and completed statuses from the browser rules', () => {
        expect(awaitingFilter()).toEqual(where('status', 'in', [...AWAITING_STATUSES]));
        expect(completedFilter()).toEqual(where('status', 'in', [...COMPLETED_STATUSES]));
        // The open documents are among those awaiting, so the counts subtract them exactly.
        expect(OPEN_STATUSES.every((status) => AWAITING_STATUSES.includes(status))).toBe(true);
    });

    it('agree with the browser on every status and delivery outcome', () => {
        for (const data of EVERY_DOCUMENT) {
            expect([data, matches(needsAttentionFilter(), data)]).toEqual([data, needsAttention(data)]);
            expect([data, matches(awaitingFilter(), data) && !matches(awaitingFailedFilter(), data)])
                .toEqual([data, isAwaitingSignature(data)]);
            expect([data, matches(completedFilter(), data)]).toEqual([data, isCompleted(data)]);
        }
    });

    it('leave a voided or signed document whose send failed out of what needs attention', () => {
        expect(matches(needsAttentionFilter(), { status: 'voided', emailStatus: 'failed' })).toBe(false);
        expect(matches(needsAttentionFilter(), { status: 'signed', smsStatus: 'failed' })).toBe(false);
        expect(matches(needsAttentionFilter(), { status: 'sent', emailStatus: 'failed' })).toBe(true);
        expect(matches(needsAttentionFilter(), { status: 'sent', smsStatus: 'skipped' })).toBe(false);
    });

    it('stay within Firestore’s 30 disjunctions', () => {
        expect(normalFormSize(needsAttentionFilter())).toBe(5);
        expect(normalFormSize(awaitingFailedFilter())).toBe(4);
        for (const filter of [deliveryFailedFilter(), awaitingFilter(), completedFilter()]) {
            expect(normalFormSize(filter)).toBeLessThanOrEqual(30);
        }
    });

    it('never filter on expiresAt: Link expired is the browser\'s, and needs no index', () => {
        const ref = { path: 'companies/co-1/signing_requests' };
        const built = [
            deliveryFailedFilter(), needsAttentionFilter(), awaitingFilter(), awaitingFailedFilter(), completedFilter(),
            needsAttentionListQuery(ref),
        ];
        expect(JSON.stringify(built)).not.toContain('expiresAt');
    });

    it('list what needs attention newest first, without a limit', () => {
        const ref = { path: 'companies/co-1/signing_requests' };
        expect(needsAttentionListQuery(ref)).toEqual({
            kind: 'query',
            ref,
            constraints: [needsAttentionFilter(), { kind: 'orderBy', field: 'createdAt', direction: 'desc' }],
        });
    });
});
