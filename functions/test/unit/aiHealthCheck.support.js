/**
 * Shared harness for the `aiHealthCheck.*` suites.
 *
 * `jest.mock` is hoisted per file and cannot be registered from here, so each
 * suite keeps its own one-line registration and the factory bodies live below.
 * Every factory returns the **same** object each call, so the doubles a suite
 * imports from here are the ones the code under test is talking to.
 *
 * No suite here queues a `*Once` value and none calls `jest.resetModules()`
 * (both checked before the split), so `resetHealthCheckState` keeps
 * `clearAllMocks`. If you add a `mockResolvedValueOnce`, switch it to
 * `resetAllMocks` and re-establish `recordTestResult` — `clearAllMocks` does not
 * drain a once-queue, and `resetAllMocks` wipes an implementation set at
 * definition time.
 */

const mockStore = {
    readConfig: jest.fn(),
    resolveCredentials: jest.fn(),
    recordTestResult: jest.fn().mockResolvedValue(undefined),
};

const mockExecute = jest.fn();

const firebaseAdminMock = () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'ts', delete: () => 'del' } } },
    db: { collection: () => ({ doc: () => ({ set: jest.fn(), get: jest.fn() }) }) },
});

/** The same object every call, so a suite and the code share one store. */
const credentialsStoreMock = () => mockStore;

const providersMock = () => ({
    getAdapter: (provider) => ({
        id: provider.adapter,
        execute: (context) => mockExecute(provider.id, context),
    }),
});

/** Answers whatever each probe is asking for, correctly. */
function healthyProvider(providerId, context) {
    const { schema, images, inputText } = context;
    if (!schema) return { text: 'ready', model: context.model };
    if (schema.properties?.supported) {
        return { text: '{"supported":false,"unsupportedClaims":["forty sites nationwide"]}', model: context.model };
    }
    if (schema.properties?.title) {
        return {
            text: '{"title":"Example Freight Authority extends pilot depot hours","summary":"The authority said pilot depot hours will extend to 22:00 at three sites."}',
            model: context.model,
        };
    }
    if (images?.length > 1) return { text: '{"answer":"blue"}', model: context.model };
    if (images?.length === 1) return { text: '{"answer":"red"}', model: context.model };
    if (/midday sky/.test(inputText)) return { text: '{"answer":"blue"}', model: context.model };
    return { text: '{"answer":"unknown"}', model: context.model };
}

function byId(capabilities) {
    return Object.fromEntries(capabilities.map((entry) => [entry.id, entry]));
}

/** The original `beforeEach` body, unchanged. */
function resetHealthCheckState() {
    jest.clearAllMocks();
    mockStore.readConfig.mockResolvedValue({ enabled: true, accountId: 'a'.repeat(32) });
    mockStore.resolveCredentials.mockResolvedValue({
        complete: true,
        values: { apiKey: 'k', apiToken: 't' },
        missing: [],
        source: 'secret-manager',
    });
    mockExecute.mockImplementation(healthyProvider);
}

module.exports = {
    firebaseAdminMock,
    credentialsStoreMock,
    providersMock,
    mockStore,
    mockExecute,
    healthyProvider,
    byId,
    resetHealthCheckState,
};
