import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * The documents-that-need-attention listener, read as Firestore would run it.
 *
 * An OR query runs each branch on its own: an equality on one field with an
 * `orderBy` on another needs a composite index per branch. A stubbed query
 * answers without one, so a missing index would first show on the live site as
 * "Documents that need attention could not be loaded." for every carrier with
 * more than 100 documents. Here each branch must find its index in
 * `firestore.indexes.json`, so a new branch has to bring its own.
 */
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...segments) => ({ kind: 'collection', path: segments.join('/') }),
    where: (field, op, value) => ({ kind: 'where', field, op, value }),
    or: (...filters) => ({ kind: 'or', filters }),
    and: (...filters) => ({ kind: 'and', filters }),
    orderBy: (field, direction = 'asc') => ({ kind: 'orderBy', field, direction }),
    query: (ref, ...constraints) => ({ kind: 'query', ref, constraints }),
}));

import { needsAttentionListQuery } from './signingRequestQueries';

const INDEXES = JSON.parse(readFileSync(resolve(process.cwd(), 'firestore.indexes.json'), 'utf8')).indexes;

const signingRequestIndexes = () => INDEXES
    .filter((index) => index.collectionGroup === 'signing_requests' && index.queryScope === 'COLLECTION')
    .map((index) => index.fields.map((field) => `${field.fieldPath} ${field.order}`).join(', '));

describe('the signing_requests indexes', () => {
    it('declare one index per needs-attention branch, newest first', () => {
        expect(signingRequestIndexes()).toEqual(expect.arrayContaining([
            'status ASCENDING, createdAt DESCENDING',
            'emailStatus ASCENDING, createdAt DESCENDING',
            'smsStatus ASCENDING, createdAt DESCENDING',
        ]));
    });

    it('serve every branch of the needs-attention listener', () => {
        const { constraints } = needsAttentionListQuery({});
        const [filter, order, ...rest] = constraints;
        expect(rest).toEqual([]);
        expect(order).toEqual({ kind: 'orderBy', field: 'createdAt', direction: 'desc' });
        expect(filter.kind).toBe('or');

        const branches = filter.filters;
        expect(branches.map((branch) => branch.field).sort()).toEqual(['emailStatus', 'smsStatus', 'status']);
        for (const branch of branches) {
            expect(branch).toMatchObject({ kind: 'where', op: '==' });
            expect(signingRequestIndexes()).toContain(`${branch.field} ASCENDING, createdAt DESCENDING`);
        }
    });
});
