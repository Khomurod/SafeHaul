/**
 * Shared harness for the `aiRouter.*` suites.
 *
 * These are the load-bearing guarantees of the whole AI platform, so they are
 * asserted directly rather than inferred from a feature test. Nothing here
 * touches a network: every provider is a fake adapter, and the credential and
 * config stores are mocked.
 *
 * ## Why the mocks are factories rather than `jest.mock` calls
 *
 * `jest.mock` is hoisted to the top of the file it appears in, so it cannot be
 * moved into a helper module and still register. Each suite therefore keeps its
 * own one-line `jest.mock(path, () => require('./aiRouter.support').xMock())`
 * and the *body* lives here. Each factory returns the **same** object every
 * call, so `mockStore` and the spies a suite imports from here are the very ones
 * the router is talking to.
 *
 * ## This file DOES queue `*Once` values, so the reset is `resetAllMocks`
 *
 * `AGENTS.md` records that `clearAllMocks` does NOT drain a `*Once` queue, and
 * that splitting a file changes test ordering — the timing that makes such a
 * leak surface. The original queued two `mockResolvedValueOnce` values, so
 * `resetAiRouterState` uses **`resetAllMocks`** and re-establishes every
 * implementation immediately afterwards, including the two set at definition
 * time (`mockRecordTelemetry` and `recordProviderOutcome`) which `clearAllMocks`
 * would have left in place. Do not weaken it back.
 */

/**
 * The doubles survive `jest.resetModules()`, and they have to.
 *
 * `refuses to route at all when config is unreadable and nothing is cached`
 * calls `jest.resetModules()` to get a cold router. That clears the registry
 * entry for THIS module too, so the next `jest.mock` factory would load a second
 * copy of it with a second `mockStore` — and the one the test is holding would
 * no longer be the one the router talks to. In the original single file this
 * could not happen: the factory was a closure over a `const` in the test file,
 * which `resetModules` does not re-execute.
 *
 * Hanging them off the realm's global keeps one set per test file. Jest gives
 * every test file its own global object, so this is isolation, not sharing.
 */
const HARNESS = Symbol.for('safehaul.test.aiRouter.harness');
const shared = globalThis[HARNESS] || (globalThis[HARNESS] = {
    // Telemetry writes are asserted separately; here they must simply never
    // throw and never receive anything sensitive.
    mockRecordTelemetry: jest.fn().mockResolvedValue(undefined),
    mockExecute: jest.fn(),
    mockStore: {
        readAllConfigs: jest.fn(),
        resolveCredentials: jest.fn(),
        recordProviderOutcome: jest.fn().mockResolvedValue(undefined),
        // Lazily, and NOT `jest.requireActual(...).cooldownState` at module
        // load: that require pulls in `../../firebaseAdmin`, whose mock factory
        // requires this module — which is still mid-load, so its exports are not
        // there yet. Deferring to call time breaks the cycle and keeps the real
        // implementation.
        cooldownState: (...args) => jest.requireActual('../../ai/credentials/store').cooldownState(...args),
    },
});

const { mockRecordTelemetry, mockExecute, mockStore } = shared;

const firebaseAdminMock = () => ({
    admin: {
        firestore: {
            FieldValue: {
                serverTimestamp: () => 'ts',
                delete: () => 'delete',
            },
        },
    },
    db: { collection: () => ({ add: jest.fn(), doc: () => ({ set: jest.fn(), get: jest.fn() }) }) },
});

const telemetryMock = () => ({
    // Only the *write* is faked. `describeTaskInput` and the attempt cap are
    // real, because what they produce is exactly what these tests assert about
    // — a request description built from shape rather than content, and a
    // bounded attempts array.
    ...jest.requireActual('../../ai/telemetry/record'),
    recordAiTelemetry: (...args) => mockRecordTelemetry(...args),
});

/** The same object every call, so a suite and the router share one store. */
const credentialsStoreMock = () => mockStore;

const providersMock = () => ({
    getAdapter: (provider) => ({
        id: provider.adapter,
        execute: (context) => mockExecute(provider.id, context),
    }),
});

/**
 * The registry and the task contract are required lazily below. This module is
 * loaded from a hoisted `jest.mock` factory, which runs *while* a suite is
 * requiring `../../ai/router/router` — so a top-level require here would reach
 * those modules mid-construction.
 */

/** Every provider configured, enabled, no cooldown. */
function allConfigured(overrides = {}) {
    const { PROVIDERS } = require('../../ai/registry/providers');
    const configs = new Map();
    for (const provider of PROVIDERS) {
        configs.set(provider.id, {
            enabled: true,
            // Cloudflare needs a valid-looking account id to be eligible.
            accountId: 'a'.repeat(32),
            textModel: 'test/model',
            visionModel: 'test/vision-model',
            ...(overrides[provider.id] || {}),
        });
    }
    return configs;
}

function textTask(extra = {}) {
    const { CAPABILITIES } = require('../../ai/registry/capabilities');
    const { TASK_TYPES, PRIVACY, defineTask } = require('../../ai/tasks/contract');
    return defineTask({
        taskType: TASK_TYPES.ARTICLE_GENERATION,
        capabilities: [CAPABILITIES.TEXT],
        inputText: 'Write something.',
        privacy: PRIVACY.PUBLIC,
        ...extra,
    });
}

function visionTask() {
    const { CAPABILITIES } = require('../../ai/registry/capabilities');
    const { TASK_TYPES, PRIVACY, defineTask } = require('../../ai/tasks/contract');
    return defineTask({
        taskType: TASK_TYPES.CDL_EXTRACTION,
        capabilities: [CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON],
        inputText: 'Read this.',
        images: [{ dataUrl: 'data:image/png;base64,AAAA' }],
        outputSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
        },
        privacy: PRIVACY.RESTRICTED,
    });
}

/**
 * The original `beforeEach`, with `clearAllMocks` replaced by `resetAllMocks`
 * and the two definition-time implementations re-established — see the note at
 * the top of this file. Everything after those three lines is the original body.
 */
function resetAiRouterState() {
    jest.resetAllMocks();
    mockRecordTelemetry.mockResolvedValue(undefined);
    mockStore.recordProviderOutcome.mockResolvedValue(undefined);
    mockStore.readAllConfigs.mockResolvedValue(allConfigured());
    mockStore.resolveCredentials.mockResolvedValue({
        complete: true,
        values: { apiKey: 'k', apiToken: 't', token: 'g' },
        missing: [],
        source: 'secret-manager',
    });
    mockExecute.mockResolvedValue({ text: 'ok', model: 'test/model' });
}

module.exports = {
    firebaseAdminMock,
    telemetryMock,
    credentialsStoreMock,
    providersMock,
    mockRecordTelemetry,
    mockStore,
    mockExecute,
    allConfigured,
    textTask,
    visionTask,
    resetAiRouterState,
};
