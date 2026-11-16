import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * The documents-that-need-attention listener, read as Firestore would run it.
 *
 * Firestore runs an OR query as its disjunctive normal form, each branch on its
 * own (an `in` is one branch per value): equalities with an `orderBy` on another
 * field need a composite index whose leading fields are those equalities, in
 * any order, then the order. A stubbed query answers without one, so a missing
 * index would first show on the live site as "Documents that need attention
 * could not be loaded." for every carrier with more than 100 documents. Here
 * each branch must find its index in `firestore.indexes.json`, so a new branch
 * has to bring its own.
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
    .map((index) => index.fields.map((field) => ({ field: field.fieldPath, order: field.order })));

const described = (index) => index.map(({ field, order }) => `${field} ${order}`).join(', ');

/** A filter's branches in disjunctive normal form, each the list of its equalities. */
function branchesOf(filter) {
    if (filter.kind === 'where') {
        if (filter.op === '==') return [[filter]];
        if (filter.op === 'in') return filter.value.map((value) => [{ ...filter, op: '==', value }]);
        throw new Error(`No index rule for ${filter.op}`);
    }
    const inner = filter.filters.map(branchesOf);
    if (filter.kind === 'or') return inner.flat();
    return inner.reduce(
        (product, branches) => product.flatMap((left) => branches.map((right) => [...left, ...right])),
        [[]],
    );
}

/** Whether `index` serves equalities on `fields` ordered by createdAt, newest first. */
const serves = (index, fields) => index.length === fields.length + 1
    && index.slice(0, -1).map(({ field }) => field).sort().join() === [...fields].sort().join()
    && described(index.slice(-1)) === 'createdAt DESCENDING';

describe('the signing_requests indexes', () => {
    it('serve every branch of the needs-attention listener', () => {
        const { constraints } = needsAttentionListQuery({});
        const [filter, order, ...rest] = constraints;
        expect(rest).toEqual([]);
        expect(order).toEqual({ kind: 'orderBy', field: 'createdAt', direction: 'desc' });

        const fieldSets = branchesOf(filter).map((branch) => branch.map(({ field }) => field));
        expect(new Set(fieldSets.map((fields) => [...fields].sort().join()))).toEqual(new Set([
            'emailStatus,status', 'smsStatus,status', 'status',
        ]));
        for (const fields of fieldSets) {
            expect([fields, signingRequestIndexes().some((index) => serves(index, fields))]).toEqual([fields, true]);
        }
    });

    it('keep the indexes of the listener the Production release still runs', () => {
        // Production's screens list a failed send whatever the status until they
        // are promoted: one branch per channel, each ordered by createdAt.
        expect(signingRequestIndexes().map(described)).toEqual(expect.arrayContaining([
            'emailStatus ASCENDING, createdAt DESCENDING',
            'smsStatus ASCENDING, createdAt DESCENDING',
        ]));
    });
});
