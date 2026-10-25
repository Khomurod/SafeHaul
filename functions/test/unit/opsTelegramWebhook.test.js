/**
 * The alert bot's webhook (`telegramWebhook`) and its inbox.
 *
 * Pinned: a request without the bot's secret header is refused before anything
 * is written; only Start commands are kept, cut down to the chat and the person,
 * once each, for a day; and the bot is pointed at this function's own address
 * with a secret derived from its token. Ids, names and tokens are artificial.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onRequest: jest.fn((_opts, fn) => fn),
}));

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));

const mockReadBotToken = jest.fn();
jest.mock('../../ops/alertSettings', () => ({ readBotToken: (...args) => mockReadBotToken(...args) }));

const inbox = require('../../ops/telegramInbox');
const { telegramWebhook } = require('../../ops/telegramWebhook');
const { onRequest } = require('firebase-functions/v2/https');

// Read before any test clears the mocks: the function is declared once, at load.
const [DECLARED_OPTIONS] = onRequest.mock.calls[0];

// Built at run time: a token-shaped literal is what the secret scan exists to stop.
const TOKEN = `${'1'.repeat(9)}:${'t'.repeat(35)}`;
const NOW_S = Math.floor(Date.now() / 1000);

const START = (updateId = 10, extra = {}) => ({
    update_id: updateId,
    message: {
        message_id: 5,
        date: NOW_S,
        text: '/start CODE123',
        chat: { id: 222, type: 'private', first_name: 'Dana', last_name: 'Alvarez', bio: 'not kept' },
        from: { id: 9001, is_bot: false, first_name: 'Dana', last_name: 'Alvarez', language_code: 'en' },
        ...extra,
    },
});

function post(body, secret = inbox.webhookSecret(TOKEN), method = 'POST') {
    const res = { statusCode: null, status: jest.fn((code) => { res.statusCode = code; return res; }), send: jest.fn(() => res) };
    const headers = secret === null ? {} : { [inbox.SECRET_HEADER]: secret };
    return telegramWebhook({ method, body, get: (name) => headers[name.toLowerCase()] }, res).then(() => res);
}

const stored = async () => (await mock.db.collection('system_jobs').doc('platformAlertsInbox').get()).data()?.updates || [];

beforeEach(async () => {
    jest.clearAllMocks();
    mockReadBotToken.mockResolvedValue(TOKEN);
    await inbox.clearInbox();
});

describe('who may post', () => {
    it.each([
        ['no secret header', null],
        ['a wrong secret', 'f'.repeat(64)],
        ['a shorter secret', 'abc'],
    ])('refuses %s, and writes nothing', async (_label, secret) => {
        const res = await post(START(), secret);
        expect(res.statusCode).toBe(401);
        expect(await stored()).toEqual([]);
    });

    it('refuses everything while no bot token is saved', async () => {
        mockReadBotToken.mockResolvedValue(null);
        expect((await post(START())).statusCode).toBe(401);
    });

    it('takes only POST', async () => {
        expect((await post(START(), inbox.webhookSecret(TOKEN), 'GET')).statusCode).toBe(405);
        expect(mockReadBotToken).not.toHaveBeenCalled();
    });

    it('is public, as Telegram signs in no other way, and small', () => {
        expect(DECLARED_OPTIONS).toEqual(expect.objectContaining({ invoker: 'public', region: 'us-central1', maxInstances: 2 }));
    });

    it('answers 500 when it cannot write, so Telegram sends the update again', async () => {
        mockReadBotToken.mockRejectedValue(Object.assign(new Error('projects/x/secrets/y'), { code: 14 }));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        expect((await post(START())).statusCode).toBe(500);
        expect(JSON.stringify(console.error.mock.calls)).not.toContain('projects/x');
        console.error.mockRestore();
    });
});

describe('what is kept', () => {
    it('keeps a Start, cut down to the chat and the person', async () => {
        expect((await post(START())).statusCode).toBe(200);

        expect(await stored()).toEqual([{
            update_id: 10,
            message: {
                text: '/start CODE123',
                date: NOW_S,
                chat: { id: 222, type: 'private', first_name: 'Dana', last_name: 'Alvarez' },
                from: { id: 9001, first_name: 'Dana', last_name: 'Alvarez' },
            },
        }]);
    });

    it.each([
        ['ordinary text', { text: 'hello there' }],
        ['a command that is not Start', { text: '/stop' }],
        ['a word that only begins like Start', { text: '/started' }],
    ])('keeps nothing of %s, but answers 200 so Telegram does not resend it', async (_label, extra) => {
        expect((await post(START(10, extra))).statusCode).toBe(200);
        expect(await stored()).toEqual([]);
    });

    it('keeps a Start addressed to the bot in a group', async () => {
        await post(START(11, { text: '/start@safehaul_alerts_bot CODE123', chat: { id: -5, type: 'group', title: 'Dispatch' } }));
        expect((await stored())[0].message.chat).toEqual({ id: -5, type: 'group', title: 'Dispatch' });
    });

    it('keeps an update once, however often Telegram sends it', async () => {
        await post(START(10));
        await post(START(10));
        await post(START(12));
        expect((await stored()).map((entry) => entry.update_id)).toEqual([10, 12]);
    });

    it('forgets what Telegram itself would no longer hold, and keeps at most fifty', async () => {
        await post(START(1, { date: NOW_S - 25 * 60 * 60 }));
        await post(START(2));
        expect((await stored()).map((entry) => entry.update_id)).toEqual([2]);

        for (let id = 100; id < 160; id += 1) await inbox.recordUpdate(START(id));
        const kept = await stored();
        expect(kept).toHaveLength(50);
        expect(kept.at(-1).update_id).toBe(159);
    });

    it('reads the inbox oldest first', async () => {
        await inbox.recordUpdate(START(30));
        await inbox.recordUpdate(START(20));
        expect((await inbox.readUpdates()).map((entry) => entry.update_id)).toEqual([20, 30]);
    });
});

describe('pointing the bot here', () => {
    it('derives a secret Telegram accepts from the token, which a new token changes', () => {
        const secret = inbox.webhookSecret(TOKEN);
        expect(secret).toMatch(/^[0-9a-f]{64}$/);
        expect(secret).not.toContain(TOKEN);
        expect(inbox.webhookSecret(`${'2'.repeat(9)}:${'t'.repeat(35)}`)).not.toBe(secret);
    });

    it('names this function\'s own address in the project it runs in', () => {
        const saved = process.env.GCLOUD_PROJECT;
        process.env.GCLOUD_PROJECT = 'test-project';
        try {
            expect(inbox.webhookUrl()).toBe('https://us-central1-test-project.cloudfunctions.net/telegramWebhook');
        } finally {
            if (saved === undefined) delete process.env.GCLOUD_PROJECT;
            else process.env.GCLOUD_PROJECT = saved;
        }
    });
});
