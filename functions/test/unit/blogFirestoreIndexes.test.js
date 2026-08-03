/**
 * The blog index guard.
 *
 * ## Why this test exists
 *
 * Every public News & Insights route returned HTTP 500 on first deployment. The
 * cause was not the code: `listPublished` combines an equality filter on
 * `status` with `orderBy('publicationDate')`, and Firestore rejects that
 * composite shape unless a matching index is declared — *even against an empty
 * collection*. Nothing in the unit suite caught it, because the tests stub the
 * Firestore client and a stub answers any query. Nothing in the emulator suite
 * caught it either: the emulator creates composite indexes on demand and never
 * raises `FAILED_PRECONDITION`. So the first place the defect could surface was
 * production.
 *
 * This test closes that gap statically. It reads the real query chains out of
 * `functions/blog/store.js`, works out which of them Firestore would require a
 * composite index for, and asserts each one is declared in
 * `firestore.indexes.json`. A new query with a new filter/order combination
 * fails here rather than in production.
 *
 * ## What "requires a composite index" means here
 *
 * Firestore's single-field indexes cover a query when it uses at most one
 * field. A composite index is required when a query touches two or more
 * distinct fields across its equality filters and its ordering. The one
 * exception this test encodes: a range filter and an `orderBy` on the *same*
 * field need no composite index, which is why `recentForDeduplication`
 * (`publicationDate >=` ordered by `publicationDate`) is correctly absent from
 * `firestore.indexes.json`.
 *
 * Firestore can sometimes satisfy an equality-only multi-field query by merging
 * single-field indexes, so `slug == && status ==` might work undeclared. This
 * test still requires it to be declared: an article page that depends on a
 * query-planner optimisation rather than a declared index is one planner change
 * away from a 404 storm.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const STORE_PATH = path.join(REPO_ROOT, 'functions/blog/store.js');
const INDEXES_PATH = path.join(REPO_ROOT, 'firestore.indexes.json');

const { COLLECTION } = require('../../blog/store');

const storeSource = fs.readFileSync(STORE_PATH, 'utf8');
const indexesFile = JSON.parse(fs.readFileSync(INDEXES_PATH, 'utf8'));

const EQUALITY_OPERATORS = new Set(['==', 'in', 'array-contains', 'array-contains-any']);

/**
 * Extracts every Firestore query chain in the store.
 *
 * A chain starts at `collection()` and ends at `.get()`. Reading the source
 * rather than instrumenting a fake client is deliberate: a fake would only see
 * the chains the tests happen to exercise, and the whole point is to catch the
 * one nobody exercised.
 *
 * @returns {Array<{ name: string, wheres: Array<{field: string, op: string}>,
 *                   orderBys: Array<{field: string, direction: string}> }>}
 */
function extractQueryChains(source) {
    const chains = [];
    const startPattern = /collection\(\)\s*\n/g;

    let match = startPattern.exec(source);
    while (match !== null) {
        const start = match.index;
        const end = source.indexOf('.get()', start);
        if (end !== -1) {
            const chain = source.slice(start, end);
            // A chain that runs past a statement boundary is not one chain.
            if (!/;/.test(chain)) {
                chains.push({
                    name: enclosingFunctionName(source, start),
                    wheres: [...chain.matchAll(/\.where\(\s*'([^']+)'\s*,\s*'([^']+)'/g)]
                        .map(([, field, op]) => ({ field, op })),
                    orderBys: [...chain.matchAll(/\.orderBy\(\s*'([^']+)'(?:\s*,\s*'([^']+)')?/g)]
                        .map(([, field, direction]) => ({
                            field,
                            direction: direction === 'desc' ? 'DESCENDING' : 'ASCENDING',
                        })),
                });
            }
        }
        match = startPattern.exec(source);
    }

    return chains;
}

/** The name of the function a source offset sits inside, for failure messages. */
function enclosingFunctionName(source, offset) {
    const before = source.slice(0, offset);
    const declarations = [...before.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)];
    return declarations.length ? declarations[declarations.length - 1][1] : '<unknown>';
}

/**
 * The composite index a chain needs, or null when single-field indexes cover it.
 *
 * @returns {Array<{fieldPath: string, order: string}>|null}
 */
function requiredIndexFields(chain) {
    const equalityFields = chain.wheres
        .filter((where) => EQUALITY_OPERATORS.has(where.op))
        .map((where) => where.field);
    const rangeFields = chain.wheres
        .filter((where) => !EQUALITY_OPERATORS.has(where.op))
        .map((where) => where.field);
    const orderFields = chain.orderBys.map((orderBy) => orderBy.field);

    const distinct = new Set([...equalityFields, ...rangeFields, ...orderFields]);
    if (distinct.size < 2) return null;

    // Firestore orders composite index fields equality-first, then the ordering
    // fields in their query order. Equality fields are always ASCENDING.
    const fields = equalityFields.map((fieldPath) => ({ fieldPath, order: 'ASCENDING' }));
    for (const orderBy of chain.orderBys) {
        if (equalityFields.includes(orderBy.field)) continue;
        fields.push({ fieldPath: orderBy.field, order: orderBy.direction });
    }
    for (const field of rangeFields) {
        if (fields.some((existing) => existing.fieldPath === field)) continue;
        fields.push({ fieldPath: field, order: 'ASCENDING' });
    }
    return fields;
}

function declaredIndexes() {
    return (indexesFile.indexes || []).filter(
        (index) => index.collectionGroup === COLLECTION,
    );
}

/** Order matters in a Firestore composite index, so this compares in order. */
function indexCovers(index, requiredFields) {
    const actual = index.fields || [];
    if (actual.length !== requiredFields.length) return false;
    return requiredFields.every((required, position) => (
        actual[position].fieldPath === required.fieldPath
        && actual[position].order === required.order
    ));
}

const chains = extractQueryChains(storeSource);

describe('blog store — Firestore query extraction', () => {
    it('finds the query chains, so the guard below is not vacuous', () => {
        // If the store is refactored into a shape this parser cannot read, the
        // guard would silently pass while covering nothing. Pin the count.
        expect(chains.length).toBeGreaterThanOrEqual(4);
        expect(chains.map((chain) => chain.name)).toEqual(
            expect.arrayContaining([
                'listPublished',
                'findPublishedBySlug',
                'listForAdmin',
                'recentForDeduplication',
                'listPublishedSlugs',
            ]),
        );
    });

    it('reads the filters and ordering off each chain', () => {
        const listPublished = chains.find((chain) => chain.name === 'listPublished');
        expect(listPublished.wheres).toEqual([{ field: 'status', op: '==' }]);
        expect(listPublished.orderBys).toEqual([
            { field: 'publicationDate', direction: 'DESCENDING' },
        ]);
    });
});

describe('blog store — every composite query has a declared index', () => {
    it.each(chains.map((chain) => [chain.name, chain]))(
        '%s',
        (name, chain) => {
            const required = requiredIndexFields(chain);
            if (required === null) return; // single-field indexes cover it

            const covered = declaredIndexes().some((index) => indexCovers(index, required));
            expect(covered).toBe(true);
        },
    );

    it('declares the index that made every public news route return 500', () => {
        // Named explicitly so a future cleanup cannot delete it as unused.
        expect(declaredIndexes()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                collectionGroup: COLLECTION,
                queryScope: 'COLLECTION',
                fields: [
                    { fieldPath: 'status', order: 'ASCENDING' },
                    { fieldPath: 'publicationDate', order: 'DESCENDING' },
                ],
            }),
            expect.objectContaining({
                collectionGroup: COLLECTION,
                queryScope: 'COLLECTION',
                fields: [
                    { fieldPath: 'slug', order: 'ASCENDING' },
                    { fieldPath: 'status', order: 'ASCENDING' },
                ],
            }),
        ]));
    });

    it('does not declare an index for a same-field range and ordering', () => {
        // recentForDeduplication filters and orders on publicationDate alone.
        // Declaring a composite index for that would be dead configuration.
        const dedup = chains.find((chain) => chain.name === 'recentForDeduplication');
        expect(requiredIndexFields(dedup)).toBeNull();
    });

    it('keeps every blog index scoped to the collection, not the group', () => {
        // A COLLECTION_GROUP index here would be wrong: blog_posts is a
        // top-level collection with no subcollection of the same name.
        for (const index of declaredIndexes()) {
            expect(index.queryScope).toBe('COLLECTION');
        }
    });
});

describe('firestore.indexes.json — structure', () => {
    it('is valid JSON with the shape the Firebase CLI expects', () => {
        expect(Array.isArray(indexesFile.indexes)).toBe(true);
        for (const index of indexesFile.indexes) {
            expect(typeof index.collectionGroup).toBe('string');
            expect(Array.isArray(index.fields)).toBe(true);
            expect(index.fields.length).toBeGreaterThan(0);
        }
    });

    it('has no duplicate index definitions', () => {
        const fingerprints = indexesFile.indexes.map((index) => JSON.stringify([
            index.collectionGroup,
            index.queryScope,
            index.fields,
        ]));
        expect(new Set(fingerprints).size).toBe(fingerprints.length);
    });
});
