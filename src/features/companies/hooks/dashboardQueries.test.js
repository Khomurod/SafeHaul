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
    or: (...filters) => ({ kind: 'or', filters }),
    and: (...filters) => ({ kind: 'and', filters }),
    orderBy: (field, direction = 'asc') => ({ kind: 'orderBy', field, direction }),
    startAt: (...values) => ({ kind: 'startAt', values }),
    startAfter: (...values) => ({ kind: 'startAfter', values }),
    endAt: (...values) => ({ kind: 'endAt', values }),
    endBefore: (...values) => ({ kind: 'endBefore', values }),
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
const CURSORS = new Set(['startAt', 'startAfter', 'endAt', 'endBefore']);

function passes(record, filter) {
    if (filter.kind === 'and') return filter.filters.every((f) => passes(record, f));
    if (filter.kind === 'or') return filter.filters.some((f) => passes(record, f));
    const value = record[filter.field];
    if (filter.op === '==') return value === filter.value;
    if (filter.op === 'in') return filter.value.includes(value);
    if (filter.op === 'array-contains') return Array.isArray(value) && value.includes(filter.value);
    throw new Error(`no model for ${filter.op}`);
}

function matches(record, constraints) {
    const order = constraints.find((c) => c.kind === 'orderBy');
    return constraints.every((c) => {
        if (c.kind === 'orderBy') return record[c.field] != null;
        if (CURSORS.has(c.kind)) {
            // Along a descending sort, "after" a value means below it.
            const sign = order.direction === 'desc' ? -1 : 1;
            const along = sign * (record[order.field] - c.values[0]);
            if (c.kind === 'startAt') return along >= 0;
            if (c.kind === 'startAfter') return along > 0;
            if (c.kind === 'endAt') return along <= 0;
            return along < 0;
        }
        return passes(record, c);
    });
}

const FILTER_KINDS = new Set(['where', 'and', 'or']);

/**
 * A query's filters in disjunctive normal form, as Firestore runs them: each
 * alternative is the field filters one record must pass, an `or` adding its
 * branches and an `and` combining its parts. `in` stays one filter here, as
 * an index treats it like an equality; `alternatives` counts its values.
 */
function disjuncts(filter) {
    if (filter.kind === 'or') return filter.filters.flatMap(disjuncts);
    if (filter.kind === 'and') {
        return filter.filters.reduce(
            (sofar, part) => sofar.flatMap((left) => disjuncts(part).map((right) => [...left, ...right])),
            [[]],
        );
    }
    return [[filter]];
}

/** The number of disjunctions Firestore counts against its limit of 30. */
function alternatives(constraints) {
    return disjuncts({ kind: 'and', filters: constraints.filter((c) => FILTER_KINDS.has(c.kind)) })
        .reduce((total, conjunction) => total + conjunction
            .reduce((product, c) => product * (c.op === 'in' ? c.value.length : 1), 1), 0);
}

const EQUALITY_OPS = new Set(['==', 'in', 'array-contains']);
const RANGE_OPS = new Set(['<', '<=', '>', '>=']);

/**
 * Whether the declared indexes serve a query, by the rules Firestore applies:
 * filters that are all equalities merge single-field indexes; a sort (or a
 * range, which sorts by its field) with equalities needs, for each filtered
 * field, a composite whose other fields are all filtered by equality and whose
 * last field is the sort field in the sort's direction. Firestore merges those.
 * A query with an `or` is served alternative by alternative, so each must be.
 */
function servable(constraints, collectionGroup) {
    const nonFilters = constraints.filter((c) => !FILTER_KINDS.has(c.kind));
    return disjuncts({ kind: 'and', filters: constraints.filter((c) => FILTER_KINDS.has(c.kind)) })
        .every((conjunction) => servableConjunction([...conjunction, ...nonFilters], collectionGroup));
}

function servableConjunction(constraints, collectionGroup) {
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
                                for (const dateOrder of ['desc', 'asc']) {
                                    const filters = { state, driverType, assignee, myAssignmentsOnly, dob: '', dateFilter };
                                    queries.push({
                                        label: `${activeTab}/${pipelineSegment} ${JSON.stringify({ state, driverType, assignee, myAssignmentsOnly, dateFilter, dateOrder })}`,
                                        collectionGroup: COLLECTION_BY_TAB[activeTab],
                                        constraints: buildDashboardConstraints({ activeTab, pipelineSegment, filters, dateOrder }),
                                    });
                                }
                                // The count of records without createdAt runs the filters alone.
                                queries.push({
                                    label: `${activeTab}/${pipelineSegment} unordered ${JSON.stringify({ state, driverType, assignee, myAssignmentsOnly })}`,
                                    collectionGroup: COLLECTION_BY_TAB[activeTab],
                                    constraints: buildDashboardConstraints({
                                        activeTab, pipelineSegment, ordered: false,
                                        filters: { state, driverType, assignee, myAssignmentsOnly, dob: '', dateFilter },
                                    }),
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

    it.each([
        ['company_leads', 'attempting'],
        ['applications', 'new'],
    ])('stays within the 30 alternatives Firestore allows on %s, with its widest segment and a freight type', (activeTab, pipelineSegment) => {
        const constraints = buildDashboardConstraints({
            activeTab, pipelineSegment, filters: { state: 'District of Columbia', driverType: 'Reefer' },
        });

        expect(alternatives(constraints)).toBeGreaterThan(1);
        expect(alternatives(constraints)).toBeLessThanOrEqual(30);
    });

    it('sets no state constraint when no state is picked', () => {
        const constraints = buildDashboardConstraints({ activeTab: 'applications', pipelineSegment: 'all', filters: { state: '' } });

        expect(constraints.filter((c) => c.field === 'state')).toEqual([]);
    });
});

describe('the Freight type filter', () => {
    // Artificial records. Every writer stores a freight type as one value: the
    // import's Job Type column and the Call Outcome's Freight Type both write
    // text. An application may hold a list instead, a shape its readers allow for.
    const stored = [
        { id: 'one-value', driverType: 'Reefer' },
        { id: 'list', driverType: ['Reefer'] },
        { id: 'longer-list', driverType: ['Dry Van', 'Reefer'] },
        { id: 'other-value', driverType: 'Dry Van' },
        { id: 'other-list', driverType: ['Flatbed'] },
        { id: 'none' },
    ].map((record) => ({ ...record, assignedTo: 'recruiter-1', createdAt: new Date('2026-10-01T15:00:00Z') }));

    it.each(['company_leads', 'my_leads'])('finds a lead by the one value it stores on %s', (activeTab) => {
        const constraints = buildDashboardConstraints({
            activeTab, pipelineSegment: 'all', filters: { driverType: 'Reefer' },
        });

        expect(stored.filter((record) => matches(record, constraints)).map((record) => record.id))
            .toEqual(['one-value']);
    });

    it('finds an application by that value or by a list holding it', () => {
        const constraints = buildDashboardConstraints({
            activeTab: 'applications', pipelineSegment: 'all', filters: { driverType: 'Reefer' },
        });

        expect(stored.filter((record) => matches(record, constraints)).map((record) => record.id))
            .toEqual(['one-value', 'list', 'longer-list']);
    });

    it('sends the application query its filters in one and(), the only form the SDK takes beside an or()', () => {
        const constraints = buildDashboardConstraints({
            activeTab: 'applications', pipelineSegment: 'new', filters: { state: 'Texas', driverType: 'Reefer' },
        });

        expect(constraints.filter((c) => FILTER_KINDS.has(c.kind)).map((c) => c.kind)).toEqual(['and']);
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

    it.each(['applications', 'company_leads', 'my_leads'])('finds the picked day earliest first on %s too', (activeTab) => {
        const constraints = buildDashboardConstraints({
            activeTab, pipelineSegment: 'all', filters: { dateFilter: '2026-10-12' }, dateOrder: 'asc',
        });

        expect(records.filter((record) => matches(record, constraints)).map((record) => record.id))
            .toEqual(['midnight', 'late']);
    });

    it('sets no date constraint for a day that does not exist', () => {
        const constraints = buildDashboardConstraints({
            activeTab: 'applications', pipelineSegment: 'all', filters: { dateFilter: '2026-02-30' },
        });

        expect(constraints).toEqual([{ kind: 'orderBy', field: 'createdAt', direction: 'desc' }]);
    });
});

describe('the order of the lists', () => {
    const everyView = Object.entries(SEGMENTS_BY_TAB)
        .flatMap(([activeTab, segments]) => segments.map((pipelineSegment) => [activeTab, pipelineSegment]));
    const sortsOf = (constraints) => constraints.filter((c) => c.kind === 'orderBy');

    it.each(everyView)('lists %s/%s newest first on the server', (activeTab, pipelineSegment) => {
        const constraints = buildDashboardConstraints({ activeTab, pipelineSegment, filters: {} });

        expect(sortsOf(constraints)).toEqual([{ kind: 'orderBy', field: 'createdAt', direction: 'desc' }]);
    });

    it.each(everyView)('turns %s/%s earliest first on the server', (activeTab, pipelineSegment) => {
        const constraints = buildDashboardConstraints({ activeTab, pipelineSegment, filters: {}, dateOrder: 'asc' });

        expect(sortsOf(constraints)).toEqual([{ kind: 'orderBy', field: 'createdAt', direction: 'asc' }]);
    });

    it('leaves out a record without createdAt, which only the unordered query counts', () => {
        // Artificial records: one dated, one without createdAt.
        const stored = [
            { id: 'dated', createdAt: new Date('2026-10-01T15:00:00Z') },
            { id: 'undated' },
        ];
        const filters = { state: '', dateFilter: '' };
        const ordered = buildDashboardConstraints({ activeTab: 'applications', pipelineSegment: 'all', filters });
        const unordered = buildDashboardConstraints({ activeTab: 'applications', pipelineSegment: 'all', filters, ordered: false });

        expect(stored.filter((record) => matches(record, ordered)).map((record) => record.id)).toEqual(['dated']);
        expect(stored.filter((record) => matches(record, unordered)).map((record) => record.id)).toEqual(['dated', 'undated']);
    });

    it.each([
        ['company_leads', 'attempting'],
        ['applications', 'new'],
    ])('keeps the same filters in the unordered query on %s', (activeTab, pipelineSegment) => {
        const args = {
            activeTab,
            pipelineSegment,
            filters: { state: 'Texas', driverType: 'Reefer', assignee: 'recruiter-2', myAssignmentsOnly: true },
        };
        const filtersOf = (constraints) => constraints.filter((c) => FILTER_KINDS.has(c.kind));

        expect(filtersOf(buildDashboardConstraints({ ...args, ordered: false })))
            .toEqual(filtersOf(buildDashboardConstraints(args)));
        expect(buildDashboardConstraints({ ...args, ordered: false }).every((c) => FILTER_KINDS.has(c.kind))).toBe(true);
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
