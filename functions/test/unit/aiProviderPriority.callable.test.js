/**
 * Behaviour contract for `setAiProviderPriority` and the routing summary
 * `listAiProviders` now returns.
 *
 * This callable decides which AI vendor every request in the platform reaches
 * first, so it is guarded exactly as the credential callables are, and these
 * tests assert that rather than assume it: exact Super Admin, recent
 * authentication, the fail-closed mutate budget, registry-validated ids, and a
 * value-free audit record.
 *
 * The other property proven here is the one the feature would be dangerous
 * without: rejecting a bad list rather than silently storing part of it. A
 * write that quietly dropped an unrecognised id would shrink the routing order
 * without telling anybody.
 *
 * No real credential appears anywhere; Secret Manager is replaced outright.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({
    admin: mock.admin,
    db: mock.db,
    auth: mock.admin.auth(),
    storage: {},
}));

// The real module lazily loads the Google client on first read. Nothing in
// these tests is about credential storage, and a test suite must never be one
// misconfiguration away from a live Secret Manager call.
jest.mock('../../ai/credentials/secretManager', () => ({
    SECRET_PREFIX: 'SAFEHAUL_AI_',
    buildSecretId: (providerId, field) => `SAFEHAUL_AI_${String(providerId).toUpperCase()}_${String(field).toUpperCase()}`,
    readSecret: jest.fn().mockResolvedValue(null),
    writeSecret: jest.fn().mockResolvedValue({ secretId: 'SAFEHAUL_AI_TEST', valueLength: 0 }),
    destroySecretVersions: jest.fn().mockResolvedValue({ secretId: 'SAFEHAUL_AI_TEST', destroyed: 0 }),
    clearCache: jest.fn(),
}));

const aiCallables = require('../../ai/callables');
const { AUDIT_COLLECTION } = require('../../environmentVault/audit');
const { DEFAULT_FALLBACK_ORDER } = require('../../ai/registry/providers');
const { COLLECTION: ROUTING_COLLECTION, ORDER_DOC } = require('../../ai/router/order');

const ORDER_PATH = `${ROUTING_COLLECTION}/${ORDER_DOC}`;
const nowSeconds = () => Math.floor(Date.now() / 1000);

const superAdmin = (overrides = {}) => ({
    uid: 'super-1',
    token: { globalRole: 'super_admin', email: 'ops@example.test', auth_time: nowSeconds(), ...overrides },
});

const request = (auth, data = {}) => ({ auth, data });

const auditRecords = () => [...mock.docs.entries()]
    .filter(([path]) => path.startsWith(`${AUDIT_COLLECTION}/`))
    .map(([, data]) => data);

beforeEach(() => {
    mock.reset({});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('authorization', () => {
    const data = { providerIds: ['mistral', 'gemini'] };

    it('rejects an unauthenticated caller', async () => {
        await expect(aiCallables.setAiProviderPriority(request(null, data)))
            .rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mock.docs.has(ORDER_PATH)).toBe(false);
    });

    it('rejects an ordinary signed-in user', async () => {
        const auth = { uid: 'user-1', token: { auth_time: nowSeconds() } };
        await expect(aiCallables.setAiProviderPriority(request(auth, data)))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect(mock.docs.has(ORDER_PATH)).toBe(false);
    });

    it('rejects a company admin rather than degrading their access', async () => {
        const auth = { uid: 'admin-1', token: { roles: { 'co-alpha': 'company_admin' }, auth_time: nowSeconds() } };
        await expect(aiCallables.setAiProviderPriority(request(auth, data)))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect(mock.docs.has(ORDER_PATH)).toBe(false);
    });

    it('requires recent authentication, with the contract the frontend keys off', async () => {
        const stale = superAdmin({ auth_time: nowSeconds() - (60 * 60) });
        await expect(aiCallables.setAiProviderPriority(request(stale, data)))
            .rejects.toMatchObject({
                code: 'failed-precondition',
                message: expect.stringContaining('REAUTH_REQUIRED'),
            });
        expect(mock.docs.has(ORDER_PATH)).toBe(false);
    });

    it('enforces the mutate rate limit', async () => {
        // The mutate budget is 10 per 300s and it fails closed.
        for (let i = 0; i < 10; i += 1) {
            await aiCallables.setAiProviderPriority(request(superAdmin(), data));
        }

        await expect(aiCallables.setAiProviderPriority(request(superAdmin(), data)))
            .rejects.toMatchObject({ code: 'resource-exhausted' });
    });

    it('records a value-free denial', async () => {
        const auth = { uid: 'user-1', token: { auth_time: nowSeconds() } };
        await expect(aiCallables.setAiProviderPriority(request(auth, data)))
            .rejects.toMatchObject({ code: 'permission-denied' });

        const records = auditRecords();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            action: 'update',
            result: 'denied',
            reason: 'not-super-admin',
            setting: 'routing-order',
        });
    });
});

describe('validation', () => {
    it.each([
        ['a missing list', undefined],
        ['a string', 'mistral,gemini'],
        ['an object', { 0: 'mistral' }],
        ['a number', 3],
    ])('rejects %s', async (_label, providerIds) => {
        await expect(aiCallables.setAiProviderPriority(request(superAdmin(), { providerIds })))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mock.docs.has(ORDER_PATH)).toBe(false);
    });

    it('rejects an unregistered provider id rather than dropping it', async () => {
        // Silently discarding it would shorten the routing order without the
        // operator being told, which is a real change in behaviour.
        await expect(aiCallables.setAiProviderPriority(
            request(superAdmin(), { providerIds: ['mistral', 'openai', 'gemini'] }),
        )).rejects.toMatchObject({ code: 'not-found' });

        expect(mock.docs.has(ORDER_PATH)).toBe(false);
    });

    it('rejects a repeated provider id', async () => {
        await expect(aiCallables.setAiProviderPriority(
            request(superAdmin(), { providerIds: ['mistral', 'mistral'] }),
        )).rejects.toMatchObject({ code: 'invalid-argument' });

        expect(mock.docs.has(ORDER_PATH)).toBe(false);
    });

    it('rejects a list longer than the registry', async () => {
        const providerIds = [...DEFAULT_FALLBACK_ORDER, 'gemini'];
        await expect(aiCallables.setAiProviderPriority(request(superAdmin(), { providerIds })))
            .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('accepts the retired provider, because the list stays complete', async () => {
        // Rejecting it would make the screen — which lists all nine rows —
        // impossible to save. The router still skips it as `retired`.
        const result = await aiCallables.setAiProviderPriority(
            request(superAdmin(), { providerIds: ['github-models', 'gemini'] }),
        );

        expect(result.order[0]).toBe('github-models');
    });
});

describe('writing the order', () => {
    it('stores one document, not one per provider', async () => {
        await aiCallables.setAiProviderPriority(
            request(superAdmin(), { providerIds: ['mistral', 'gemini', 'groq'] }),
        );

        const written = [...mock.docs.keys()].filter((path) => path.startsWith(`${ROUTING_COLLECTION}/`));
        expect(written).toEqual([ORDER_PATH]);
        expect(mock.docs.get(ORDER_PATH).providerIds).toEqual(['mistral', 'gemini', 'groq']);
        expect(mock.docs.get(ORDER_PATH).updatedBy).toBe('super-1');
    });

    it('returns the effective order, with unranked providers appended', async () => {
        const result = await aiCallables.setAiProviderPriority(
            request(superAdmin(), { providerIds: ['mistral'] }),
        );

        expect(result.saved).toBe(true);
        expect(result.order[0]).toBe('mistral');
        expect(result.order).toHaveLength(DEFAULT_FALLBACK_ORDER.length);
        expect(result.order.slice(1)).toEqual(
            DEFAULT_FALLBACK_ORDER.filter((id) => id !== 'mistral'),
        );
    });

    it('replaces a previous order rather than merging into it', async () => {
        await aiCallables.setAiProviderPriority(
            request(superAdmin(), { providerIds: ['mistral', 'gemini', 'groq'] }),
        );
        await aiCallables.setAiProviderPriority(
            request(superAdmin(), { providerIds: ['groq'] }),
        );

        expect(mock.docs.get(ORDER_PATH).providerIds).toEqual(['groq']);
    });

    it('writes an audit record naming the actor and the order, and no value', async () => {
        await aiCallables.setAiProviderPriority(
            request(superAdmin(), { providerIds: ['mistral', 'gemini'] }),
        );

        const records = auditRecords();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            actorUid: 'super-1',
            actorEmail: 'ops@example.test',
            action: 'update',
            result: 'success',
            setting: 'routing-order',
            entryCount: 2,
            providerOrder: 'mistral,gemini',
        });
    });
});

describe('listAiProviders routing summary', () => {
    const list = () => aiCallables.listAiProviders(request(superAdmin()));

    it('reports the registry default when nothing has been stored', async () => {
        const result = await list();

        expect(result.routing.usingDefaultOrder).toBe(true);
        expect(result.routing.order).toEqual(DEFAULT_FALLBACK_ORDER);
        expect(result.providers.map((row) => row.id)).toEqual(DEFAULT_FALLBACK_ORDER);
    });

    it('lists providers in the stored order and ranks them by it', async () => {
        await aiCallables.setAiProviderPriority(
            request(superAdmin(), { providerIds: ['mistral', 'gemini'] }),
        );

        const result = await list();

        expect(result.routing.usingDefaultOrder).toBe(false);
        expect(result.providers.map((row) => row.id).slice(0, 2)).toEqual(['mistral', 'gemini']);
        expect(result.providers[0]).toMatchObject({ id: 'mistral', rank: 1, priority: 5 });
        expect(result.providers.map((row) => row.rank))
            .toEqual(result.providers.map((_row, index) => index + 1));
    });

    it('explains, per kind of task, why a provider is skipped', async () => {
        const result = await list();
        const vision = result.routing.lanes.find((lane) => lane.id === 'vision');
        const text = result.routing.lanes.find((lane) => lane.id === 'text');

        expect(text).toBeTruthy();
        // Nothing is configured in this suite, so text providers report the
        // configuration gap rather than a capability one.
        expect(text.providers.every((row) => !row.eligible)).toBe(true);

        // Capability is checked before configuration, so the providers with no
        // vision models say so specifically — which is the question a bare rank
        // cannot answer.
        const reasons = Object.fromEntries(vision.providers.map((row) => [row.providerId, row.reason]));
        expect(reasons.groq).toBe('incapable');
        expect(reasons.cerebras).toBe('incapable');
        expect(reasons.sambanova).toBe('incapable');
        expect(reasons.cloudflare).toBe('incapable');
        expect(reasons['github-models']).toBe('retired');
        expect(reasons.gemini).toBe('unconfigured');
    });

    it('reports the lanes in the effective order too', async () => {
        await aiCallables.setAiProviderPriority(
            request(superAdmin(), { providerIds: ['huggingface'] }),
        );

        const result = await list();
        for (const lane of result.routing.lanes) {
            expect(lane.providers[0].providerId).toBe('huggingface');
        }
    });
});
