/**
 * SMS opt-out (`blacklist.js`): a STOP-type reply puts the sender's number on
 * the company's list and on the global one, in E.164; `isBlacklisted` finds a
 * number on either list however it is written, and refuses one it cannot read.
 * Every bulk-send suite stands the check in, so these are its only tests; what
 * the send loop does with the answer is in `batchWorker.optOut.test.js`.
 *
 * Capture itself is a known gap (APP_BRIEF §12): nothing writes the inbound
 * messages this trigger watches. All data is artificial.
 */

jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (path, handler) => handler }));

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));

const { handleOptOut, isBlacklisted } = require('../../blacklist');

const reply = (text, from = '(555) 123-4567') => handleOptOut({
    params: { companyId: 'co-1', msgId: 'msg-1' },
    data: { data: () => ({ text, from }) },
});

const COMPANY_ENTRY = { reason: 'STOP keyword', timestamp: '__server_timestamp__', originalMessageId: 'msg-1' };
const GLOBAL_ENTRY = { reason: 'Opt-out via company co-1', timestamp: '__server_timestamp__' };

const stored = () => Object.fromEntries(mock.docs);

beforeEach(() => mock.reset());

describe('handleOptOut', () => {
    it.each(['STOP', 'stop', '  Stop ', 'UNSUBSCRIBE', 'unsubscribe', 'QUIT', 'quit'])(
        'puts the number on both lists for %j',
        async (text) => {
            await reply(text);

            expect(stored()).toEqual({
                'companies/co-1/blacklist/+15551234567': COMPANY_ENTRY,
                'blacklist/+15551234567': GLOBAL_ENTRY,
            });
        },
    );

    it.each(['(555) 123-4567', '555.123.4567', '+1 555 123 4567', '15551234567'])(
        'stores %j in E.164',
        async (from) => {
            await reply('STOP', from);

            expect(Object.keys(stored()).sort()).toEqual(['blacklist/+15551234567', 'companies/co-1/blacklist/+15551234567']);
        },
    );

    it.each(['STOP please', 'Stop texting me', 'Yes', 'START', '', undefined])(
        'writes nothing for %j',
        async (text) => {
            await reply(text);

            expect(stored()).toEqual({});
        },
    );

    it('writes nothing when the sender cannot be read as a number', async () => {
        await reply('STOP', '12345');
        await reply('STOP', null);
        await reply('STOP', '');

        expect(stored()).toEqual({});
    });
});

describe('isBlacklisted', () => {
    it('lets through a number that is on neither list', async () => {
        expect(await isBlacklisted('co-1', '(555) 123-4567')).toBe(false);
    });

    it.each(['(555) 123-4567', '555-123-4567', '+1 (555) 123 4567', '15551234567'])(
        "finds a number on the company's list written as %j",
        async (phone) => {
            mock.reset({ 'companies/co-1/blacklist/+15551234567': COMPANY_ENTRY });

            expect(await isBlacklisted('co-1', phone)).toBe(true);
        },
    );

    it('finds a number on the global list, whichever company asks', async () => {
        mock.reset({ 'blacklist/+15551234567': GLOBAL_ENTRY });

        expect(await isBlacklisted('co-1', '(555) 123-4567')).toBe(true);
        expect(await isBlacklisted('co-2', '(555) 123-4567')).toBe(true);
    });

    it("does not let another company's own list stop this company", async () => {
        mock.reset({ 'companies/co-2/blacklist/+15551234567': COMPANY_ENTRY });

        expect(await isBlacklisted('co-1', '(555) 123-4567')).toBe(false);
        expect(await isBlacklisted('co-2', '(555) 123-4567')).toBe(true);
    });

    it('stops a STOP reply to one company from reaching the number through any company', async () => {
        await reply('STOP');

        expect(await isBlacklisted('co-1', '555-123-4567')).toBe(true);
        expect(await isBlacklisted('co-2', '555-123-4567')).toBe(true);
    });

    it.each([undefined, null, '', 'n/a', '12345', 5551234567])(
        'refuses %j, which cannot be read as a number',
        async (phone) => {
            expect(await isBlacklisted('co-1', phone)).toBe(true);
        },
    );
});
