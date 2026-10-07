/**
 * The daily model check's job: which providers are due, what it saves, what it
 * tells the owner, and that two runs never overlap.
 *
 * The per-provider check (`ai/tasks/modelCheck.js`) has its own suite; here it
 * is a mock that returns what a test needs.
 */

jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: jest.fn((_opts, fn) => fn) }));

jest.mock('../../firebaseAdmin', () => {
    const stored = { data: {} };
    const ref = {
        set: async (patch) => { stored.data = { ...stored.data, ...patch }; },
    };
    const db = {
        collection: () => ({ doc: () => ref }),
        runTransaction: async (body) => body({
            get: async () => ({ exists: true, data: () => stored.data }),
            set: (_ref, patch) => { stored.data = { ...stored.data, ...patch }; },
        }),
    };
    return { db, admin: {}, mockLeaseDoc: stored };
});

const mockStore = { readAllConfigs: jest.fn(), resolveCredentials: jest.fn() };
jest.mock('../../ai/credentials/store', () => mockStore);
const mockSave = jest.fn();
jest.mock('../../ai/credentials/modelLists', () => ({ saveModelCheck: (...args) => mockSave(...args) }));
const mockCheck = jest.fn();
jest.mock('../../ai/tasks/modelCheck', () => ({ checkProvider: (...args) => mockCheck(...args) }));
const mockSettings = { readSettings: jest.fn(), readBotToken: jest.fn() };
jest.mock('../../ops/alertSettings', () => mockSettings);
const mockSend = jest.fn();
jest.mock('../../ops/telegram', () => ({ sendMessage: (...args) => mockSend(...args) }));

const { mockLeaseDoc } = require('../../firebaseAdmin');
const { runModelRefresh, dueReason, refreshAiModelLists } = require('../../ops/modelRefresh');
const { RESULT } = require('../../ai/tasks/modelVerification');

const HOUR = 60 * 60 * 1000;
// 08:25 UTC is 03:25 in Chicago (CDT): the daily hour.
const NIGHT = Date.parse('2026-10-08T08:25:00Z');
// 15:25 UTC is 10:25 in Chicago.
const DAY = Date.parse('2026-10-08T15:25:00Z');
const TOKEN = `${'1'.repeat(9)}:${'t'.repeat(35)}`;

const laneResult = (overrides = {}) => ({
    models: ['m1', 'm2'], previous: ['m1', 'm2'], dropped: [], added: [], status: 'ok', changed: false,
    results: [{ model: 'm1', result: RESULT.PASSED, category: null }], ...overrides,
});
const checked = (lanes, extra = {}) => ({ catalogue: 'ok', account: null, lanes, ...extra });
const configs = (byId) => new Map(Object.entries(byId));
const checkedLongAgo = { modelCheck: { fullCheckAt: new Date(DAY - 40 * HOUR).toISOString(), checkedAt: new Date(DAY - 40 * HOUR).toISOString() } };

beforeEach(() => {
    jest.resetAllMocks();
    mockLeaseDoc.data = {};
    mockStore.readAllConfigs.mockResolvedValue(configs({ gemini: { enabled: true, ...checkedLongAgo } }));
    mockStore.resolveCredentials.mockImplementation(async (id) => (id === 'gemini'
        ? { complete: true, values: { apiKey: 'k' }, unreadable: [] }
        : { complete: false, values: {}, unreadable: [] }));
    mockCheck.mockResolvedValue(checked({ vision: laneResult(), text: laneResult() }));
    mockSave.mockResolvedValue(undefined);
    mockSettings.readSettings.mockResolvedValue({ telegram: { chatId: 222 } });
    mockSettings.readBotToken.mockResolvedValue(TOKEN);
    mockSend.mockResolvedValue(undefined);
});

describe('when a provider is due', () => {
    const at = (hoursAgo, now = DAY) => new Date(now - hoursAgo * HOUR).toISOString();

    it('on its first run', () => {
        expect(dueReason({}, DAY)).toBe('first');
    });

    it('daily at about 03:25 in Chicago, and at any hour once 36 hours have passed', () => {
        expect(dueReason({ modelCheck: { fullCheckAt: at(21, NIGHT) } }, NIGHT)).toBe('daily');
        expect(dueReason({ modelCheck: { fullCheckAt: at(21), checkedAt: at(21) } }, DAY)).toBeNull();
        expect(dueReason({ modelCheck: { fullCheckAt: at(37), checkedAt: at(37) } }, DAY)).toBe('daily');
    });

    it('when the router saw a lane fail, at most every 6 hours', () => {
        const failing = { laneHealth: { vision: 'degraded', text: 'healthy' } };
        expect(dueReason({ ...failing, modelCheck: { fullCheckAt: at(10), checkedAt: at(7) } }, DAY)).toBe('failing');
        expect(dueReason({ ...failing, modelCheck: { fullCheckAt: at(10), checkedAt: at(2) } }, DAY)).toBeNull();
        expect(dueReason({ laneHealth: { vision: 'healthy' }, modelCheck: { fullCheckAt: at(10), checkedAt: at(7) } }, DAY)).toBeNull();
    });

    it('within the hour of a failure that began after the last check, however recent that check', () => {
        const check = { fullCheckAt: at(2), checkedAt: at(2) };
        // 03:25 check, 04:00 failure: looked at by the next run, not at 09:25.
        const began = (hoursAgo) => ({ laneHealth: { vision: 'degraded' }, laneFailedAt: { vision: DAY - hoursAgo * HOUR } });
        expect(dueReason({ ...began(1), modelCheck: check }, DAY)).toBe('failing');
        // One the last check already saw waits out the 6 hours.
        expect(dueReason({ ...began(3), modelCheck: check }, DAY)).toBeNull();
    });
});

describe('which providers it checks', () => {
    it('only enabled, configured providers that are due: never one switched off', async () => {
        mockStore.readAllConfigs.mockResolvedValue(configs({
            gemini: { enabled: true, ...checkedLongAgo },
            mistral: { enabled: false, ...checkedLongAgo },
            groq: { enabled: true, modelCheck: { fullCheckAt: new Date(DAY - HOUR).toISOString(), checkedAt: new Date(DAY - HOUR).toISOString() } },
        }));
        mockStore.resolveCredentials.mockResolvedValue({ complete: true, values: { apiKey: 'k' }, unreadable: [] });

        await runModelRefresh({ now: DAY });

        const asked = mockCheck.mock.calls.map(([params]) => params.provider.id);
        expect(asked).toContain('gemini');
        expect(asked).not.toContain('mistral');
        expect(asked).not.toContain('groq');
        expect(asked).not.toContain('github-models');
    });

    it('checks every enabled, configured provider when asked to, due or not', async () => {
        mockStore.readAllConfigs.mockResolvedValue(configs({ gemini: { enabled: true, modelCheck: { fullCheckAt: new Date(DAY).toISOString() } } }));

        await runModelRefresh({ now: DAY, force: true });

        expect(mockCheck).toHaveBeenCalledTimes(1);
        expect(mockSave.mock.calls[0][1].modelCheck).toMatchObject({ reason: 'requested', fullCheckAt: new Date(DAY).toISOString() });
    });
});

describe('what it saves', () => {
    it('saves a changed lane\'s list, and what it found for every lane', async () => {
        mockCheck.mockResolvedValue(checked({
            vision: laneResult({ models: ['m1', 'm3'], changed: true, dropped: [{ model: 'm2', result: RESULT.GONE }], added: ['m3'] }),
            text: laneResult(),
        }));

        await runModelRefresh({ now: DAY });

        const [providerId, record] = mockSave.mock.calls[0];
        expect(providerId).toBe('gemini');
        expect(record.modelLists).toEqual({ vision: { models: ['m1', 'm3'], verifiedAt: new Date(DAY).toISOString() } });
        expect(record.modelCheck.lanes.vision).toMatchObject({ status: 'ok', models: ['m1', 'm3'], suggested: null });
        expect(record.modelCheck.lanes.text).toMatchObject({ models: ['m1', 'm2'] });
        expect(record.modelCheck).toMatchObject({ checkedAt: new Date(DAY).toISOString(), reason: 'daily', account: null });
    });

    it('leaves what earlier checks found when a refused key stops the check before any lane', async () => {
        mockCheck.mockResolvedValue(checked({}, { catalogue: 'unauthorized', account: RESULT.KEY }));

        await runModelRefresh({ now: DAY });

        const [, record] = mockSave.mock.calls[0];
        expect(record.modelCheck).toMatchObject({ account: RESULT.KEY, catalogue: 'unauthorized' });
        expect(record.modelCheck).not.toHaveProperty('lanes');
    });

    it('with auto-select off, changes nothing and records the suggestion', async () => {
        mockLeaseDoc.data = { autoSelect: false };
        mockCheck.mockResolvedValue(checked({ vision: laneResult({ models: ['m3'], previous: ['m1'], changed: true, added: ['m3'] }) }));

        await runModelRefresh({ now: DAY });

        const [, record] = mockSave.mock.calls[0];
        expect(record.modelLists).toEqual({});
        expect(record.modelCheck.lanes.vision).toMatchObject({ models: ['m1'], suggested: ['m3'] });
        expect(mockSend.mock.calls[0][2]).toMatch(/предлагает m3, но автоподбор выключен/);
    });
});

describe('what it tells the owner', () => {
    it('sends one message for the run when a list changed', async () => {
        mockCheck.mockResolvedValue(checked({ vision: laneResult({ models: ['m1', 'm3'], changed: true, dropped: [{ model: 'm2', result: RESULT.GONE }], added: ['m3'] }) }));

        await runModelRefresh({ now: DAY });

        expect(mockSend).toHaveBeenCalledTimes(1);
        const text = mockSend.mock.calls[0][2];
        expect(text).toMatch(/Google Gemini, чтение фото и документов: теперь m1, m3\./);
        expect(text).toMatch(/Убрана m2: убрана или недоступна на вашем тарифе\./);
        expect(text).toMatch(/Добавлена m3: прошла проверку на выдуманных правах\./);
        expect(text).toMatch(/Делать ничего не нужно/);
    });

    it('says nothing while all is well', async () => {
        await runModelRefresh({ now: DAY });
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('says once that a lane stopped passing, and remembers it was told', async () => {
        mockCheck.mockResolvedValue(checked({
            vision: laneResult({ status: 'failing', results: [{ model: 'm1', result: RESULT.MISREAD }, { model: 'm2', result: RESULT.GONE }] }),
        }));

        await runModelRefresh({ now: DAY });

        expect(mockSend.mock.calls[0][2]).toMatch(/чтение фото и документов: не прошла проверку ни одна версия \(m1: неверно прочитала выдуманные права; m2: убрана/);
        expect(mockSave.mock.calls[0][1].modelCheck.notified).toMatchObject({ vision: 'failing' });

        // The next run finds it still failing: no second message.
        const { notified } = mockSave.mock.calls[0][1].modelCheck;
        mockSend.mockClear();
        mockStore.readAllConfigs.mockResolvedValue(configs({ gemini: { enabled: true, ...checkedLongAgo, modelCheck: { ...checkedLongAgo.modelCheck, notified } } }));
        await runModelRefresh({ now: DAY });
        expect(mockSend).not.toHaveBeenCalled();
    });

    it.each([
        [RESULT.KEY, /ключ не принимается\. Что сделать: Super Admin → AI Integrations → Google Gemini → замените ключ/],
        [RESULT.QUOTA, /закончился лимит или деньги на счёте/],
    ])('says what to do when the account fails (%s)', async (account, words) => {
        mockCheck.mockResolvedValue(checked({}, { account }));

        await runModelRefresh({ now: DAY });

        expect(mockSend.mock.calls[0][2]).toMatch(words);
    });

    it('works with no chat connected, and keeps the news for when one is', async () => {
        mockSettings.readSettings.mockResolvedValue({ telegram: {} });
        mockCheck.mockResolvedValue(checked({ vision: laneResult({ status: 'failing' }) }));

        const outcome = await runModelRefresh({ now: DAY });

        expect(outcome.delivered).toBe(false);
        expect(mockSend).not.toHaveBeenCalled();
        expect(mockSave).toHaveBeenCalledTimes(1);
        // Not told, so not marked as told.
        expect(mockSave.mock.calls[0][1].modelCheck.notified).toEqual({});
    });

    it('keeps a list change it could not send, and sends it with the next message', async () => {
        const change = laneResult({ models: ['m1', 'm3'], changed: true, dropped: [{ model: 'm2', result: RESULT.GONE }], added: ['m3'] });
        mockCheck.mockResolvedValue(checked({ vision: change }));
        mockSend.mockRejectedValue(new Error('telegram down'));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await runModelRefresh({ now: DAY });

        const kept = mockSave.mock.calls[0][1].modelCheck.pendingNews;
        expect(kept).toEqual([expect.stringMatching(/^🔄 Google Gemini, чтение фото и документов: теперь m1, m3\./)]);

        // The list is already saved, so the next check sees no change; the news still arrives.
        mockSend.mockReset();
        mockSend.mockResolvedValue(undefined);
        mockSave.mockClear();
        mockCheck.mockResolvedValue(checked({ vision: laneResult({ models: ['m1', 'm3'], previous: ['m1', 'm3'] }) }));
        mockStore.readAllConfigs.mockResolvedValue(configs({ gemini: { enabled: true, ...checkedLongAgo, modelCheck: { ...checkedLongAgo.modelCheck, pendingNews: kept } } }));
        await runModelRefresh({ now: DAY });

        expect(mockSend.mock.calls[0][2]).toMatch(/теперь m1, m3\./);
        expect(mockSave.mock.calls[0][1].modelCheck.pendingNews).toEqual([]);
        console.error.mockRestore();
    });

    it('tells a newly connected chat what is still wrong, though an earlier chat was told', async () => {
        mockSettings.readSettings.mockResolvedValue({ telegram: { chatId: 333, connectedAt: '2026-10-08T15:00:00.000Z' } });
        mockCheck.mockResolvedValue(checked({ vision: laneResult() }, { account: RESULT.KEY }));
        mockStore.readAllConfigs.mockResolvedValue(configs({ gemini: {
            enabled: true,
            ...checkedLongAgo,
            modelCheck: { ...checkedLongAgo.modelCheck, notified: { account: RESULT.KEY, text: 'failing', destination: '2026-10-01T00:00:00.000Z' } },
        } }));

        await runModelRefresh({ now: DAY });

        expect(mockSend.mock.calls[0][1]).toBe(333);
        expect(mockSend.mock.calls[0][2]).toMatch(/ключ не принимается/);
        // Every key is written, so the merge cannot keep what the old chat was told.
        expect(mockSave.mock.calls[0][1].modelCheck.notified).toEqual({
            account: RESULT.KEY, text: 'ok', destination: '2026-10-08T15:00:00.000Z',
        });
    });

    it('loses only the message when the settings or the bot token cannot be read: what the check found is saved', async () => {
        mockSettings.readBotToken.mockRejectedValue(Object.assign(new Error('unavailable'), { code: 14 }));
        mockCheck.mockResolvedValue(checked({ vision: laneResult({ status: 'failing' }) }));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const outcome = await runModelRefresh({ now: DAY });

        expect(outcome.delivered).toBe(false);
        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(mockSave.mock.calls[0][1].modelCheck).toMatchObject({ lanes: { vision: { status: 'failing' } }, notified: {} });
        expect(console.error.mock.calls[0][0]).toBe('[ops/modelRefresh] delivery failed code=14');

        mockSave.mockClear();
        mockSettings.readSettings.mockRejectedValue(Object.assign(new Error('unavailable'), { code: 14 }));
        await expect(runModelRefresh({ now: DAY })).resolves.toMatchObject({ delivered: false });
        expect(mockSave).toHaveBeenCalledTimes(1);
        console.error.mockRestore();
    });
});

describe('one run at a time', () => {
    it('does nothing while another run holds the lease', async () => {
        mockLeaseDoc.data = { leaseUntil: DAY + 60 * 1000 };

        await expect(runModelRefresh({ now: DAY })).resolves.toEqual({ skipped: 'running' });
        expect(mockCheck).not.toHaveBeenCalled();
    });

    it('releases the lease even when a check throws, and records the others', async () => {
        mockCheck.mockRejectedValue(new Error('boom'));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const outcome = await runModelRefresh({ now: DAY });

        expect(outcome.checked).toEqual(['gemini=error']);
        expect(mockLeaseDoc.data.leaseUntil).toBe(0);
        console.error.mockRestore();
    });

    it('runs from the schedule and logs a summary without message text', async () => {
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        await refreshAiModelLists();
        expect(log.mock.calls[0][0]).toMatch(/^\[ops\/modelRefresh\] /);
        log.mockRestore();
    });
});
