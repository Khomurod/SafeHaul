/**
 * Super Admin → System Health → Telegram alerts: the callables.
 *
 * Pinned: the guards run first, a token Telegram refuses is never stored, a
 * chat is saved only once it was reached, and no response or audit record
 * carries the token or the chat id.
 */

jest.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
    return { HttpsError, onCall: jest.fn((_opts, fn) => fn) };
});

const mockGuards = { guardPrivileged: jest.fn(), assertSuperAdmin: jest.fn(), assertWithinRateLimit: jest.fn() };
jest.mock('../../environmentVault/guards', () => mockGuards);

const mockRecordAuditEvent = jest.fn();
jest.mock('../../environmentVault/audit', () => ({
    ACTIONS: { LIST: 'list', UPDATE: 'update', DELETE: 'delete', TEST: 'test' },
    RESULTS: { SUCCESS: 'success' },
    recordAuditEvent: (...args) => mockRecordAuditEvent(...args),
}));

const mockSettings = {
    readSettings: jest.fn(),
    readBotToken: jest.fn(),
    writeBotToken: jest.fn(),
    destroyBotToken: jest.fn(),
    replaceSettings: jest.fn(),
};
jest.mock('../../ops/alertSettings', () => mockSettings);

const mockTelegram = { getBot: jest.fn(), latestChat: jest.fn(), sendMessage: jest.fn() };
jest.mock('../../ops/telegram', () => {
    const actual = jest.requireActual('../../ops/telegram');
    return {
        TOKEN_PATTERN: actual.TOKEN_PATTERN,
        TelegramError: actual.TelegramError,
        getBot: (...args) => mockTelegram.getBot(...args),
        latestChat: (...args) => mockTelegram.latestChat(...args),
        sendMessage: (...args) => mockTelegram.sendMessage(...args),
    };
});

const { TelegramError } = jest.requireActual('../../ops/telegram');
const callables = require('../../ops/callables');

const TOKEN = `${'1'.repeat(9)}:${'t'.repeat(35)}`;
const REQUEST = (data = {}) => ({ auth: { uid: 'owner', token: { globalRole: 'super_admin' } }, data });

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGuards.guardPrivileged.mockResolvedValue(undefined);
    mockGuards.assertSuperAdmin.mockResolvedValue(undefined);
    mockGuards.assertWithinRateLimit.mockResolvedValue(undefined);
    mockRecordAuditEvent.mockResolvedValue(undefined);
    mockSettings.readSettings.mockResolvedValue({});
    mockSettings.readBotToken.mockResolvedValue(null);
    mockSettings.writeBotToken.mockResolvedValue({ secretId: 'SAFEHAUL_AI_ALERTS_TELEGRAM_BOTTOKEN', valueLength: TOKEN.length });
    mockSettings.destroyBotToken.mockResolvedValue({ secretId: 'SAFEHAUL_AI_ALERTS_TELEGRAM_BOTTOKEN', destroyed: 1 });
    mockSettings.replaceSettings.mockResolvedValue(undefined);
    mockTelegram.getBot.mockResolvedValue({ username: 'safehaul_alerts_bot', id: 1 });
    mockTelegram.latestChat.mockResolvedValue({ id: 222, title: 'Dana Alvarez' });
    mockTelegram.sendMessage.mockResolvedValue(undefined);
});

afterEach(() => {
    console.error.mockRestore();
});

/** Everything the callables wrote or returned, as one string to search. */
function everythingSaid(response) {
    return JSON.stringify([response, mockRecordAuditEvent.mock.calls, mockSettings.replaceSettings.mock.calls]);
}

describe('saving the bot token', () => {
    it('checks the caller before anything else', async () => {
        mockGuards.guardPrivileged.mockRejectedValue(Object.assign(new Error('REAUTH_REQUIRED'), { code: 'failed-precondition' }));

        await expect(callables.savePlatformAlertToken(REQUEST({ token: TOKEN }))).rejects.toThrow('REAUTH_REQUIRED');
        expect(mockTelegram.getBot).not.toHaveBeenCalled();
        expect(mockSettings.writeBotToken).not.toHaveBeenCalled();
    });

    it('refuses something that is not a token without asking Telegram', async () => {
        await expect(callables.savePlatformAlertToken(REQUEST({ token: 'my bot' })))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockTelegram.getBot).not.toHaveBeenCalled();
    });

    it('never stores a token Telegram refuses', async () => {
        mockTelegram.getBot.mockRejectedValue(new TelegramError('token_rejected', 'Telegram refused the request (401).'));

        await expect(callables.savePlatformAlertToken(REQUEST({ token: TOKEN })))
            .rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringMatching(/did not accept this token/) });
        expect(mockSettings.writeBotToken).not.toHaveBeenCalled();
    });

    it('stores a working token, names the bot, and forgets the old bot\'s chat', async () => {
        const response = await callables.savePlatformAlertToken(REQUEST({ token: `  ${TOKEN}  ` }));

        expect(mockSettings.writeBotToken).toHaveBeenCalledWith(TOKEN);
        expect(response).toEqual({ bot: { username: 'safehaul_alerts_bot' } });
        const [patch] = mockSettings.replaceSettings.mock.calls[0];
        expect(Object.keys(patch)).toEqual(['telegram']);
        expect(patch.telegram).toEqual({ botUsername: 'safehaul_alerts_bot', tokenSavedAt: expect.any(String) });
        expect(everythingSaid(response)).not.toContain(TOKEN);
    });
});

describe('connecting the chat', () => {
    beforeEach(() => {
        mockSettings.readBotToken.mockResolvedValue(TOKEN);
        mockSettings.readSettings.mockResolvedValue({ telegram: { botUsername: 'safehaul_alerts_bot' } });
    });

    it('asks for the token first', async () => {
        mockSettings.readBotToken.mockResolvedValue(null);
        await expect(callables.connectPlatformAlertChat(REQUEST())).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('says what to do when nobody has written to the bot yet', async () => {
        mockTelegram.latestChat.mockResolvedValue(null);
        await expect(callables.connectPlatformAlertChat(REQUEST()))
            .rejects.toMatchObject({ message: 'Open Telegram, send /start to @safehaul_alerts_bot, then press Connect chat again.' });
        expect(mockSettings.replaceSettings).not.toHaveBeenCalled();
    });

    it('saves a chat only once a message reached it, and returns its name, not its id', async () => {
        const response = await callables.connectPlatformAlertChat(REQUEST());

        expect(mockTelegram.sendMessage).toHaveBeenCalledWith(TOKEN, 222, expect.stringMatching(/уведомления подключены/));
        expect(mockSettings.replaceSettings.mock.calls[0][0].telegram).toMatchObject({
            botUsername: 'safehaul_alerts_bot', chatId: 222, chatTitle: 'Dana Alvarez',
        });
        expect(response).toEqual({ chat: { title: 'Dana Alvarez' } });
    });

    it('does not save a chat the bot could not write to', async () => {
        mockTelegram.sendMessage.mockRejectedValue(new TelegramError('blocked', 'Telegram refused the request (403).'));

        await expect(callables.connectPlatformAlertChat(REQUEST()))
            .rejects.toMatchObject({ message: expect.stringMatching(/Send \/start to the bot again/) });
        expect(mockSettings.replaceSettings).not.toHaveBeenCalled();
    });
});

describe('the test message and the status', () => {
    it('sends a test only to a connected chat', async () => {
        mockSettings.readBotToken.mockResolvedValue(TOKEN);
        mockSettings.readSettings.mockResolvedValue({ telegram: { botUsername: 'safehaul_alerts_bot' } });
        await expect(callables.sendPlatformAlertTest(REQUEST())).rejects.toMatchObject({ message: 'Connect the chat first.' });

        mockSettings.readSettings.mockResolvedValue({ telegram: { botUsername: 'safehaul_alerts_bot', chatId: 222 } });
        await expect(callables.sendPlatformAlertTest(REQUEST())).resolves.toEqual({ sent: true });
        expect(mockTelegram.sendMessage).toHaveBeenCalledWith(TOKEN, 222, expect.stringMatching(/тестовое сообщение/));
    });

    it('reports the connection and the checks without the chat id', async () => {
        mockSettings.readSettings.mockResolvedValue({
            telegram: { botUsername: 'safehaul_alerts_bot', chatId: 222, chatTitle: 'Dana Alvarez' },
            watch: {
                lastRunAt: '2026-08-02T15:40:00.000Z',
                checks: { vision: { status: 'down', since: '2026-08-02T14:40:00.000Z', detail: 'gemini=timeout' } },
                lastDeliveryError: null,
            },
        });

        const response = await callables.getPlatformAlerts(REQUEST());

        expect(response).toEqual({
            bot: { username: 'safehaul_alerts_bot' },
            chat: { title: 'Dana Alvarez' },
            watch: {
                lastRunAt: '2026-08-02T15:40:00.000Z',
                checks: { vision: { status: 'down', since: '2026-08-02T14:40:00.000Z' } },
                lastDeliveryError: null,
            },
        });
        expect(JSON.stringify(response)).not.toContain('222');
    });
});

describe('removing it all', () => {
    it('destroys the token and forgets the chat and what the watcher saw', async () => {
        await expect(callables.deletePlatformAlerts(REQUEST())).resolves.toEqual({ deleted: true });

        expect(mockSettings.destroyBotToken).toHaveBeenCalled();
        expect(mockSettings.replaceSettings).toHaveBeenCalledWith({ telegram: {}, watch: {} });
        expect(mockGuards.guardPrivileged).toHaveBeenCalledWith(expect.anything(), 'mutate', 'delete', expect.any(Object));
    });
});
