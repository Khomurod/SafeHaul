/**
 * A company's SMS opt-out list, kept by its team (`smsOptOuts.js`): any member
 * lists it and adds a number, only a Company Admin removes one, and the global
 * list is never touched. The role checks are the real `companyAccess.js`, over
 * made-up claims. All numbers and names are artificial.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock({}, { filters: true, ordering: true });
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));

const CLAIMS = {
    'admin-uid': { roles: { 'co-1': 'company_admin' } },
    'recruiter-uid': { roles: { 'co-1': 'recruiter' } },
    'outsider-uid': { roles: { 'co-2': 'company_admin' } },
};
mock.admin.auth = () => ({ getUser: async (uid) => ({ customClaims: CLAIMS[uid] || {} }) });

const { LIST_LIMIT, listSmsOptOuts, addSmsOptOut, removeSmsOptOut } = require('../../smsOptOuts');

const as = (uid, name = 'Artificial Person') => ({ uid, token: { name } });
const call = (fn, data, auth = as('recruiter-uid', 'Rita Recruiter')) => fn({ data, auth });
const at = (iso) => ({ toMillis: () => Date.parse(iso) });

const COMPANY = 'companies/co-1';
const ENTRY = `${COMPANY}/blacklist/+15551234567`;
const GLOBAL = 'blacklist/+15551234567';
const FROM_REPLY = { reason: 'STOP keyword', timestamp: at('2026-10-01T12:00:00.000Z'), originalMessageId: 'msg-1' };
const SEED = { [COMPANY]: { companyName: 'Artificial Co' }, 'companies/co-2': { companyName: 'Other Co' } };

const stored = () => Object.fromEntries(mock.docs);
let logged;

/** Makes `method` of every opt-out entry fail as Firestore can: with the document's path in the message. */
function failEntries(method) {
    const collection = mock.db.collection;
    jest.spyOn(mock.db, 'collection').mockImplementation((name) => {
        const companies = collection(name);
        if (name !== 'companies') return companies;
        const companyDoc = (id) => {
            const company = companies.doc(id);
            const sub = (subName) => {
                const list = company.collection(subName);
                if (subName !== 'blacklist') return list;
                return {
                    ...list,
                    doc: (phone) => ({
                        ...list.doc(phone),
                        [method]: async () => {
                            throw Object.assign(new Error(`9 FAILED_PRECONDITION: ${list.path}/${phone}`), { code: 9 });
                        },
                    }),
                };
            };
            return { ...company, collection: sub };
        };
        return { ...companies, doc: companyDoc };
    });
}

beforeEach(() => {
    mock.reset(SEED);
    logged = [];
    for (const level of ['log', 'info', 'warn', 'error']) {
        jest.spyOn(console, level).mockImplementation((...args) => { logged.push(args.map(String).join(' ')); });
    }
});

afterEach(() => {
    jest.restoreAllMocks();
    // A phone number is never written to the logs, in any form.
    for (const line of logged) expect(line).not.toMatch(/555\D?123\D?4567|5551234567/);
});

describe('listing the numbers', () => {
    it('lists the company’s numbers newest first, with how, why, by whom and when each was added', async () => {
        mock.reset({
            ...SEED,
            [ENTRY]: FROM_REPLY,
            [`${COMPANY}/blacklist/+15550000002`]: {
                reason: 'Asked on a call', timestamp: at('2026-10-05T09:30:00.000Z'),
                addedBy: 'recruiter-uid', addedByName: 'Rita Recruiter', source: 'team',
            },
            'companies/co-2/blacklist/+15550000003': { reason: 'Theirs', timestamp: at('2026-10-06T00:00:00.000Z') },
            [GLOBAL]: { reason: 'Opt-out via company co-9', timestamp: at('2026-09-01T00:00:00.000Z') },
        });

        const listed = await call(listSmsOptOuts, { companyId: 'co-1' });

        expect(listed).toEqual({
            entries: [
                {
                    phone: '+15550000002', reason: 'Asked on a call', source: 'team',
                    addedBy: 'recruiter-uid', addedByName: 'Rita Recruiter', addedAt: '2026-10-05T09:30:00.000Z',
                },
                {
                    phone: '+15551234567', reason: 'STOP keyword', source: 'reply',
                    addedBy: null, addedByName: null, addedAt: '2026-10-01T12:00:00.000Z',
                },
            ],
            total: 2,
            limit: LIST_LIMIT,
            hasMore: false,
        });
    });

    it(`shows at most ${LIST_LIMIT}, the newest, and says how many there are`, async () => {
        const seed = { ...SEED };
        const start = Date.parse('2026-01-01T00:00:00.000Z');
        for (let i = 0; i < LIST_LIMIT + 2; i += 1) {
            seed[`${COMPANY}/blacklist/+1555${String(1000000 + i)}`] = {
                reason: 'Asked not to be texted', timestamp: { toMillis: () => start + i * 60000 }, source: 'team',
            };
        }
        mock.reset(seed);

        const listed = await call(listSmsOptOuts, { companyId: 'co-1' });

        expect(listed.entries).toHaveLength(LIST_LIMIT);
        expect(listed.entries[0].phone).toBe(`+1555${1000000 + LIST_LIMIT + 1}`);
        expect(listed).toEqual(expect.objectContaining({ total: LIST_LIMIT + 2, hasMore: true }));
    });

    it('refuses someone outside the company, and someone signed out', async () => {
        await expect(call(listSmsOptOuts, { companyId: 'co-1' }, as('outsider-uid')))
            .rejects.toMatchObject({ code: 'permission-denied' });
        await expect(call(listSmsOptOuts, { companyId: 'co-1' }, null)).rejects.toMatchObject({ code: 'unauthenticated' });
    });
});

describe('adding a number', () => {
    it('lets any team member add a number, stored in E.164 with who added it', async () => {
        const added = await call(addSmsOptOut, { companyId: 'co-1', phone: '(555) 123-4567', reason: '  Replied   STOP ' });

        expect(added).toEqual({
            added: true,
            entry: expect.objectContaining({
                phone: '+15551234567', reason: 'Replied STOP', source: 'team',
                addedBy: 'recruiter-uid', addedByName: 'Rita Recruiter',
            }),
        });
        expect(stored()[ENTRY]).toEqual({
            reason: 'Replied STOP', timestamp: '__server_timestamp__',
            addedBy: 'recruiter-uid', addedByName: 'Rita Recruiter', source: 'team',
        });
        // The company's own list only.
        expect(stored()[GLOBAL]).toBeUndefined();
    });

    it('gives a number added without a reason the plain one', async () => {
        await call(addSmsOptOut, { companyId: 'co-1', phone: '555.123.4567' });
        expect(stored()[ENTRY].reason).toBe('Asked not to be texted');
    });

    it('keeps the first entry when a listed number is added again', async () => {
        mock.reset({ ...SEED, [ENTRY]: FROM_REPLY });

        const again = await call(addSmsOptOut, { companyId: 'co-1', phone: '+1 555 123 4567', reason: 'Asked again' }, as('admin-uid'));

        expect(again).toEqual({
            added: false,
            entry: expect.objectContaining({ phone: '+15551234567', reason: 'STOP keyword', source: 'reply', addedAt: '2026-10-01T12:00:00.000Z' }),
        });
        expect(stored()[ENTRY]).toEqual(FROM_REPLY);
    });

    it.each(['12345', 'not a number', '', '   ', null, 42, '1'.repeat(20)])(
        'refuses %j with a message, and stores nothing',
        async (phone) => {
            await expect(call(addSmsOptOut, { companyId: 'co-1', phone }))
                .rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringMatching(/phone number/) });
            expect(Object.keys(stored()).filter((path) => path.includes('blacklist'))).toEqual([]);
        },
    );

    it('refuses someone outside the company, and stores nothing', async () => {
        await expect(call(addSmsOptOut, { companyId: 'co-1', phone: '5551234567' }, as('outsider-uid')))
            .rejects.toMatchObject({ code: 'permission-denied' });
        await expect(call(addSmsOptOut, { companyId: 'co-1', phone: '5551234567' }, null))
            .rejects.toMatchObject({ code: 'unauthenticated' });
        expect(stored()[ENTRY]).toBeUndefined();
    });

    it('reports a failed write plainly, and logs its code, never the number', async () => {
        failEntries('create');
        await expect(call(addSmsOptOut, { companyId: 'co-1', phone: '5551234567' }))
            .rejects.toMatchObject({ code: 'internal', message: 'The number could not be added. Try again.' });
        expect(logged).toContainEqual('[addSmsOptOut] failed for company co-1: 9');
    });

    it('refuses a company id that is not one', async () => {
        await expect(call(addSmsOptOut, { companyId: 'co-1/blacklist', phone: '5551234567' }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call(addSmsOptOut, { phone: '5551234567' })).rejects.toMatchObject({ code: 'invalid-argument' });
    });
});

describe('removing a number', () => {
    beforeEach(() => {
        mock.reset({
            ...SEED,
            [ENTRY]: FROM_REPLY,
            [GLOBAL]: { reason: 'Opt-out via company co-1', timestamp: at('2026-10-01T12:00:00.000Z') },
        });
    });

    it('refuses a team member who is not a Company Admin, and keeps the entry', async () => {
        await expect(call(removeSmsOptOut, { companyId: 'co-1', phone: '+15551234567' }))
            .rejects.toMatchObject({ code: 'permission-denied' });
        await expect(call(removeSmsOptOut, { companyId: 'co-1', phone: '+15551234567' }, as('outsider-uid')))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect(stored()[ENTRY]).toEqual(FROM_REPLY);
    });

    it('lets a Company Admin remove the company’s entry, leaves the global list alone, and logs who did it', async () => {
        const removed = await call(removeSmsOptOut, { companyId: 'co-1', phone: '555-123-4567' }, as('admin-uid'));

        expect(removed).toEqual({ phone: '+15551234567', removed: true });
        expect(stored()[ENTRY]).toBeUndefined();
        expect(stored()[GLOBAL]).toEqual({ reason: 'Opt-out via company co-1', timestamp: expect.anything() });
        expect(logged).toContainEqual(expect.stringMatching(/removeSmsOptOut.*4567.*co-1.*admin-uid/));
    });

    it('answers a number that is not listed without changing anything', async () => {
        await expect(call(removeSmsOptOut, { companyId: 'co-1', phone: '5550000009' }, as('admin-uid')))
            .resolves.toEqual({ phone: '+15550000009', removed: false });
        expect(stored()[ENTRY]).toEqual(FROM_REPLY);
    });

    it('reports a failed removal plainly, and logs its code, never the number', async () => {
        failEntries('delete');
        await expect(call(removeSmsOptOut, { companyId: 'co-1', phone: '5551234567' }, as('admin-uid')))
            .rejects.toMatchObject({ code: 'internal', message: 'The number could not be removed. Try again.' });
        expect(logged).toContainEqual('[removeSmsOptOut] failed for company co-1: 9');
        expect(stored()[ENTRY]).toEqual(FROM_REPLY);
    });

    it('refuses a number it cannot read', async () => {
        await expect(call(removeSmsOptOut, { companyId: 'co-1', phone: '12' }, as('admin-uid')))
            .rejects.toMatchObject({ code: 'invalid-argument' });
    });
});
