/**
 * Shared harness for the `aiProviders.*` suites.
 *
 * `fetch` is always injected, so no test in these files — or anywhere in this
 * repository — contacts a real provider. These suites are the reason the router
 * can trust its adapters: they pin the endpoint, the authorization header, the
 * structured-output mechanism and the response envelope for each vendor
 * independently.
 *
 * `jest.mock` is hoisted per file and cannot be registered from here, so each
 * suite keeps its own one-line registration and the factory body lives below.
 *
 * No suite here queues a `*Once` value and none has a `beforeEach`: every helper
 * below returns fresh state per call, which is what makes that safe.
 */

const firebaseAdminMock = () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'ts', delete: () => 'del' } } },
    db: { collection: () => ({ add: jest.fn(), doc: () => ({ set: jest.fn(), get: jest.fn() }) }) },
});

const SCHEMA = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
};

/** Records the single request an adapter makes and replies with a fixed body. */
function fetchReturning(body, { ok = true, status = 200 } = {}) {
    const calls = [];
    const impl = async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return {
            ok,
            status,
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    };
    impl.calls = calls;
    return impl;
}

/**
 * The registry is required lazily. This module is loaded from a hoisted
 * `jest.mock` factory, which runs *while* a suite is requiring
 * `../../ai/providers` — so a top-level require here can reach the registry
 * mid-construction.
 */
function contextFor(providerId, overrides = {}) {
    const { getProvider } = require('../../ai/registry/providers');
    const { CAPABILITIES } = require('../../ai/registry/capabilities');
    const provider = getProvider(providerId);
    return {
        provider,
        capability: CAPABILITIES.TEXT,
        model: 'test/model',
        systemInstructions: 'Be terse.',
        inputText: 'What is the answer?',
        images: null,
        schema: null,
        schemaName: 'safehaul_test',
        temperature: 0,
        maxOutputTokens: 128,
        timeoutMs: 5000,
        parentSignal: undefined,
        credentials: { apiKey: 'test-key', apiToken: 'test-token', token: 'test-gh-token' },
        config: { accountId: 'a'.repeat(32) },
        ...overrides,
    };
}

const OPENAI_BODY = { choices: [{ message: { content: '{"answer":"42"}', role: 'assistant' } }] };

/**
 * Gemini fixtures **captured verbatim from the live API** on 2026-08-03 against
 * `gemini-3.6-flash`, trimmed of ids and timings.
 *
 * This matters more than it looks. The original version of this group invented
 * its fixtures from the adapter's own assumptions — it asserted an `output_text`
 * field and a `parts`/`inline_data` request shape. The API returns neither. So
 * the tests passed, the adapter shipped, and *every* Gemini call failed in
 * production: text, structured JSON and vision alike. A test that asserts the
 * code's beliefs back to it cannot catch the code being wrong about the world.
 *
 * Anything added here must come from a recorded real response, not from reading
 * the adapter.
 */
const GEMINI_TEXT_RESPONSE = Object.freeze({
    status: 'completed',
    object: 'interaction',
    model: 'gemini-3.6-flash',
    usage: { total_output_tokens: 1, total_thought_tokens: 83 },
    steps: [
        // Private reasoning: no `content`, only an opaque signature.
        { type: 'thought', signature: 'EooDCocDARFNMg/8eBgcqFu4y7IZjWfHObLKleRTxSyT' },
        { type: 'model_output', content: [{ type: 'text', text: 'hello' }] },
    ],
});

/** A reply that ran out of budget mid-turn: no text, and `status: incomplete`. */
const GEMINI_TRUNCATED_RESPONSE = Object.freeze({
    status: 'incomplete',
    object: 'interaction',
    model: 'gemini-3.6-flash',
    usage: { total_output_tokens: 0, total_thought_tokens: 13 },
});

module.exports = {
    firebaseAdminMock,
    SCHEMA,
    fetchReturning,
    contextFor,
    OPENAI_BODY,
    GEMINI_TEXT_RESPONSE,
    GEMINI_TRUNCATED_RESPONSE,
};
