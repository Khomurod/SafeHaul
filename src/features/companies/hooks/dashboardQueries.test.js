import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The candidate lists' Firestore queries, read as Firestore would run them.
 *
 * `where` and `orderBy` are recorded instead of sent, so a test can check two
 * things a stubbed query never shows. First, which stored records a filter
 * matches. Second, that `firestore.indexes.json` declares an index for every
 * query the lists can make: a missing one is invisible until a recruiter sets
 * that filter on the live site and the list answers "Missing Index".
 */
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    query: vi.fn(),
    limit: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    doc: vi.fn(),
    getCountFromServer: vi.fn(),
    documentId: vi.fn(),
    where: (field, op, value) => ({ kind: 'where', field, op, value }),
    orderBy: (field, direction = 'asc') => ({ kind: 'orderBy', field, direction }),
    startAfter: (...values) => ({ kind: 'startAfter', values }),
    endAt: (...values) => ({ kind: 'endAt', values }),
}));
vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'recruiter-1' } } }));
vi.mock('@lib/runtime/dashboardRollup', () => ({ shouldPreferDashboardRollup: () => false }));

import { buildDashboardConstraints } from './dashboardQueries';

const INDEXES = JSON.parse(readFileSync(resolve(process.cwd(), 'firestore.indexes.json'), 'utf8')).indexes;

const COLLECTION_BY_TAB = { applications: 'applications', company_leads: 'leads', my_leads: 'leads' };
const SEGMENTS_BY_TAB = {
    applications: ['all', 'new', 'hired', 'terminated', 'declined'],
    company_leads: ['all', 'attempting', 'in_process', 'interested'],
    my_leads: ['all', 'attempting', 'in_process', 'interested'],
};

/**
 * Firestore's answer to "is this record in the query's result?": it passes the
 * filters, has the sorted field (a sort leaves out records without it), and
 * lies between the cursors, which count along the sort's direction.
 */
function matches(record, constraints) {
    const order = constraints.find((c) => c.kind === 'orderBy');
    return constraints.every((c) => {
        if (c.kind === 'orderBy') return record[c.field] != null;
        if (c.kind === 'startAfter' || c.kind === 'endAt') {
            const value = record[order.field];
            const [bound] = c.values;
            const descending = order.direction === 'desc';
            if (c.kind === 'startAfter') return descending ? value < bound : value > bound;
            return descending ? value >= bound : value <= bound;
        }
        const value = record[c.field];
        if (c.op === '==') return value === c.value;
        if (c.op === 'in') return c.value.includes(value);
        if (c.op === 'array-contains') return Array.isArray(value) && value.includes(c.value);
        throw new Error(`no model for ${c.op}`);
    });
}

const EQUALITY_OPS = new Set(['==', 'in', 'array-contains']);
const RANGE_OPS = new Set(['<', '<=', '>', '>=']);

/**
 * Whether the declared indexes serve a query, by the rules Firestore applies:
 * filters that are all equalities merge single-field indexes; a sort (or a
 * range, which sorts by its field) with equalities needs, for each filtered
 * field, a composite whose other fields are all filtered by equality and whose
 * last field is the sort field in the sort's direction. Firestore merges those.
 */
function servable(constraints, collectionGroup) {
    const filters = constraints.filter((c) => c.kind === 'where');
    const order = constraints.find((c) => c.kind === 'orderBy');
    const ranges = filters.filter((c) => RANGE_OPS.has(c.op));
    const equalities = filters.filter((c) => EQUALITY_OPS.has(c.op));
    if (filters.length !== ranges.length + equalities.length) return false;

    const sortField = order?.field ?? ranges[0]?.field;
    if (!sortField) return true;
    if (ranges.some((range) => range.field !== sortField)) return false;
    const direction = order?.direction === 'desc' ? 'DESCENDING' : 'ASCENDING';

    const opByField = new Map(equalities.map((c) => [c.field, c.op]));
    if (opByField.size === 0) return true;

    const fitsFilter = (indexField) => {
        const op = opByField.get(indexField.fieldPath);
        if (!op) return false;
        return op === 'array-contains' ? indexField.arrayConfig === 'CONTAINS' : Boolean(indexField.order);
    };
    const covered = new Set(INDEXES
        .filter((index) => index.collectionGroup === collectionGroup && index.queryScope === 'COLLECTION')
        .filter((index) => {
            const last = index.fields.at(-1);
            return last.fieldPath === sortField && last.order === direction;
        })
        .filter((index) => index.fields.slice(0, -1).every(fitsFilter))
        .flatMap((index) => index.fields.slice(0, -1).map((field) => field.fieldPath)));
    return [...opByField.keys()].every((field) => covered.has(field));
}

/** Every filter combination the toolbar can set, on every tab and segment. */
function everyListQuery() {
    const queries = [];
    for (const activeTab of Object.keys(SEGMENTS_BY_TAB)) {
        for (const pipelineSegment of SEGMENTS_BY_TAB[activeTab]) {
            for (const state of ['', 'Texas']) {
                for (const driverType of ['', 'Reefer']) {
                    for (const assignee of ['', 'recruiter-2', '__unassigned__']) {
                        for (const myAssignmentsOnly of [false, true]) {
                            for (const dateFilter of ['', '2026-10-12']) {
                                const filters = { state, driverType, assignee, myAssignmentsOnly, dob: '', dateFilter };
                                queries.push({
                                    label: `${activeTab}/${pipelineSegment} ${JSON.stringify({ state, driverType, assignee, myAssignmentsOnly, dateFilter })}`,
                                    collectionGroup: COLLECTION_BY_TAB[activeTab],
                                    constraints: buildDashboardConstraints({ activeTab, pipelineSegment, filters }),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    return queries;
}

describe('the State filter', () => {
    // Artificial records. An application holds the picker's full name, one filled
    // in from a licence may hold the postal code, and a lead holds whatever its
    // import file or the quick-add box said. All are assigned to the signed-in
    // recruiter, so My Leads lists them as well.
    const stored = [
        { id: 'picked', state: 'Texas' },
        { id: 'code', state: 'TX' },
        { id: 'typed-lower', state: 'texas' },
        { id: 'typed-code-lower', state: 'tx' },
        { id: 'typed-code-mixed', state: 'Tx' },
        { id: 'other', state: 'Illinois' },
        { id: 'province', state: 'ON' },
        { id: 'none' },
    ].map((record) => ({ ...record, assignedTo: 'recruiter-1', createdAt: new Date('2026-10-01T15:00:00Z') }));

    it.each(['applications', 'company_leads', 'my_leads'])('finds every record of the picked state on %s', (activeTab) => {
        const constraints = buildDashboardConstraints({
            activeTab, pipelineSegment: 'all', filters: { state: 'Texas' },
        });

        expect(stored.filter((record) => matches(record, constraints)).map((record) => record.id))
            .toEqual(['picked', 'code', 'typed-lower', 'typed-code-lower', 'typed-code-mixed']);
    });

    it('finds a Canadian province picked by name, stored by its code', () => {
        const constraints = buildDashboardConstraints({
            activeTab: 'company_leads', pipelineSegment: 'all', filters: { state: 'Ontario' },
        });

        expect(stored.filter((record) => matches(record, constraints)).map((record) => record.id))
            .toEqual(['province']);
    });

    it('stays within the 30 alternatives Firestore allows, with the widest segment', () => {
        const constraints = buildDashboardConstraints({
            activeTab: 'company_leads', pipelineSegment: 'attempting', filters: { state: 'District of Columbia' },
        });
        const alternatives = constraints
            .filter((c) => c.kind === 'where' && c.op === 'in')
            .reduce((product, c) => product * c.value.length, 1);

        expect(alternatives).toBeGreaterThan(1);
        expect(alternatives).toBeLessThanOrEqual(30);
    });

    it('sets no state constraint when no state is picked', () => {
        const constraints = buildDashboardConstraints({ activeTab: 'applications', pipelineSegment: 'all', filters: { state: '' } });

        expect(constraints.filter((c) => c.field === 'state')).toEqual([]);
    });
});

describe('the date filter', () => {
    let zone;

    beforeEach(() => {
        zone = process.env.TZ;
        process.env.TZ = 'America/Chicago';
    });

    afterEach(() => {
        if (zone === undefined) delete process.env.TZ;
        else process.env.TZ = zone;
    });

    // Artificial records around 12 October on a recruiter's clock in Chicago
    // (UTC-5), all assigned to the signed-in recruiter.
    const records = [
        { id: 'evening-before', createdAt: new Date('2026-10-12T04:59:00Z') }, // 11 Oct, 23:59
        { id: 'midnight', createdAt: new Date('2026-10-12T05:00:00Z') }, // 12 Oct, 00:00
        { id: 'late', createdAt: new Date('2026-10-13T04:59:00Z') }, // 12 Oct, 23:59
        { id: 'next-day', createdAt: new Date('2026-10-13T05:00:00Z') }, // 13 Oct, 00:00
        { id: 'no-date' },
    ].map((record) => ({ ...record, assignedTo: 'recruiter-1' }));

    it.each(['applications', 'company_leads', 'my_leads'])('asks the server for the picked day on %s, not a page of it', (activeTab) => {
        const constraints = buildDashboardConstraints({
            activeTab, pipelineSegment: 'all', filters: { dateFilter: '2026-10-12' },
        });

        expect(records.filter((record) => matches(record, constraints)).map((record) => record.id))
            .toEqual(['midnight', 'late']);
    });

    it('sorts the picked day newest first on All Applications, which keeps its order without one', () => {
        const orderOf = (dateFilter) => buildDashboardConstraints({
            activeTab: 'applications', pipelineSegment: 'all', filters: { dateFilter },
        }).filter((c) => c.kind === 'orderBy');

        expect(orderOf('2026-10-12')).toEqual([{ kind: 'orderBy', field: 'createdAt', direction: 'desc' }]);
        expect(orderOf('')).toEqual([]);
    });

    it('sets no date constraint for a day that does not exist', () => {
        const constraints = buildDashboardConstraints({
            activeTab: 'applications', pipelineSegment: 'all', filters: { dateFilter: '2026-02-30' },
        });

        expect(constraints).toEqual([]);
    });
});

describe('the indexes the candidate lists need', () => {
    it('are declared for every tab, segment and filter combination', () => {
        const unserved = everyListQuery()
            .filter(({ constraints, collectionGroup }) => !servable(constraints, collectionGroup))
            .map(({ label }) => label);

        expect(unserved).toEqual([]);
    });

    it('are checked by a model that refuses a query no index serves', () => {
        // The model itself must be able to say no, or the test above proves nothing.
        const constraints = [
            { kind: 'where', field: 'phoneNormalized', op: '==', value: '5125550134' },
            { kind: 'orderBy', field: 'createdAt', direction: 'desc' },
        ];

        expect(servable(constraints, 'leads')).toBe(false);
        expect(servable(constraints.slice(0, 1), 'leads')).toBe(true);
    });
});
