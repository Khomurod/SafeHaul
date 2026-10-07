/**
 * The model versions table's three callables: what the table shows, "check
 * now", and the auto-select switch.
 *
 * Pinned: each is guarded before it does anything (a mutation for the two that
 * can change what the router uses), the table shows the versions the router
 * really uses, a stored record only crosses the boundary through an allowlist,
 * and no credential value ever does.
 */

const mockHandlers = new Map();
jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((options, handler) => {
        const fn = typeof handler === 'function' ? handler : options;
        mockHandlers.set(fn, typeof handler === 'function' ? options : {});
        return fn;
    }),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
jest.mock('../../firebaseAdmin', () => ({ db: {}, admin: { firestore: { FieldValue: {} } } }));

const mockGuards = { assertSuperAdmin: jest.fn(), assertWithinRateLimit: jest.fn(), guardPrivileged: jest.fn() };
jest.mock('../../environmentVault/guards', () => mockGuards);
const mockAudit = jest.fn();
jest.mock('../../environmentVault/audit', () => ({
    ...jest.requireActual('../../environmentVault/audit'),
    recordAuditEvent: (...args) => mockAudit(...args),
}));
const mockStore = { readAllConfigs: jest.fn(), resolveCredentials: jest.fn() };
jest.mock('../../ai/credentials/store', () => mockStore);
jest.mock('../../ai/router/order', () => ({
    ...jest.requireActual('../../ai/router/order'),
    readProviderOrder: async () => [],
}));
const mockRefresh = { runModelRefresh: jest.fn(), readCheckState: jest.fn(), setAutoSelect: jest.fn() };
jest.mock('../../ops/modelRefresh', () => ({
    runModelRefresh: (...args) => mockRefresh.runModelRefresh(...args),
    readCheckState: (...args) => mockRefresh.readCheckState(...args),
    setAutoSelect: (...args) => mockRefresh.setAutoSelect(...args),
    // The real rule, so "not set up" here cannot drift from what the check skips.
    credentialsReady: (...args) => jest.requireActual('../../ops/modelRefresh').credentialsReady(...args),
}));

const aiCallables = require('../../ai/callables');
const { ACTIONS, RESULTS } = require('../../environmentVault/audit');
const { PROVIDERS, isRetired } = require('../../ai/registry/providers');
const { orderProviders } = jest.requireActual('../../ai/router/order');
const { CHECK_NOW_BUDGET_MS } = require('../../ai/callables/versions');

const CHECKED_AT = '2026-10-08T08:25:00.000Z';
const KEY_VALUE = 'k-not-a-real-key-1234';
const request = (data = {}) => ({ auth: { uid: 'super-1', token: { globalRole: 'super_admin' } }, data });
const row = (result, id) => result.providers.find((provider) => provider.id === id);
const lane = (providerRow, laneId) => providerRow.lanes.find((entry) => entry.id === laneId);

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGuards.assertSuperAdmin.mockResolvedValue(undefined);
    mockGuards.assertWithinRateLimit.mockResolvedValue(undefined);
    mockGuards.guardPrivileged.mockResolvedValue(undefined);
    mockAudit.mockResolvedValue(undefined);
    mockStore.readAllConfigs.mockResolvedValue(new Map(Object.entries({
        gemini: {
            enabled: true,
            modelLists: { vision: { models: ['gemini-3.7-flash', 'gemini-3.6-flash'] } },
            modelCheck: {
                checkedAt: CHECKED_AT,
                reason: 'daily',
                account: null,
                lanes: {
                    vision: {
                        status: 'ok',
                        results: [
                            { model: 'gemini-3.7-flash', result: 'passed' },
                            { model: 'gemini-3.6-flash', result: 'busy' },
                            { model: 'gemini-3.8-flash', result: 'misread' },
                        ],
                    },
                    text: { status: 'failing', suggested: null, results: [] },
                },
            },
        },
        mistral: { enabled: false },
        cerebras: {
            enabled: true,
            modelCheck: {
                checkedAt: 'not a date', reason: 'whenever', account: 'boom',
                lanes: { text: { status: 'weird', suggested: ['llama-x', 42, { model: 'y' }] } },
            },
        },
    })));
    mockStore.resolveCredentials.mockImplementation(async (id) => {
        if (id === 'openrouter') throw new Error('PERMISSION_DENIED projects/x/secrets/SAFEHAUL_AI_OPENROUTER_APIKEY');
        // Saved, but this runtime may not read it.
        if (id === 'sambanova') return { complete: false, values: {}, unreadable: ['apiKey'] };
        return ['gemini', 'mistral', 'cerebras'].includes(id)
            ? { complete: true, values: { apiKey: KEY_VALUE }, unreadable: [] }
            : { complete: false, values: {}, unreadable: [] };
    });
    mockRefresh.readCheckState.mockResolvedValue({ autoSelect: true, running: false, lastRunAt: CHECKED_AT });
    mockRefresh.runModelRefresh.mockResolvedValue({ checked: ['gemini=vision:ok,text:ok', 'cerebras=text:ok'], delivered: true, messageLines: 0 });
    mockRefresh.setAutoSelect.mockResolvedValue(undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('getAiModelVersions', () => {
    it('is a super-admin read under the list budget', async () => {
        await aiCallables.getAiModelVersions(request());

        expect(mockGuards.assertSuperAdmin).toHaveBeenCalledWith(expect.anything(), ACTIONS.LIST);
        expect(mockGuards.assertWithinRateLimit).toHaveBeenCalledWith(expect.anything(), 'list', ACTIONS.LIST);
        expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: ACTIONS.LIST, result: RESULTS.SUCCESS }));
    });

    it('reads nothing when the caller is refused', async () => {
        mockGuards.assertSuperAdmin.mockRejectedValue(Object.assign(new Error('Super Admin access is required.'), { code: 'permission-denied' }));

        await expect(aiCallables.getAiModelVersions(request())).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockStore.readAllConfigs).not.toHaveBeenCalled();
    });

    it('lists every unretired provider in routing order, with the check\'s own state', async () => {
        const result = await aiCallables.getAiModelVersions(request());

        const expected = orderProviders(PROVIDERS, []).filter((provider) => !isRetired(provider)).map((provider) => provider.id);
        expect(result.providers.map((provider) => provider.id)).toEqual(expected);
        expect(result.providers.map((provider) => provider.id)).not.toContain('github-models');
        expect(result).toMatchObject({ autoSelect: true, running: false, lastRunAt: CHECKED_AT });
    });

    it('shows the versions the router uses now, each with what the last check found', async () => {
        const gemini = row(await aiCallables.getAiModelVersions(request()), 'gemini');

        expect(gemini).toMatchObject({ state: 'ready', checkedAt: CHECKED_AT, reason: 'daily', account: null });
        // The saved list, not the built-in one; a candidate that failed is not a version in use.
        expect(lane(gemini, 'vision')).toEqual({
            id: 'vision',
            models: [{ id: 'gemini-3.7-flash', result: 'passed' }, { id: 'gemini-3.6-flash', result: 'busy' }],
            status: 'ok',
            suggested: null,
        });
        expect(lane(gemini, 'text')).toMatchObject({ status: 'failing' });
        expect(lane(gemini, 'text').models.length).toBeGreaterThan(0);
    });

    it('names a provider that is off, or that the check cannot run for', async () => {
        const result = await aiCallables.getAiModelVersions(request());

        expect(row(result, 'mistral').state).toBe('off');
        expect(row(result, 'groq').state).toBe('not_set_up');
        // A saved key this runtime cannot read needs a grant, not a new key, as in the provider list.
        expect(row(result, 'sambanova').state).toBe('key_unreadable');
        // A credential read that throws is that, for this row, not a failed table.
        expect(row(result, 'openrouter').state).toBe('key_unreadable');
    });

    it('shows only the lanes a provider serves', async () => {
        const cerebras = row(await aiCallables.getAiModelVersions(request()), 'cerebras');
        expect(cerebras.lanes.map((entry) => entry.id)).toEqual(['text']);
    });

    it('calls a lane chosen by hand since the last check what it is, not what that check found', async () => {
        mockStore.readAllConfigs.mockResolvedValue(new Map(Object.entries({
            openrouter: { enabled: true, textModel: 'my-org/my-model', modelCheck: { checkedAt: CHECKED_AT, lanes: { text: { status: 'ok' } } } },
        })));

        const openrouter = row(await aiCallables.getAiModelVersions(request()), 'openrouter');

        expect(lane(openrouter, 'text')).toMatchObject({ status: 'skipped', models: [{ id: 'my-org/my-model', result: null }] });
    });

    it('lets a stored record cross only through the allowlist', async () => {
        mockRefresh.readCheckState.mockResolvedValue({ autoSelect: false, running: false, lastRunAt: CHECKED_AT });

        const cerebras = row(await aiCallables.getAiModelVersions(request()), 'cerebras');

        expect(cerebras).toMatchObject({ checkedAt: null, reason: null, account: null });
        expect(lane(cerebras, 'text')).toMatchObject({ status: null, suggested: ['llama-x'] });
    });

    it('shows a suggestion only while auto-select is off', async () => {
        // Recorded while it was off; it is not a suggestion once the check applies what it finds.
        const cerebras = row(await aiCallables.getAiModelVersions(request()), 'cerebras');

        expect(lane(cerebras, 'text').suggested).toBeNull();
    });

    it('never returns a credential value or a vendor resource name', async () => {
        const text = JSON.stringify(await aiCallables.getAiModelVersions(request()));
        expect(text).not.toContain(KEY_VALUE);
        expect(text).not.toContain('SAFEHAUL_AI_');
    });
});

describe('checkAiModelVersionsNow', () => {
    it('is guarded as a mutation before anything runs', async () => {
        mockGuards.guardPrivileged.mockRejectedValue(Object.assign(new Error('REAUTH_REQUIRED'), { code: 'unauthenticated' }));

        await expect(aiCallables.checkAiModelVersionsNow(request())).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockGuards.guardPrivileged).toHaveBeenCalledWith(expect.anything(), 'mutate', ACTIONS.UPDATE, { setting: 'model-check' });
        expect(mockRefresh.runModelRefresh).not.toHaveBeenCalled();
    });

    it('runs the scheduled pass for every provider now, inside the function\'s 180 s', async () => {
        const result = await aiCallables.checkAiModelVersionsNow(request());

        expect(mockRefresh.runModelRefresh).toHaveBeenCalledWith({ force: true, budgetMs: CHECK_NOW_BUDGET_MS });
        expect(mockHandlers.get(aiCallables.checkAiModelVersionsNow)).toMatchObject({ timeoutSeconds: 180 });
        // The last test starts by the budget and ends within its own 25 s, leaving room to save and send.
        expect(CHECK_NOW_BUDGET_MS + 25 * 1000).toBeLessThan(160 * 1000);
        expect(result).toMatchObject({ skipped: null, checkedCount: 2, failedCount: 0, autoSelect: true });
        expect(result.providers.length).toBeGreaterThan(0);
        expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: ACTIONS.UPDATE,
            result: RESULTS.SUCCESS,
            metadata: expect.objectContaining({ setting: 'model-check', checkedCount: 2, failedCount: 0, reason: null }),
        }));
    });

    it('reports a provider whose check threw as failed, not as checked', async () => {
        mockRefresh.runModelRefresh.mockResolvedValue({ checked: ['gemini=error', 'mistral=vision:ok,text:ok'], errors: 1, delivered: true });

        const result = await aiCallables.checkAiModelVersionsNow(request());

        expect(result).toMatchObject({ skipped: null, checkedCount: 1, failedCount: 1 });
        expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
            result: RESULTS.FAILED, metadata: expect.objectContaining({ checkedCount: 1, failedCount: 1, reason: 'partial' }),
        }));
    });

    it('says so when a scheduled run already holds the lease', async () => {
        mockRefresh.runModelRefresh.mockResolvedValue({ skipped: 'running' });

        const result = await aiCallables.checkAiModelVersionsNow(request());

        expect(result).toMatchObject({ skipped: 'running', checkedCount: 0, failedCount: 0 });
        expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
            result: RESULTS.FAILED, metadata: expect.objectContaining({ reason: 'already-running' }),
        }));
    });

    it('answers a failure with the generic error, never its message', async () => {
        mockRefresh.runModelRefresh.mockRejectedValue(new Error('vendor said: SECRETVALUE'));

        const failure = await aiCallables.checkAiModelVersionsNow(request()).catch((error) => error);

        expect(failure).toMatchObject({ code: 'internal' });
        expect(failure.message).not.toMatch(/SECRETVALUE/);
    });
});

describe('setAiModelAutoSelect', () => {
    it('is guarded as a mutation, and refuses anything but true or false', async () => {
        await expect(aiCallables.setAiModelAutoSelect(request({ enabled: 'off' }))).rejects.toMatchObject({ code: 'invalid-argument' });

        expect(mockGuards.guardPrivileged).toHaveBeenCalledWith(expect.anything(), 'mutate', ACTIONS.UPDATE, {
            setting: 'model-auto-select', enabled: null,
        });
        expect(mockRefresh.setAutoSelect).not.toHaveBeenCalled();
    });

    it('switches it, records who did, and returns the table', async () => {
        mockRefresh.readCheckState.mockResolvedValue({ autoSelect: false, running: false, lastRunAt: CHECKED_AT });

        const result = await aiCallables.setAiModelAutoSelect(request({ enabled: false }));

        expect(mockRefresh.setAutoSelect).toHaveBeenCalledWith(false);
        expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: ACTIONS.UPDATE, metadata: expect.objectContaining({ setting: 'model-auto-select', enabled: false }),
        }));
        expect(result.autoSelect).toBe(false);
    });

    it('changes nothing when the caller is refused', async () => {
        mockGuards.guardPrivileged.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));

        await expect(aiCallables.setAiModelAutoSelect(request({ enabled: false }))).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockRefresh.setAutoSelect).not.toHaveBeenCalled();
    });

    it('maps a failed table read after the switch to the generic error', async () => {
        mockStore.readAllConfigs.mockRejectedValue(new Error('firestore unavailable'));

        await expect(aiCallables.setAiModelAutoSelect(request({ enabled: true }))).rejects.toMatchObject({ code: 'internal' });
        expect(mockRefresh.setAutoSelect).toHaveBeenCalledWith(true);
    });
});
