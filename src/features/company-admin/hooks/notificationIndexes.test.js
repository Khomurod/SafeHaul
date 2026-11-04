import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The bell's own-reminders read, recorded as Firestore would run it.
 *
 * An equality on `recipientId` with an `orderBy` on `createdAt` needs a
 * composite index. A stubbed query answers without one, and the hook only logs
 * the failure and keeps the team's list, so a missing index would show only as
 * a recruiter's reminders quietly dropping out of a busy bell. Here the query
 * must find its index in `firestore.indexes.json`, so a change to it has to
 * bring its own. The uid is artificial.
 */
const fb = vi.hoisted(() => ({ queries: [] }));

vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'recruiter-1' } } }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...segments) => ({ kind: 'collection', path: segments.join('/') }),
    where: (field, op, value) => ({ kind: 'where', field, op, value }),
    orderBy: (field, direction = 'asc') => ({ kind: 'orderBy', field, direction }),
    limit: (count) => ({ kind: 'limit', count }),
    query: (ref, ...constraints) => ({ kind: 'query', ref, constraints }),
    onSnapshot: (q) => {
        fb.queries.push(q);
        return () => {};
    },
    doc: () => ({}),
    updateDoc: vi.fn(),
    writeBatch: vi.fn(),
}));

import { useCompanyNotifications } from './useCompanyNotifications';

const INDEXES = JSON.parse(readFileSync(resolve(process.cwd(), 'firestore.indexes.json'), 'utf8')).indexes;

const notificationIndexes = () => INDEXES
    .filter((index) => index.collectionGroup === 'notifications' && index.queryScope === 'COLLECTION')
    .map((index) => index.fields.map((field) => `${field.fieldPath} ${field.order}`).join(', '));

describe('the notifications index', () => {
    it('declares the reader\'s own reminders, newest first', () => {
        expect(notificationIndexes()).toContain('recipientId ASCENDING, createdAt DESCENDING');
    });

    it('serves the bell\'s own-reminders read exactly', () => {
        fb.queries = [];
        renderHook(() => useCompanyNotifications('co-1'));

        const own = fb.queries.filter((q) => q.constraints.some((c) => c.kind === 'where'));
        expect(own).toHaveLength(1);
        expect(own[0].ref).toEqual({ kind: 'collection', path: 'companies/co-1/notifications' });
        expect(own[0].constraints).toEqual([
            { kind: 'where', field: 'recipientId', op: '==', value: 'recruiter-1' },
            { kind: 'orderBy', field: 'createdAt', direction: 'desc' },
            { kind: 'limit', count: 20 },
        ]);
        const [filter, order] = own[0].constraints;
        expect(notificationIndexes()).toContain(`${filter.field} ASCENDING, ${order.field} DESCENDING`);
    });
});
