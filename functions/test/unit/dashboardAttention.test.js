/**
 * getDashboardAttention: the dashboard's "Needs attention" counts, for one
 * company's team.
 *
 * The callable runs against a small in-memory Firestore that evaluates the
 * filters, order and limit of each query, so a test states records and reads
 * the answer; every query is also recorded, so the suite can check that each
 * is scoped to the caller's company and served by an index that exists in
 * `firestore.indexes.json`. All names and ids are artificial.
 */
const fs = require('fs');
const path = require('path');

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn),
    HttpsError: class HttpsError extends Error {
        constructor(code, message, details) {
            super(message);
            this.code = code;
            this.details = details;
        }
    },
}));

// Records by path; a query is recorded as it runs.
const mockDocs = new Map();
const mockQueries = [];
const mockState = { failWhen: null };

function mockComparable(value) {
    if (value instanceof Date) return { type: 'time', v: value.getTime() };
    if (typeof value === 'string') return { type: 'string', v: value };
    if (typeof value === 'number') return { type: 'number', v: value };
    if (typeof value === 'boolean') return { type: 'boolean', v: value };
    return null;
}
function mockMatches(data, { field, op, value }) {
    if (!(field in data)) return false;
    if (op === '==') return data[field] === value;
    if (op === 'in') return value.includes(data[field]);
    const a = mockComparable(data[field]);
    const b = mockComparable(value);
    // A range matches values of its own type only, as Firestore's does.
    if (!a || !b || a.type !== b.type) return false;
    if (op === '<') return a.v < b.v;
    if (op === '<=') return a.v <= b.v;
    if (op === '>') return a.v > b.v;
    if (op === '>=') return a.v >= b.v;
    throw new Error(`Unsupported operator ${op}`);
}
function mockRun(q) {
    if (mockState.failWhen && mockState.failWhen(q)) {
        throw Object.assign(new Error('Index details and other internals.'), { code: 9 });
    }
    const prefix = `${q.path}/`;
    let rows = [...mockDocs.entries()]
        .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map(([key, data]) => ({ id: key.slice(prefix.length), data }))
        .filter(({ data }) => q.filters.every((filter) => mockMatches(data, filter)));
    for (const { field, dir } of [...q.orderBy].reverse()) {
        rows = rows.sort((x, y) => {
            const a = mockComparable(x.data[field])?.v;
            const b = mockComparable(y.data[field])?.v;
            const order = a < b ? -1 : a > b ? 1 : 0;
            return dir === 'desc' ? -order : order;
        });
    }
    return q.limit === null ? rows : rows.slice(0, q.limit);
}
function mockQuery(collectionPath, state = { filters: [], orderBy: [], limit: null, select: null }) {
    const next = (change) => mockQuery(collectionPath, { ...state, ...change });
    const record = (kind) => {
        const q = { kind, path: collectionPath, ...state };
        mockQueries.push(q);
        return q;
    };
    return {
        where: (field, op, value) => next({ filters: [...state.filters, { field, op, value }] }),
        orderBy: (field, dir = 'asc') => next({ orderBy: [...state.orderBy, { field, dir }] }),
        limit: (limit) => next({ limit }),
        select: (...fields) => next({ select: fields }),
        count: () => ({
            get: async () => {
                const rows = mockRun(record('count'));
                return { data: () => ({ count: rows.length }) };
            },
        }),
        get: async () => {
            const rows = mockRun(record('get'));
            return {
                size: rows.length,
                empty: rows.length === 0,
                docs: rows.map(({ id, data }) => ({ id, data: () => structuredClone(data) })),
            };
        },
        doc: (id) => mockDocRef(`${collectionPath}/${id}`),
    };
}
function mockDocRef(docPath) {
    return {
        id: docPath.split('/').pop(),
        collection: (name) => mockQuery(`${docPath}/${name}`),
        get: async () => {
            mockQueries.push({ kind: 'doc', path: docPath });
            if (mockState.failWhen && mockState.failWhen({ kind: 'doc', path: docPath })) throw new Error('unavailable');
            const data = mockDocs.get(docPath);
            return { exists: data !== undefined, data: () => (data === undefined ? undefined : structuredClone(data)) };
        },
    };
}
jest.mock('../../firebaseAdmin', () => ({
    admin: {},
    db: { collection: (name) => mockQuery(name) },
}));
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAccessForRequest: jest.fn() }));

const { getDashboardAttention } = require('../../dashboardAttention');
const { assertCompanyAccessForRequest } = require('../../shared/companyAccess');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-04T15:00:00Z');
const daysAgo = (days) => new Date(NOW - days * DAY);
const day = (offset) => new Date(NOW + offset * DAY).toISOString().slice(0, 10);
const call = (data = { companyId: 'co-1' }, auth = { uid: 'uid-recruiter' }) => getDashboardAttention({ data, auth });

function put(docPath, data) {
    mockDocs.set(docPath, data);
}

beforeEach(() => {
    jest.resetAllMocks();
    assertCompanyAccessForRequest.mockImplementation(async () => {});
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    mockDocs.clear();
    mockQueries.length = 0;
    mockState.failWhen = null;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('who may ask', () => {
    it('refuses a caller who is not signed in, and reads nothing', async () => {
        await expect(getDashboardAttention({ data: { companyId: 'co-1' } })).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockQueries).toEqual([]);
    });

    it.each([[undefined], [''], ['co/1'], ['x'.repeat(101)], [42]])('refuses the company id %p', async (companyId) => {
        await expect(call({ companyId })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockQueries).toEqual([]);
    });

    it('asks the company access check for that company, and reads nothing when it refuses', async () => {
        assertCompanyAccessForRequest.mockImplementation(async () => {
            throw Object.assign(new Error('You do not have access to this company.'), { code: 'permission-denied' });
        });

        await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
        expect(assertCompanyAccessForRequest).toHaveBeenCalledWith(expect.objectContaining({ auth: { uid: 'uid-recruiter' } }), 'co-1', 'getDashboardAttention');
        expect(mockQueries).toEqual([]);
    });
});

describe('the counts', () => {
    it('is zero for every row of a company with nothing to look at', async () => {
        const { rows } = await call();

        expect(rows).toEqual({
            sealFailed: { status: 'ok', count: 0 },
            awaitingSignature: { status: 'ok', count: 0 },
            pevWaiting: { status: 'ok', count: 0 },
            pevNoResponse: { status: 'ok', count: 0 },
            pendingChanges: { status: 'ok', count: 0 },
            draftsExpiring: { status: 'ok', count: 0 },
            dqExpiring: { status: 'ok', count: 0, drivers: [] },
        });
    });

    it('counts the documents whose seal failed, and those unsigned for more than seven days', async () => {
        const requests = 'companies/co-1/signing_requests';
        put(`${requests}/r1`, { status: 'error_sealing', createdAt: daysAgo(1) });
        put(`${requests}/r2`, { status: 'error_sealing', createdAt: daysAgo(20) });
        put(`${requests}/r3`, { status: 'sent', createdAt: daysAgo(8) });
        put(`${requests}/r4`, { status: 'opened', createdAt: daysAgo(30) });
        put(`${requests}/r5`, { status: 'sent', createdAt: daysAgo(6) });
        put(`${requests}/r6`, { status: 'signed', createdAt: daysAgo(10) });
        put(`${requests}/r7`, { status: 'voided', createdAt: daysAgo(10) });
        put(`${requests}/r8`, { status: 'pending_seal', createdAt: daysAgo(10) });
        // Another company's records are never counted.
        put('companies/co-2/signing_requests/x1', { status: 'error_sealing', createdAt: daysAgo(1) });
        put('companies/co-2/signing_requests/x2', { status: 'sent', createdAt: daysAgo(9) });

        const { rows } = await call();

        expect(rows.sealFailed).toEqual({ status: 'ok', count: 2 });
        expect(rows.awaitingSignature).toEqual({ status: 'ok', count: 2 });
    });

    it('counts the PEV requests still waiting for the employer, and those marked no response', async () => {
        put('verification_requests/t1', { companyId: 'co-1', status: 'sent' });
        put('verification_requests/t2', { companyId: 'co-1', status: 'opened' });
        put('verification_requests/t3', { companyId: 'co-1', status: 'reminder_sent' });
        put('verification_requests/t4', { companyId: 'co-1', status: 'no_response' });
        put('verification_requests/t5', { companyId: 'co-1', status: 'completed' });
        put('verification_requests/t6', { companyId: 'co-1', status: 'superseded' });
        put('verification_requests/t7', { companyId: 'co-1', status: 'send_failed' });
        put('verification_requests/t8', { companyId: 'co-2', status: 'sent' });
        put('verification_requests/t9', { companyId: 'co-2', status: 'no_response' });

        const { rows } = await call();

        expect(rows.pevWaiting).toEqual({ status: 'ok', count: 3 });
        expect(rows.pevNoResponse).toEqual({ status: 'ok', count: 1 });
    });

    it('counts the applications and leads whose company changes wait for the driver', async () => {
        put('companies/co-1/applications/a1', { hasPendingCompanyChanges: true });
        put('companies/co-1/applications/a2', { hasPendingCompanyChanges: false });
        put('companies/co-1/applications/a3', {});
        put('companies/co-1/leads/l1', { hasPendingCompanyChanges: true });
        put('companies/co-2/applications/b1', { hasPendingCompanyChanges: true });

        const { rows } = await call();

        expect(rows.pendingChanges).toEqual({ status: 'ok', count: 2 });
    });

    it('counts the unfinished applications removed within five days: last saved 25 days ago or more', async () => {
        const drafts = 'companies/co-1/application_drafts';
        put(`${drafts}/d1`, { updatedAt: daysAgo(26), expiresAt: daysAgo(-4) });
        put(`${drafts}/d2`, { updatedAt: daysAgo(25), expiresAt: daysAgo(-5) });
        // Past its date and not yet deleted by Firestore: due for removal.
        put(`${drafts}/d3`, { updatedAt: daysAgo(31), expiresAt: daysAgo(1) });
        put(`${drafts}/d4`, { updatedAt: daysAgo(24), expiresAt: daysAgo(-6) });
        put(`${drafts}/d5`, { updatedAt: daysAgo(1), expiresAt: daysAgo(-29) });
        put('companies/co-2/application_drafts/e1', { updatedAt: daysAgo(28) });

        const { rows } = await call();

        expect(rows.draftsExpiring).toEqual({ status: 'ok', count: 3 });
    });
});

describe('hired drivers whose DQ documents expire', () => {
    const apps = 'companies/co-1/applications';

    it('counts the hired ones expiring within 30 days or expired, and names the earliest five', async () => {
        put(`${apps}/h1`, { status: 'Hired', firstName: 'Ann', lastName: 'Driver', dqExpiresNext: day(10) });
        put(`${apps}/h2`, { status: 'Approved', firstName: 'Ben', lastName: 'Hauler', dqExpiresNext: day(-40) });
        put(`${apps}/h3`, { status: 'Hired', firstName: 'Cal', lastName: 'Road', dqExpiresNext: day(30) });
        put(`${apps}/h4`, { status: 'Hired', firstName: 'Dee', lastName: 'Lane', dqExpiresNext: day(0) });
        put(`${apps}/h5`, { status: 'Hired', firstName: 'Eve', lastName: 'Mile', dqExpiresNext: day(-2) });
        put(`${apps}/h6`, { status: 'Hired', firstName: 'Fay', lastName: 'Ramp', dqExpiresNext: day(29) });
        // Not hired, too far ahead, without a date, or another company's.
        put(`${apps}/n1`, { status: 'New Application', firstName: 'Gus', dqExpiresNext: day(5) });
        put(`${apps}/n2`, { status: 'Declined', firstName: 'Hal', dqExpiresNext: day(-100) });
        put(`${apps}/n3`, { status: 'Hired', firstName: 'Ivy', dqExpiresNext: day(31) });
        put(`${apps}/n4`, { status: 'Hired', firstName: 'Jo', dqExpiresNext: null });
        put(`${apps}/n5`, { status: 'Hired', firstName: 'Kai' });
        put('companies/co-2/applications/z1', { status: 'Hired', firstName: 'Lee', dqExpiresNext: day(3) });

        const { rows } = await call();

        expect(rows.dqExpiring).toEqual({
            status: 'ok',
            count: 6,
            drivers: [
                { id: 'h2', name: 'Ben Hauler', date: day(-40) },
                { id: 'h5', name: 'Eve Mile', date: day(-2) },
                { id: 'h4', name: 'Dee Lane', date: day(0) },
                { id: 'h1', name: 'Ann Driver', date: day(10) },
                { id: 'h6', name: 'Fay Ramp', date: day(29) },
            ],
        });
    });

    it('names a driver with no name on the record "Unnamed driver"', async () => {
        put(`${apps}/h1`, { status: 'Hired', dqExpiresNext: day(3) });

        const { rows } = await call();

        expect(rows.dqExpiring.drivers).toEqual([{ id: 'h1', name: 'Unnamed driver', date: day(3) }]);
    });

    it('counts every hired one exactly, however many others have earlier dates', async () => {
        // Sixty declined or new applicants whose documents expired long ago come
        // before the hired drivers in date order; they must not crowd them out.
        for (let i = 0; i < 60; i += 1) {
            put(`${apps}/o${i}`, { status: i % 2 ? 'Declined' : 'Offer Sent', dqExpiresNext: day(-200 - i) });
        }
        for (let i = 0; i < 7; i += 1) {
            put(`${apps}/h${i}`, { status: 'Hired', firstName: `Driver${i}`, dqExpiresNext: day(-i) });
        }

        const { rows } = await call();

        expect(rows.dqExpiring.count).toBe(7);
        expect(rows.dqExpiring.drivers.map((driver) => driver.id)).toEqual(['h6', 'h5', 'h4', 'h3', 'h2']);
        const read = mockQueries.find((q) => q.kind === 'get' && q.path === apps);
        expect(read).toMatchObject({ limit: 5, orderBy: [{ field: 'dqExpiresNext', dir: 'asc' }] });
        expect(read.filters).toEqual(expect.arrayContaining([{ field: 'status', op: 'in', value: ['Hired', 'Approved'] }]));
        expect(read.select).toEqual(expect.arrayContaining(['firstName', 'lastName', 'dqExpiresNext']));
    });
});

describe('a count that fails', () => {
    it('is "failed" for its own row only, logged by its name without the message', async () => {
        put('companies/co-1/signing_requests/r1', { status: 'error_sealing', createdAt: daysAgo(1) });
        put('companies/co-1/applications/a1', { hasPendingCompanyChanges: true });
        mockState.failWhen = (q) => q.path === 'companies/co-1/leads' || q.path === 'verification_requests';

        const { rows } = await call();

        expect(rows.pendingChanges).toEqual({ status: 'failed' });
        expect(rows.pevWaiting).toEqual({ status: 'failed' });
        expect(rows.pevNoResponse).toEqual({ status: 'failed' });
        expect(rows.sealFailed).toEqual({ status: 'ok', count: 1 });
        expect(rows.draftsExpiring).toEqual({ status: 'ok', count: 0 });
        const logged = console.warn.mock.calls.map((args) => args.join(' ')).join('\n');
        expect(logged).toMatch(/pendingChanges/);
        expect(logged).not.toMatch(/Index details/);
    });

    it('is "failed" for the DQ row when its read fails', async () => {
        mockState.failWhen = (q) => q.kind === 'get' && q.path === 'companies/co-1/applications';

        const { rows } = await call();

        expect(rows.dqExpiring).toEqual({ status: 'failed' });
        expect(rows.pendingChanges).toEqual({ status: 'ok', count: 0 });
    });
});

describe('a feature the company turned off', () => {
    it('leaves out the document rows where E-Docs is off, and reads no signing request', async () => {
        put('companies/co-1', { features: { eDocs: false } });

        const { rows } = await call();

        expect(rows).not.toHaveProperty('sealFailed');
        expect(rows).not.toHaveProperty('awaitingSignature');
        expect(rows).toHaveProperty('pevWaiting');
        expect(mockQueries.some((q) => q.path.endsWith('/signing_requests'))).toBe(false);
    });

    it('leaves out the PEV rows where PEV is off, and reads no verification request', async () => {
        put('companies/co-1', { features: { pev: false } });

        const { rows } = await call();

        expect(rows).not.toHaveProperty('pevWaiting');
        expect(rows).not.toHaveProperty('pevNoResponse');
        expect(rows).toHaveProperty('sealFailed');
        expect(mockQueries.some((q) => q.path === 'verification_requests')).toBe(false);
    });

    it('counts every row when the company could not be read', async () => {
        mockState.failWhen = (q) => q.kind === 'doc';

        const { rows } = await call();

        expect(Object.keys(rows).sort()).toEqual([
            'awaitingSignature', 'dqExpiring', 'draftsExpiring', 'pendingChanges', 'pevNoResponse', 'pevWaiting', 'sealFailed',
        ]);
    });
});

describe('every query', () => {
    async function everyQuery() {
        await call();
        return mockQueries.filter((q) => q.kind !== 'doc');
    }

    it('reads only the caller\'s company', async () => {
        for (const q of await everyQuery()) {
            if (q.path === 'verification_requests') {
                expect(q.filters).toContainEqual({ field: 'companyId', op: '==', value: 'co-1' });
            } else {
                expect(q.path.startsWith('companies/co-1/')).toBe(true);
            }
        }
    });

    it('is a count, but for one bounded read of applications', async () => {
        const reads = (await everyQuery()).filter((q) => q.kind === 'get');
        expect(reads).toHaveLength(1);
        expect(reads[0].limit).toBeLessThanOrEqual(5);
    });

    it('is served by an index that exists in firestore.indexes.json', async () => {
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'firestore.indexes.json'), 'utf8'));
        const exempt = new Set((config.fieldOverrides || [])
            .filter((override) => Array.isArray(override.indexes) && override.indexes.length === 0)
            .map((override) => `${override.collectionGroup}.${override.fieldPath}`));
        const composites = config.indexes.filter((index) => index.queryScope === 'COLLECTION');

        for (const q of await everyQuery()) {
            const group = q.path.split('/').pop();
            const equality = q.filters.filter((f) => f.op === '==' || f.op === 'in').map((f) => f.field);
            const ranged = [...new Set([
                ...q.filters.filter((f) => !['==', 'in'].includes(f.op)).map((f) => f.field),
                ...q.orderBy.map((o) => o.field),
            ])];
            for (const field of [...equality, ...ranged]) {
                expect(exempt.has(`${group}.${field}`)).toBe(false);
            }
            // One range (and its order) at most; equality alone merges single-field indexes.
            expect(ranged.length).toBeLessThanOrEqual(1);
            if (ranged.length === 0 || equality.length === 0) continue;
            const order = q.orderBy[0]?.dir === 'desc' ? 'DESCENDING' : 'ASCENDING';
            const served = composites.some((index) => index.collectionGroup === group
                && index.fields.length === equality.length + 1
                && equality.every((field) => index.fields.slice(0, -1).some((f) => f.fieldPath === field))
                && index.fields.at(-1).fieldPath === ranged[0]
                && index.fields.at(-1).order === order);
            expect({ query: `${group}: ${equality.join(', ')} + ${ranged[0]}`, served }).toEqual(expect.objectContaining({ served: true }));
        }
    });

    it('never filters unfinished applications on expiresAt, which the TTL policy leaves unindexed', async () => {
        const drafts = (await everyQuery()).filter((q) => q.path.endsWith('/application_drafts'));
        expect(drafts).toHaveLength(1);
        expect(drafts[0].filters.map((f) => f.field)).toEqual(['updatedAt']);
    });
});
