/**
 * The daily DQ deadline notice: once a day, a hired driver whose earliest
 * valid-until date (`dqExpiresNext`) is within 30 days gets one bell notice that
 * it expires soon, and one that it expired once the date has passed.
 *
 * The job runs against the store the signing-reminder suites use
 * (`signingRequestStore.support.js`), with the real `createNotification`
 * writing to it; only `Date` runs on a fake clock. All names are artificial.
 */
let mockSchedule = null;
jest.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (options, fn) => {
        mockSchedule = options;
        return fn;
    },
}));
jest.mock('../../firebaseAdmin', () => require('./signingRequestStore.support').firebaseAdminMock());
jest.mock('../../shared/createNotification', () => ({ createNotification: jest.fn() }));

const store = require('./signingRequestStore.support');
const { createNotification } = require('../../shared/createNotification');
const { createNotification: realCreateNotification } = jest.requireActual('../../shared/createNotification');
const { notifyDqExpiry } = require('../../notifyDqExpiry');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 2026-11-05, 07:00 in Chicago. */
const NOW = Date.UTC(2026, 10, 5, 13, 0);
const COMPANY = 'companies/co-1';
const APPLICATION = `${COMPANY}/applications/app-1`;

const TEAM = { companyName: 'Demo Logistics', teamMembers: [{ userId: 'user-1' }, { userId: 'user-2' }] };
const HIRED = { status: 'Hired', firstName: 'Dana', lastName: 'Driver', assignedTo: 'user-1', dqExpiresNext: '2026-11-20' };
const MEDICAL_CARD = { type: 'medical_card', fileType: 'Medical Card', label: 'Medical Card', expirationDate: '2026-11-20' };
const CDL_FRONT = { type: 'license_front', fileType: 'CDL Front', label: 'CDL Front', expirationDate: '2027-05-01' };

/** An application with its DQ files, in a company that is seeded once. */
function seed({ path = APPLICATION, record = HIRED, files = { medical_card: MEDICAL_CARD, license_front: CDL_FRONT }, company = TEAM } = {}) {
    const companyPath = path.split('/').slice(0, 2).join('/');
    if (company && !store.docs.has(companyPath)) store.docs.set(companyPath, structuredClone(company));
    store.docs.set(path, structuredClone(record));
    for (const [id, file] of Object.entries(files)) store.docs.set(`${path}/dq_files/${id}`, structuredClone(file));
}

/** A hired driver whose medical card is the earliest date, `day`. */
const driverDue = (id, day, record = {}) => seed({
    path: `${COMPANY}/applications/${id}`,
    record: { ...HIRED, ...record, dqExpiresNext: day },
    files: { medical_card: { ...MEDICAL_CARD, expirationDate: day } },
});

/** A company's bell, by notification id; `createdAt` as its milliseconds. */
function notices(company = COMPANY) {
    const prefix = `${company}/notifications/`;
    return Object.fromEntries([...store.docs.entries()]
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, data]) => [path.slice(prefix.length), { ...data, createdAt: data.createdAt.getTime() }]));
}

const run = () => notifyDqExpiry({});
const ids = (company) => Object.keys(notices(company)).sort();
const later = (ms) => jest.setSystemTime(Date.now() + ms);
const allLogs = () => ['log', 'warn', 'error']
    .flatMap((level) => console[level].mock.calls)
    .map((args) => args.map(String).join(' '));
const jobLogs = () => allLogs().filter((line) => line.startsWith('[notifyDqExpiry]'));

beforeEach(() => {
    jest.resetAllMocks();
    store.reset();
    jest.useFakeTimers({
        now: NOW,
        doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate',
            'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
    createNotification.mockImplementation(realCreateNotification);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('a hired driver whose earliest DQ date is within 30 days', () => {
    it('gets one "expires soon" notice for their assignee, naming them, the document and the date, opening their dossier', async () => {
        seed();

        await run();

        expect(notices()).toEqual({
            'dq_expiring_app-1_2026-11-20': {
                type: 'dq_expiring',
                title: 'DQ document expires soon',
                message: "Dana Driver's medical card is valid until Nov 20, 2026",
                relatedType: 'application',
                relatedId: 'app-1',
                recipientId: 'user-1',
                read: false,
                createdAt: NOW,
            },
        });
    });

    it('is not told twice: a second run adds nothing and does not read the DQ file again', async () => {
        seed();
        await run();
        const first = notices();
        store.queried.length = 0;

        later(DAY);
        await run();

        expect(notices()).toEqual(first);
        expect(store.queried).toContain(`${COMPANY}/applications`);
        expect(store.queried).not.toContain(`${APPLICATION}/dq_files`);
    });

    it('counts a date of today and one 30 days ahead, not one 31 days ahead, and an Approved driver as hired', async () => {
        driverDue('app-1', '2026-11-05');
        driverDue('app-2', '2026-12-05', { status: 'Approved' });
        driverDue('app-3', '2026-12-06');

        await run();

        expect(ids()).toEqual(['dq_expiring_app-1_2026-11-05', 'dq_expiring_app-2_2026-12-05']);
        expect(store.queried).not.toContain(`${COMPANY}/applications/app-3/dq_files`);
    });

    it('names each document that holds the date once, never a removed one', async () => {
        seed({
            files: {
                license_front: { ...CDL_FRONT, expirationDate: '2026-11-20' },
                license_back: { type: 'license_back', fileType: 'CDL Back', expirationDate: '2026-11-20' },
                medical_card: MEDICAL_CARD,
                twic_card: { type: 'twic_card', fileType: 'TWIC Card', expirationDate: '2026-11-20', removedAt: { ms: NOW - DAY } },
                team_mvr: { fileType: 'MVR (Annual)', expirationDate: '2026-12-01' },
            },
        });

        await run();

        expect(Object.values(notices()).map(({ message }) => message))
            .toEqual(["Dana Driver's CDL and medical card are valid until Nov 20, 2026"]);
    });

    it('is not told while no document in the file holds the stored date', async () => {
        // The record's date is behind a change to its file (the DQ tab puts it right).
        seed({ files: { medical_card: { ...MEDICAL_CARD, expirationDate: '2027-11-20' } } });

        await run();

        expect(notices()).toEqual({});
    });
});

describe('a hired driver whose earliest DQ date has passed', () => {
    it('first seen after the date, gets only the "expired" notice, once', async () => {
        driverDue('app-1', '2026-11-01');

        await run();
        later(DAY);
        await run();

        expect(notices()).toEqual({
            'dq_expired_app-1_2026-11-01': {
                type: 'dq_expired',
                title: 'DQ document expired',
                message: "Dana Driver's medical card was valid until Nov 1, 2026",
                relatedType: 'application',
                relatedId: 'app-1',
                recipientId: 'user-1',
                read: false,
                createdAt: NOW,
            },
        });
    });

    it('told it expires soon, is told again when it expires, and a renewed date gets notices of its own', async () => {
        seed();
        await run();

        later(16 * DAY); // 2026-11-21: the medical card ran out yesterday
        await run();
        expect(ids()).toEqual(['dq_expired_app-1_2026-11-20', 'dq_expiring_app-1_2026-11-20']);

        // A renewed card whose date is inside the window again.
        store.update(`${APPLICATION}/dq_files/medical_card`, { expirationDate: '2026-12-10' });
        store.update(APPLICATION, { dqExpiresNext: '2026-12-10' });
        later(DAY);
        await run();
        await run();

        expect(ids()).toEqual([
            'dq_expired_app-1_2026-11-20', 'dq_expiring_app-1_2026-11-20', 'dq_expiring_app-1_2026-12-10',
        ]);
    });
});

describe('who is told', () => {
    it('a driver assigned to someone who left the team: the whole team', async () => {
        seed({ record: { ...HIRED, assignedTo: 'user-9' } });

        await run();

        const [notice] = Object.values(notices());
        expect(notice).toMatchObject({ type: 'dq_expiring', relatedType: 'application', relatedId: 'app-1' });
        expect(notice).not.toHaveProperty('recipientId');
    });

    it('a driver nobody is assigned: the whole team', async () => {
        const { assignedTo, ...unassigned } = HIRED;
        expect(assignedTo).toBe('user-1');
        seed({ record: unassigned });

        await run();

        const [notice] = Object.values(notices());
        expect(notice).toMatchObject({ type: 'dq_expiring', relatedId: 'app-1' });
        expect(notice).not.toHaveProperty('recipientId');
    });

    it('nobody, for a record that is not hired, whatever its date', async () => {
        driverDue('app-1', '2026-11-01', { status: 'Offer Sent' });
        driverDue('app-2', '2026-11-20', { status: 'New Application' });
        store.docs.set(`${COMPANY}/leads/lead-1`, { ...HIRED, dqExpiresNext: '2026-11-01' });

        await run();

        expect(notices()).toEqual({});
    });
});

describe('a company', () => {
    it('whose drivers cannot be read does not stop the others, and is logged by id and code', async () => {
        seed();
        seed({ path: 'companies/co-2/applications/app-2' });
        store.failingQueries.add(`${COMPANY}/applications`);

        await run();

        expect(notices()).toEqual({});
        expect(ids('companies/co-2')).toEqual(['dq_expiring_app-2_2026-11-20']);
        expect(jobLogs().some((line) => line.includes('companyId=co-1') && line.includes('14'))).toBe(true);
    });

    it('with a driver whose notice cannot be written still tells the next, and the next run tries again', async () => {
        driverDue('app-1', '2026-11-10');
        driverDue('app-2', '2026-11-20');
        createNotification.mockRejectedValueOnce(Object.assign(new Error('unavailable (artificial)'), { code: 14 }));

        await run();
        expect(ids()).toEqual(['dq_expiring_app-2_2026-11-20']);
        expect(jobLogs().some((line) => line.includes('applicationId=app-1') && line.includes('14'))).toBe(true);

        later(DAY);
        await run();
        expect(ids()).toEqual(['dq_expiring_app-1_2026-11-10', 'dq_expiring_app-2_2026-11-20']);
    });

    it('that Super Admin deactivated is not read', async () => {
        seed({ company: { ...TEAM, isActive: false } });

        await run();

        expect(notices()).toEqual({});
        expect(store.queried).not.toContain(`${COMPANY}/applications`);
    });
});

describe('one run', () => {
    it('out of time, writes no more notices, reads no more companies, and the next run tells the rest', async () => {
        driverDue('app-1', '2026-11-10');
        driverDue('app-2', '2026-11-20');
        seed({ path: 'companies/co-2/applications/app-3' });
        createNotification.mockImplementationOnce(async (...args) => {
            const id = await realCreateNotification(...args);
            later(8 * MINUTE);
            return id;
        });

        await run();

        // The earliest date goes first.
        expect(ids()).toEqual(['dq_expiring_app-1_2026-11-10']);
        expect(store.queried).not.toContain('companies/co-2/applications');
        expect(jobLogs().at(-1)).toContain('out of time');

        later(DAY);
        await run();

        expect(ids()).toEqual(['dq_expiring_app-1_2026-11-10', 'dq_expiring_app-2_2026-11-20']);
        expect(ids('companies/co-2')).toEqual(['dq_expiring_app-3_2026-11-20']);
    });

    it('logs ids and counts, never a name or a date', async () => {
        seed();
        driverDue('app-2', '2026-11-01', { firstName: 'Eli', lastName: 'Example', assignedTo: 'user-9' });

        await run();

        expect(jobLogs().at(-1)).toContain('companies=1 expiring=1 expired=1');
        const logs = allLogs();
        expect(logs.length).toBeGreaterThan(0);
        for (const line of logs) expect(line).not.toMatch(/Dana|Eli|Example|\bDriver\b|\d{4}-\d{2}-\d{2}|Nov\b/);
    });

    it('reads hired drivers on the applications status + dqExpiresNext composite in firestore.indexes.json', async () => {
        seed();

        await run();

        expect(store.queries).toContainEqual({ path: `${COMPANY}/applications`, fields: ['status', 'dqExpiresNext'] });
        const indexes = require('../../../firestore.indexes.json').indexes;
        expect(indexes).toContainEqual({
            collectionGroup: 'applications',
            queryScope: 'COLLECTION',
            fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'dqExpiresNext', order: 'ASCENDING' }],
        });
    });

    it('runs once a day at 07:00 Chicago time, in us-central1, with no secrets: it sends no email or text', () => {
        expect(mockSchedule).toEqual({
            schedule: '0 7 * * *',
            timeZone: 'America/Chicago',
            region: 'us-central1',
            timeoutSeconds: 540,
        });
    });
});
