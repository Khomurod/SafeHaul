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
    replaceSettingsIf: jest.fn(),
};
jest.mock('../../ops/alertSettings', () => mockSettings);

const mockTelegram = { getBot: jest.fn(), startsOnLink: jest.fn(), sendMessage: jest.fn() };
jest.mock('../../ops/telegram', () => {
    const actual = jest.requireActual('../../ops/telegram');
    return {
        TOKEN_PATTERN: actual.TOKEN_PATTERN,
        TelegramError: actual.TelegramError,
        getBot: (...args) => mockTelegram.getBot(...args),
        startsOnLink: (...args) => mockTelegram.startsOnLink(...args),
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
    // The transaction, played against what `readSettings` holds; a write it makes
    // lands in `replaceSettings`, so every test reads one record of what was saved.
    mockSettings.replaceSettingsIf.mockImplementation(async (stillCurrent, buildPatch) => {
        const stored = await mockSettings.readSettings();
        if (!stillCurrent(stored)) return false;
        await mockSettings.replaceSettings(buildPatch(stored));
        return true;
    });
    mockTelegram.getBot.mockResolvedValue({ username: 'safehaul_alerts_bot', id: 1 });
    mockTelegram.startsOnLink.mockResolvedValue({ chat: { id: 222, title: 'Dana Alvarez' }, strayStart: false });
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

    it('stores a working token, names the bot, and forgets the old bot\'s chat and what the watcher told it', async () => {
        const response = await callables.savePlatformAlertToken(REQUEST({ token: `  ${TOKEN}  ` }));

        expect(mockSettings.writeBotToken).toHaveBeenCalledWith(TOKEN);
        expect(response).toEqual({ bot: { username: 'safehaul_alerts_bot' } });
        const [patch] = mockSettings.replaceSettings.mock.calls[0];
        expect(patch.telegram).toEqual({ botUsername: 'safehaul_alerts_bot', tokenSavedAt: expect.any(String) });
        // A check already down must reach the next chat as news, not as an unexplained recovery.
        expect(patch.watch).toEqual({});
        expect(everythingSaid(response)).not.toContain(TOKEN);
    });
});

describe('connecting the chat', () => {
    const MINUTE = 60 * 1000;
    const LATER = new Date(Date.now() + 10 * MINUTE).toISOString();
    const EARLIER = new Date(Date.now() - MINUTE).toISOString();
    const withPending = (pendingStart) => ({ telegram: { botUsername: 'safehaul_alerts_bot', pendingStart } });
    const NOT_YET = { chat: null, strayStart: false };
    const CHECK = () => REQUEST({ checkOnly: true });

    beforeEach(() => {
        mockSettings.readBotToken.mockResolvedValue(TOKEN);
        mockSettings.readSettings.mockResolvedValue({ telegram: { botUsername: 'safehaul_alerts_bot' } });
    });

    it('asks for the token first', async () => {
        mockSettings.readBotToken.mockResolvedValue(null);
        await expect(callables.connectPlatformAlertChat(REQUEST())).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('first hands out a one-time Start link, and connects nobody yet', async () => {
        const response = await callables.connectPlatformAlertChat(REQUEST());

        const { code, createdAt, expiresAt } = mockSettings.replaceSettings.mock.calls[0][0].telegram.pendingStart;
        expect(code).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
        expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
        expect(Date.parse(expiresAt) - Date.parse(createdAt)).toBe(15 * MINUTE);
        expect(response).toEqual({ pending: { link: `https://t.me/safehaul_alerts_bot?start=${code}`, expiresAt } });
        expect(mockTelegram.startsOnLink).not.toHaveBeenCalled();
        expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
    });

    it('connects only the chat that pressed Start on that link, and returns its name, not its id', async () => {
        const createdAt = new Date(Date.now() - 5 * MINUTE).toISOString();
        mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', createdAt, expiresAt: LATER }));

        const response = await callables.connectPlatformAlertChat(REQUEST());

        expect(mockTelegram.startsOnLink).toHaveBeenCalledWith(TOKEN, {
            code: 'CODE123', createdAt: Date.parse(createdAt), expiresAt: Date.parse(LATER),
        });
        expect(mockTelegram.sendMessage).toHaveBeenCalledWith(TOKEN, 222, expect.stringMatching(/уведомления подключены/));
        const [patch] = mockSettings.replaceSettings.mock.calls[0];
        expect(patch.telegram).toEqual({
            botUsername: 'safehaul_alerts_bot', chatId: 222, chatTitle: 'Dana Alvarez', connectedAt: expect.any(String),
        });
        // A new destination starts from "all well", so it hears about anything already down.
        expect(patch.watch).toEqual({});
        expect(response).toEqual({ chat: { title: 'Dana Alvarez' } });
    });

    it('dates a link saved before links carried their start from its expiry', async () => {
        mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', expiresAt: LATER }));
        mockTelegram.startsOnLink.mockResolvedValue(NOT_YET);

        await callables.connectPlatformAlertChat(REQUEST());

        expect(mockTelegram.startsOnLink).toHaveBeenCalledWith(TOKEN, {
            code: 'CODE123', createdAt: Date.parse(LATER) - 15 * MINUTE, expiresAt: Date.parse(LATER),
        });
    });

    it('keeps the same link while nobody has pressed Start on it', async () => {
        mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', expiresAt: LATER }));
        mockTelegram.startsOnLink.mockResolvedValue(NOT_YET);

        await expect(callables.connectPlatformAlertChat(REQUEST())).resolves.toEqual({
            pending: { link: 'https://t.me/safehaul_alerts_bot?start=CODE123', expiresAt: LATER },
        });
        expect(mockSettings.replaceSettings).not.toHaveBeenCalled();
    });

    it('says when Telegram heard a Start without the link\'s code', async () => {
        // The bot opened from search, or "/start" typed: Telegram shows the person "/start" either way.
        mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', expiresAt: LATER }));
        mockTelegram.startsOnLink.mockResolvedValue({ chat: null, strayStart: true });

        await expect(callables.connectPlatformAlertChat(REQUEST())).resolves.toEqual({
            pending: { link: 'https://t.me/safehaul_alerts_bot?start=CODE123', expiresAt: LATER },
            strayStart: true,
        });
    });

    it('connects a chat that pressed Start in time, even when asked after the link expired', async () => {
        // Start pressed at minute 14, the page asked at minute 16: the person did everything right.
        mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', expiresAt: EARLIER }));

        const response = await callables.connectPlatformAlertChat(REQUEST());

        expect(mockTelegram.startsOnLink).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ code: 'CODE123' }));
        expect(response).toEqual({ chat: { title: 'Dana Alvarez' } });
        expect(mockSettings.replaceSettings.mock.calls[0][0].telegram).not.toHaveProperty('pendingStart');
    });

    it('hands out a new link once the old one expired with no Start on it in time', async () => {
        mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', expiresAt: EARLIER }));
        mockTelegram.startsOnLink.mockResolvedValue(NOT_YET);

        const response = await callables.connectPlatformAlertChat(REQUEST());

        expect(response.pending.link).not.toContain('CODE123');
        expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
    });

    it('does not look for a Start older than Telegram keeps updates', async () => {
        const dayAgo = new Date(Date.now() - 25 * 60 * MINUTE).toISOString();
        mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', expiresAt: dayAgo }));

        const response = await callables.connectPlatformAlertChat(REQUEST());

        expect(mockTelegram.startsOnLink).not.toHaveBeenCalled();
        expect(response.pending.link).not.toContain('CODE123');
    });

    describe('when the page checks by itself', () => {
        it('needs no recent sign-in and spends a budget of its own, not the console\'s', async () => {
            mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', expiresAt: LATER }));
            mockTelegram.startsOnLink.mockResolvedValue(NOT_YET);

            await expect(callables.connectPlatformAlertChat(CHECK())).resolves.toEqual({
                pending: { link: 'https://t.me/safehaul_alerts_bot?start=CODE123', expiresAt: LATER },
            });
            expect(mockGuards.guardPrivileged).not.toHaveBeenCalled();
            expect(mockGuards.assertSuperAdmin).toHaveBeenCalledWith(expect.anything(), 'update', expect.any(Object));
            expect(mockGuards.assertWithinRateLimit)
                .toHaveBeenCalledWith(expect.anything(), 'list', 'update', expect.any(Object), 'telegram-start');
        });

        it('checks the caller before reading anything', async () => {
            mockGuards.assertSuperAdmin.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));

            await expect(callables.connectPlatformAlertChat(CHECK())).rejects.toThrow('denied');
            expect(mockSettings.readSettings).not.toHaveBeenCalled();
            expect(mockTelegram.startsOnLink).not.toHaveBeenCalled();
        });

        it('connects the chat once Start was pressed on the link', async () => {
            mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', expiresAt: LATER }));

            await expect(callables.connectPlatformAlertChat(CHECK())).resolves.toEqual({ chat: { title: 'Dana Alvarez' } });
            expect(mockTelegram.sendMessage).toHaveBeenCalledTimes(1);
            expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'update' }));
        });

        it('never hands out a link: an expired one with no Start in time just ends the wait', async () => {
            mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', expiresAt: EARLIER }));
            mockTelegram.startsOnLink.mockResolvedValue(NOT_YET);

            await expect(callables.connectPlatformAlertChat(CHECK())).resolves.toEqual({ pending: null });
            mockSettings.readSettings.mockResolvedValue({ telegram: { botUsername: 'safehaul_alerts_bot' } });
            await expect(callables.connectPlatformAlertChat(CHECK())).resolves.toEqual({ pending: null });
            expect(mockSettings.replaceSettings).not.toHaveBeenCalled();
        });
    });

    describe('when the settings change while a chat connects', () => {
        const CHANGED = /settings changed while the chat was connecting/;

        it('neither messages nor saves a chat once the link is no longer the stored one', async () => {
            // Read before the operator pressed Remove; checked again before the message.
            mockSettings.readSettings
                .mockResolvedValueOnce(withPending({ code: 'CODE123', expiresAt: LATER }))
                .mockResolvedValue({ telegram: {} });

            await expect(callables.connectPlatformAlertChat(CHECK())).rejects.toMatchObject({
                code: 'failed-precondition', message: expect.stringMatching(CHANGED),
            });
            expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
            expect(mockSettings.replaceSettings).not.toHaveBeenCalled();
        });

        it('does not write a stale connection over a token replaced during the message', async () => {
            mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', expiresAt: LATER }));
            // The transaction finds the replacement bot, with no link waiting.
            mockSettings.replaceSettingsIf.mockImplementation(async (stillCurrent) => (
                stillCurrent({ telegram: { botUsername: 'replacement_bot', tokenSavedAt: 'now' } })
            ));

            await expect(callables.connectPlatformAlertChat(REQUEST())).rejects.toMatchObject({
                message: expect.stringMatching(CHANGED),
            });
            expect(mockSettings.replaceSettings).not.toHaveBeenCalled();
            expect(mockRecordAuditEvent).not.toHaveBeenCalled();
        });

        it('builds the saved connection from what the transaction read', async () => {
            mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', expiresAt: LATER }));
            mockSettings.replaceSettingsIf.mockImplementation(async (stillCurrent, buildPatch) => {
                const stored = { telegram: { botUsername: 'safehaul_alerts_bot', tokenSavedAt: 'stored', pendingStart: { code: 'CODE123' } } };
                if (!stillCurrent(stored)) return false;
                await mockSettings.replaceSettings(buildPatch(stored));
                return true;
            });

            await callables.connectPlatformAlertChat(REQUEST());

            expect(mockSettings.replaceSettings.mock.calls[0][0].telegram).toEqual({
                botUsername: 'safehaul_alerts_bot', tokenSavedAt: 'stored', chatId: 222, chatTitle: 'Dana Alvarez', connectedAt: expect.any(String),
            });
        });
    });

    it('does not save a chat the bot could not write to', async () => {
        mockSettings.readSettings.mockResolvedValue(withPending({ code: 'CODE123', expiresAt: LATER }));
        mockTelegram.sendMessage.mockRejectedValue(new TelegramError('blocked', 'Telegram refused the request (403).'));

        await expect(callables.connectPlatformAlertChat(REQUEST()))
            .rejects.toMatchObject({ message: expect.stringMatching(/cannot write to that chat/) });
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
            pending: null,
            watch: {
                lastRunAt: '2026-08-02T15:40:00.000Z',
                checks: { vision: { status: 'down', since: '2026-08-02T14:40:00.000Z' } },
                lastDeliveryError: null,
            },
        });
        expect(JSON.stringify(response)).not.toContain('222');
    });

    it('keeps an unused Start link on screen until it expires', async () => {
        const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();
        mockSettings.readSettings.mockResolvedValue({ telegram: { botUsername: 'safehaul_alerts_bot', pendingStart: { code: 'CODE123', expiresAt } } });
        expect((await callables.getPlatformAlerts(REQUEST())).pending)
            .toEqual({ link: 'https://t.me/safehaul_alerts_bot?start=CODE123', expiresAt });

        mockSettings.readSettings.mockResolvedValue({ telegram: { botUsername: 'safehaul_alerts_bot', pendingStart: { code: 'CODE123', expiresAt: '2020-01-01T00:00:00.000Z' } } });
        expect((await callables.getPlatformAlerts(REQUEST())).pending).toBeNull();
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
