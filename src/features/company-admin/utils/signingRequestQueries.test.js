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
import { AWAITING_STATUSES, COMPLETED_STATUSES } from './documentsWorkspace';

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

const where = (field, op, value) => ({ kind: 'where', field, op, value });

describe('signing request filters', () => {
    it('match a failed send on either channel', () => {
        expect(deliveryFailedFilter()).toEqual({
            kind: 'or',
            filters: [where('emailStatus', '==', 'failed'), where('smsStatus', '==', 'failed')],
        });
    });

    it('match what needs attention: a failed send or a failed seal', () => {
        expect(needsAttentionFilter()).toEqual({
            kind: 'or',
            filters: [
                where('emailStatus', '==', 'failed'),
                where('smsStatus', '==', 'failed'),
                where('status', '==', 'error_sealing'),
            ],
        });
    });

    it('take the awaiting and completed statuses from the browser rules', () => {
        expect(awaitingFilter()).toEqual(where('status', 'in', [...AWAITING_STATUSES]));
        expect(completedFilter()).toEqual(where('status', 'in', [...COMPLETED_STATUSES]));
    });

    it('count an awaiting document whose send failed apart', () => {
        expect(awaitingFailedFilter()).toEqual({ kind: 'and', filters: [awaitingFilter(), deliveryFailedFilter()] });
    });

    it('stay within Firestore’s 30 disjunctions', () => {
        expect(normalFormSize(needsAttentionFilter())).toBe(3);
        expect(normalFormSize(awaitingFailedFilter())).toBe(6);
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
