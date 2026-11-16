/**
 * Super Admin → Analytics reads `stats_daily`, which two paths write: the live
 * trigger, one call as it is logged (`statsAggregator.js`), and the rebuild,
 * every call again (`statsBackfill.js`). Fed the same logs, they must write the
 * same days with the same counts, or a rebuild silently changes the numbers.
 * Both run here for real over an in-memory Firestore, and both count with
 * `shared/callStats.js`. All ids, names and times are artificial.
 */
jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: jest.fn((_options, handler) => handler),
}));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: async () => true }));

const mockStore = new Map();
const mockLogs = [];
jest.mock('../../firebaseAdmin', () => {
    const ref = (path) => ({
        path,
        collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
        set: async (data) => { mockStore.set(path, data); },
    });
    const snapshot = (path) => ({ exists: mockStore.has(path), data: () => mockStore.get(path) });
    const collectionGroupQuery = (name, after = null) => ({
        where: () => collectionGroupQuery(name, after),
        orderBy: () => collectionGroupQuery(name, after),
        limit: () => collectionGroupQuery(name, after),
        startAfter: (last) => collectionGroupQuery(name, last),
        get: async () => {
            const docs = mockLogs
                .filter((log) => log.path.split('/').slice(-2)[0] === name)
                .sort((a, b) => a.path.localeCompare(b.path))
                .filter((log) => !after || log.path > after.ref.path)
                .map((log) => ({ ref: { path: log.path }, data: () => log.data }));
            return { empty: docs.length === 0, size: docs.length, docs };
        },
    });
    const db = {
        collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
        collectionGroup: (name) => collectionGroupQuery(name),
        runTransaction: async (work) => work({
            get: async (docRef) => snapshot(docRef.path),
            set: (docRef, data) => { mockStore.set(docRef.path, JSON.parse(JSON.stringify(data))); },
        }),
    };
    return {
        db,
        admin: {
            // The rebuild reads super admin from the Auth record (К4).
            auth: () => ({ getUser: async () => ({ customClaims: { globalRole: 'super_admin' } }) }),
            firestore: Object.assign(() => db, {
                FieldPath: { documentId: () => '__name__' },
                FieldValue: { serverTimestamp: () => '__server_time__' },
            }),
        },
    };
});

const { onActivityLogCreated, onLeadsActivityLogCreated } = require('../../statsAggregator');
const { backfillCompanyStats } = require('../../statsBackfill');
const { addCallToDayStats, chicagoDayKey, emptyDayStats } = require('../../shared/callStats');

const at = (iso) => ({ toDate: () => new Date(iso) });
const call = (performedBy, performedByName, outcome, iso) => ({ action: 'Call Logged', performedBy, performedByName, outcome, timestamp: at(iso) });

/** [record kind, record id, log id, the log]. 2026-11-07 05:30Z is 23:30 on the 6th in Chicago. */
const LOGS = [
    ['applications', 'app-1', 'log-01', call('rita', 'Rita Recruiter', 'interested', '2026-11-06T15:00:00Z')],
    ['applications', 'app-1', 'log-02', call('rita', 'Rita Recruiter', 'voicemail', '2026-11-06T16:00:00Z')],
    ['applications', 'app-2', 'log-03', call('rita', 'Rita Recruiter', 'no_answer', '2026-11-07T05:30:00Z')],
    ['applications', 'app-2', 'log-04', call('sam', 'Sam Staff', 'callback', '2026-11-07T06:30:00Z')],
    ['applications', 'app-2', 'log-05', call('sam', 'Sam Staff', 'not_interested', '2026-11-07T18:00:00Z')],
    ['applications', 'app-3', 'log-06', call('sam', 'Sam Staff', 'hired_elsewhere', '2026-11-07T19:00:00Z')],
    ['applications', 'app-3', 'log-07', call('sam', 'Sam Staff', 'not_qualified', '2026-11-07T20:00:00Z')],
    ['applications', 'app-3', 'log-08', call('sam', 'Sam Staff', 'wrong_number', '2026-11-07T21:00:00Z')],
    ['applications', 'app-3', 'log-09', call(undefined, undefined, undefined, '2026-11-07T22:00:00Z')],
    ['applications', 'app-3', 'log-10', { type: 'call', performedBy: 'rita', performedByName: 'Rita Recruiter', outcome: 'interested', timestamp: new Date('2026-11-07T23:00:00Z') }],
    ['applications', 'app-3', 'log-11', { type: 'call', action: 'Note Added', performedBy: 'rita', timestamp: at('2026-11-07T23:30:00Z') }],
    ['applications', 'app-3', 'log-12', { action: 'Status Changed', performedBy: 'rita', timestamp: at('2026-11-07T23:40:00Z') }],
    ['applications', 'app-3', 'log-13', { ...call('rita', 'Rita Recruiter', 'other_outcome', '2026-11-08T15:00:00Z'), isContact: true }],
    ['leads', 'lead-1', 'log-14', call('lee', 'Lee Lead', 'interested', '2026-11-08T16:00:00Z')],
    ['leads', 'lead-1', 'log-15', call('rita', 'Rita Recruiter', 'callback', '2026-11-08T17:00:00Z')],
];

const TRIGGERS = { applications: onActivityLogCreated, leads: onLeadsActivityLogCreated };

const SERVER_TIMES = new Set(['createdAt', 'updatedAt', 'backfilledAt']);

/** Each day's stats as written, without the server's timestamps. */
function writtenDays() {
    const days = {};
    for (const [path, data] of mockStore) {
        const match = path.match(/^companies\/co-1\/stats_daily\/([^/]+)$/);
        if (!match) continue;
        days[match[1]] = Object.fromEntries(Object.entries(data).filter(([key]) => !SERVER_TIMES.has(key)));
    }
    return days;
}

beforeEach(() => {
    mockStore.clear();
    mockLogs.length = 0;
});

describe('the live trigger and the rebuild', () => {
    it('write the same days with the same counts from the same calls', async () => {
        for (const [kind, , logId, data] of LOGS) {
            await TRIGGERS[kind]({ data: { data: () => data }, params: { companyId: 'co-1', logId } });
        }
        // A delivery the trigger has already counted counts once.
        const [kind, , logId, data] = LOGS[0];
        await TRIGGERS[kind]({ data: { data: () => data }, params: { companyId: 'co-1', logId } });
        const live = writtenDays();

        mockStore.clear();
        for (const [kind, recordId, logId, data] of LOGS) {
            mockLogs.push({ path: `companies/co-1/${kind}/${recordId}/activity_logs/${logId}`, data });
        }
        const result = await backfillCompanyStats({ auth: { uid: 'super-1', token: { globalRole: 'super_admin' } }, data: { companyId: 'co-1', dryRun: false } });
        const rebuilt = writtenDays();

        expect(Object.keys(live).sort()).toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
        expect(rebuilt).toEqual(live);
        expect(result).toMatchObject({ modernCount: LOGS.length, legacyCount: 0, daysWritten: 3 });
    });

    it('counts a day as the shared rules say', () => {
        const day = emptyDayStats();
        for (const [, , , data] of LOGS) {
            if (chicagoDayKey(data.timestamp) === '2026-11-07') addCallToDayStats(day, data);
        }
        expect(day).toMatchObject({
            totalDials: 7, connected: 5, interested: 1, callback: 1, notInterested: 1,
            hiredElsewhere: 1, notQualified: 1, wrongNumber: 1, voicemail: 0,
        });
        expect(day.byUser.unknown).toMatchObject({ name: 'Unknown', dials: 1, connected: 0 });
        expect(day.byUser.rita).toMatchObject({ dials: 1, connected: 1, interested: 1 });
    });
});
