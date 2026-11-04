// =====================================================================
// A campaign launch gathers its recipients with reads side by side (M3b).
//
// `verifyDirectSelection` (the BULK-2 ownership gate for hand-picked leads)
// looks up the caller's IDs under the company's `applications` and `leads`, 30
// IDs a lookup, at most 10 lookups in flight. `gatherIdsFromQueries` starts the
// one or two filter queries ("Not contacted since" splits it) together. The
// recipients, their order, the exclusions, Limit Volume and every refusal are
// what the reads one after the other produced: the tests marked "fails before"
// failed on that code, and every other test passed on it too.
//
// Each read waits until the test settles it, so a test sees how many are in
// flight each time the code waits, and can let them end in any order.
// =====================================================================

const mockBuildLeadQueries = jest.fn();
const mockExcludeWindow = jest.fn();
const mockRecipientsMessagedWithin = jest.fn();

// Every database read, in the order it started.
const reads = [];
let inFlight = 0;
let mostInFlight = 0;

/** A read that waits until the test calls `settle()`; it then ends with `answer()`. */
function startRead(details, answer) {
    const read = { ...details, settled: false };
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    read.promise = new Promise((resolve, reject) => {
        read.settle = () => {
            read.settled = true;
            inFlight -= 1;
            try {
                resolve(answer());
            } catch (err) {
                reject(err);
            }
        };
    });
    // A read the code stopped waiting for must not end as an unhandled rejection.
    read.promise.catch(() => {});
    reads.push(read);
    return read.promise;
}

function snapshotOf(docs) {
    return { size: docs.length, docs, forEach: (fn) => docs.forEach(fn) };
}

// Which document IDs each company collection holds, and the lookups that fail
// (by collection and the first ID of their chunk).
const owned = { applications: new Set(), leads: new Set() };
const failingLookups = new Set();

function ownershipQuery(path, name, field, op, chunk) {
    return {
        select: (...fields) => ({
            get: () => startRead({ path, name, field, op, chunk, fields }, () => {
                if (failingLookups.has(`${name}:${chunk[0]}`)) throw new Error(`${name} unavailable`);
                return snapshotOf(chunk.filter((id) => owned[name].has(id)).map((id) => ({ id, data: () => ({}) })));
            }),
        }),
    };
}

// Shaped like Firestore: every call returns a new reference or query, and a
// document path must be a non-empty string.
const mockDb = {
    collection: (top) => ({
        doc: (companyId) => {
            if (typeof companyId !== 'string' || companyId === '') {
                throw new Error('Value for argument "documentPath" is not a valid resource path. Path must be a non-empty string.');
            }
            return {
                collection: (name) => ({
                    where: (field, op, chunk) => ownershipQuery(`${top}/${companyId}/${name}`, name, field, op, chunk),
                }),
            };
        },
    }),
};

const mockAdmin = {
    firestore: {
        FieldPath: { documentId: () => '__name__' },
    },
};

jest.mock('firebase-functions/v2/https', () => ({
    HttpsError: class extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    },
}));

jest.mock('../../firebaseAdmin', () => ({
    admin: mockAdmin,
    db: mockDb,
}));

jest.mock('../../bulkActions/helpers/queryBuilder', () => ({
    buildLeadQueries: (...args) => mockBuildLeadQueries(...args),
}));

jest.mock('../../bulkActions/helpers/recentlyMessaged', () => ({
    excludeWindow: (...args) => mockExcludeWindow(...args),
    recipientsMessagedWithin: (...args) => mockRecipientsMessagedWithin(...args),
}));

const { verifyDirectSelection, gatherIdsFromQueries } = require('../../bulkActions/controllers/session/gatherTargets');

const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Runs `work` to its end. Each time it waits on the database, records how many
 * reads are in flight, then settles them all, in `order` (as started by default).
 */
async function runToEnd(work, { order = (open) => open } = {}) {
    let outcome;
    const finished = work.then((value) => { outcome = { value }; }, (error) => { outcome = { error }; });
    const waits = [];
    for (;;) {
        await tick();
        if (outcome) break;
        const open = reads.filter((read) => !read.settled);
        if (open.length === 0) throw new Error('The code waits on something other than a read.');
        waits.push(open.length);
        order(open).forEach((read) => read.settle());
    }
    await finished;
    return { ...outcome, waits };
}

const reversed = (open) => [...open].reverse();
const idsUpTo = (n) => Array.from({ length: n }, (_, i) => `id-${i}`);
const chunksOf = (ids, size) => Array.from({ length: Math.ceil(ids.length / size) }, (_, i) => ids.slice(i * size, (i + 1) * size));
const warnings = () => console.warn.mock.calls;

beforeEach(() => {
    jest.resetAllMocks();
    reads.length = 0;
    inFlight = 0;
    mostInFlight = 0;
    owned.applications = new Set();
    owned.leads = new Set();
    failingLookups.clear();
    mockExcludeWindow.mockImplementation(() => ({ active: true, since: null }));
    mockRecipientsMessagedWithin.mockImplementation(async () => new Set());
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
    // Settle what a failed assertion left waiting, so nothing outlives its test.
    reads.filter((read) => !read.settled).forEach((read) => read.settle());
    await tick();
    jest.restoreAllMocks();
});

describe('verifyDirectSelection: ownership lookups in waves of 10', () => {
    const verify = (targetIds, companyId = 'company-1') => runToEnd(verifyDirectSelection({ companyId, targetIds }));

    it('checks 500 ids in 34 lookups, 10 at a time and never more (fails before: one at a time)', async () => {
        const targetIds = idsUpTo(500);
        owned.applications = new Set(['id-0']);
        owned.leads = new Set(['id-499']);

        const { value, waits } = await verify(targetIds);

        expect(waits).toEqual([10, 10, 10, 4]);
        expect(mostInFlight).toBe(10);
        expect(reads).toHaveLength(34);
        for (const name of ['applications', 'leads']) {
            const asked = reads.filter((read) => read.name === name);
            expect(asked.map((read) => read.chunk)).toEqual(chunksOf(targetIds, 30));
            for (const read of asked) {
                expect(read).toMatchObject({ path: `companies/company-1/${name}`, field: '__name__', op: 'in', fields: [] });
            }
        }
        expect(value).toEqual(['id-0', 'id-499']);
    });

    it('keeps only the owned ids, in the caller\'s order, whatever order the lookups end in', async () => {
        const targetIds = idsUpTo(70).reverse(); // id-69 … id-0: three chunks a collection
        owned.applications = new Set(['id-3', 'id-50', 'id-68']);
        owned.leads = new Set(['id-12', 'id-41', 'id-69']);

        const { value } = await runToEnd(verifyDirectSelection({ companyId: 'company-1', targetIds }), { order: reversed });

        expect(value).toEqual(['id-69', 'id-68', 'id-50', 'id-41', 'id-12', 'id-3']);
        expect(warnings()).toEqual([['[BULK-2] Rejected 64 targetIds not belonging to company company-1']]);
    });

    it('a failing lookup drops only its own ids and warns with the BULK-2 text; the rest of its wave counts', async () => {
        const targetIds = idsUpTo(70);
        owned.applications = new Set(['id-40']);
        owned.leads = new Set(['id-5', 'id-35', 'id-65']);
        failingLookups.add('leads:id-30'); // the leads lookup for id-30 … id-59

        const { value } = await runToEnd(verifyDirectSelection({ companyId: 'company-1', targetIds }), { order: reversed });

        expect(value).toEqual(['id-5', 'id-40', 'id-65']);
        expect(warnings()).toEqual([
            ['[BULK-2] Ownership check query failed for leads:', 'leads unavailable'],
            ['[BULK-2] Rejected 67 targetIds not belonging to company company-1'],
        ]);
    });

    it('refuses with permission-denied when none is owned, or when every lookup fails', async () => {
        const none = await verify(['foreign-1', 'foreign-2']);
        expect(none.error).toMatchObject({
            code: 'permission-denied',
            message: 'None of the provided lead IDs belong to your company.',
        });

        owned.leads = new Set(['id-1']);
        failingLookups.add('applications:id-0');
        failingLookups.add('leads:id-0');
        const allFailed = await verify(idsUpTo(3));
        expect(allFailed.error).toMatchObject({ code: 'permission-denied' });
    });

    it('refuses more than 500 ids before any lookup', async () => {
        const { error } = await verify(idsUpTo(501));

        expect(error).toMatchObject({ code: 'invalid-argument', message: 'Too many targetIds. Maximum is 500.' });
        expect(reads).toHaveLength(0);
    });

    it('a company path that cannot be built throws as it is, before any lookup', async () => {
        const { error } = await verify(['id-1'], 42);

        expect(error.message).toMatch(/not a valid resource path/);
        expect(error.code).toBeUndefined();
        expect(reads).toHaveLength(0);
        expect(warnings()).toEqual([]);
    });
});

describe('gatherIdsFromQueries: the split audience queries run together', () => {
    const doc = (id, data = {}) => ({ id, data: () => ({ phone: `+1555000${id.slice(-4)}`, ...data }) });
    const created = (ms) => ({ toMillis: () => ms });

    /** A filter query whose read ends with `answer()`: a list of docs, or a throw. */
    function filterQuery(index, answer) {
        return {
            select: (...fields) => ({
                get: () => startRead({ index, fields }, () => snapshotOf(answer())),
            }),
        };
    }
    const fail = (message) => () => { throw new Error(message); };
    const gather = (filters = {}, options) => runToEnd(gatherIdsFromQueries({
        companyId: 'company-1',
        filters,
        config: { method: 'sms' },
        authUid: 'admin-1',
    }), options);
    const queryLogs = () => console.log.mock.calls.map(([line]) => line).filter((line) => line.startsWith('[BulkSession] Query #'));

    it('starts both queries before either answers (fails before: the second waited for the first)', async () => {
        mockBuildLeadQueries.mockReturnValue([
            filterQuery(0, () => [doc('lead-0001')]),
            filterQuery(1, () => [doc('lead-0002')]),
        ]);

        const { value, waits } = await gather({ notContactedSince: '30' });

        expect(waits).toEqual([2]);
        expect(reads.map((read) => read.fields)).toEqual([
            ['phone', 'phoneNumber', 'email', 'createdAt', 'applicationId'],
            ['phone', 'phoneNumber', 'email', 'createdAt', 'applicationId'],
        ]);
        expect(value).toEqual(['lead-0001', 'lead-0002']);
    });

    it('keeps the series\' ids and order when the second query answers first, after both exclusions', async () => {
        mockBuildLeadQueries.mockReturnValue([
            filterQuery(0, () => [doc('lead-0001'), doc('lead-0002', { email: 'b@example.com' }), doc('lead-0003')]),
            filterQuery(1, () => [doc('lead-0004'), doc('lead-0005', { phone: '', phoneNumber: '+15559990005' })]),
        ]);
        mockRecipientsMessagedWithin.mockImplementation(async () => new Set(['lead-0003']));
        const filters = { excludeRecentDays: '7', excludedLeadIds: ['lead-0004'] };

        const { value } = await gather(filters, { order: reversed });

        expect(value).toEqual(['lead-0001', 'lead-0002', 'lead-0005']);
        expect(mockExcludeWindow).toHaveBeenCalledWith('7');
        expect(mockRecipientsMessagedWithin).toHaveBeenCalledTimes(1);
        expect(mockRecipientsMessagedWithin.mock.calls[0][0]).toMatchObject({
            companyId: 'company-1',
            method: 'sms',
            window: { active: true, since: null },
        });
        expect(mockRecipientsMessagedWithin.mock.calls[0][0].recipients).toEqual([
            { key: 'lead-0001', phone: '+15550000001', email: undefined, created: -Infinity },
            { key: 'lead-0002', phone: '+15550000002', email: 'b@example.com', created: -Infinity },
            { key: 'lead-0003', phone: '+15550000003', email: undefined, created: -Infinity },
            { key: 'lead-0004', phone: '+15550000004', email: undefined, created: -Infinity },
            { key: 'lead-0005', phone: '+15559990005', email: undefined, created: -Infinity },
        ]);
        expect(queryLogs()).toEqual(['[BulkSession] Query #0 returned 3 docs.', '[BulkSession] Query #1 returned 2 docs.']);
    });

    it('Limit Volume breaks a tie between the queries as the series did', async () => {
        mockBuildLeadQueries.mockReturnValue([
            filterQuery(0, () => [doc('lead-0001', { createdAt: created(5) }), doc('lead-0002', { createdAt: created(1) })]),
            filterQuery(1, () => [doc('lead-0003', { createdAt: created(5) }), doc('lead-0004', { createdAt: created(9) })]),
        ]);

        const { value } = await gather({ campaignLimit: '2' }, { order: reversed });

        expect(value).toEqual(['lead-0004', 'lead-0001']);
    });

    it('query #1 failing gives internal with #1\'s message, and nothing is excluded or returned', async () => {
        mockBuildLeadQueries.mockReturnValue([
            filterQuery(0, () => [doc('lead-0001')]),
            filterQuery(1, fail('The query requires an index.')),
        ]);

        const { error } = await gather();

        expect(error).toMatchObject({ code: 'internal', message: 'Query execution failed: The query requires an index.' });
        expect(console.error).toHaveBeenCalledWith('[BulkSession] Query #1 failed:', 'The query requires an index.');
        expect(mockRecipientsMessagedWithin).not.toHaveBeenCalled();
    });

    it('both failing gives #0\'s message, even when #1 fails first', async () => {
        mockBuildLeadQueries.mockReturnValue([
            filterQuery(0, fail('first query broke')),
            filterQuery(1, fail('second query broke')),
        ]);

        const { error } = await gather({}, { order: reversed });

        expect(error).toMatchObject({ code: 'internal', message: 'Query execution failed: first query broke' });
        expect(console.error).toHaveBeenCalledWith('[BulkSession] Query #0 failed:', 'first query broke');
        expect(mockRecipientsMessagedWithin).not.toHaveBeenCalled();
    });

    it('a query that throws as it starts is its own failure: an earlier one that fails still wins', async () => {
        mockBuildLeadQueries.mockReturnValue([
            filterQuery(0, fail('first query broke')),
            { select: () => ({ get: () => { throw new Error('second query could not start'); } }) },
        ]);

        const { error } = await gather();

        expect(error).toMatchObject({ code: 'internal', message: 'Query execution failed: first query broke' });
        expect(console.error).toHaveBeenCalledWith('[BulkSession] Query #0 failed:', 'first query broke');
    });

    it('a lead campaign leaves out the leads who applied, before the ledger and Limit Volume', async () => {
        mockBuildLeadQueries.mockReturnValue([filterQuery(0, () => [
            doc('lead-0001', { createdAt: created(1) }),
            doc('lead-0002', { createdAt: created(9), applicationId: 'app-9' }),
            doc('lead-0003', { createdAt: created(5), applicationId: '' }),
        ])]);

        const { value } = await gather({ leadType: 'leads', campaignLimit: '2' });

        expect(value).toEqual(['lead-0003', 'lead-0001']);
        expect(mockRecipientsMessagedWithin.mock.calls[0][0].recipients.map(({ key }) => key))
            .toEqual(['lead-0001', 'lead-0003']);
    });

    it('an applicant campaign keeps every application, which carries its own applicationId', async () => {
        mockBuildLeadQueries.mockReturnValue([filterQuery(0, () => [doc('app-0001', { applicationId: 'app-0001' })])]);

        const { value } = await gather({ leadType: 'applications' });

        expect(value).toEqual(['app-0001']);
    });

    it('a single query reads once and returns its ids', async () => {
        mockBuildLeadQueries.mockReturnValue([filterQuery(0, () => [doc('lead-0002'), doc('lead-0001')])]);

        const { value, waits } = await gather();

        expect(waits).toEqual([1]);
        expect(value).toEqual(['lead-0002', 'lead-0001']);
        expect(mockBuildLeadQueries).toHaveBeenCalledWith('company-1', {}, 'admin-1');
    });
});
