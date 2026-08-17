/**
 * Capability probes for the provider connection test.
 *
 * ## The defect these exist to prevent recurring
 *
 * The connection test used to send one constant prompt, with no schema and no
 * image, identically for every provider, and report success on any reply. That
 * is a test of the credential and nothing else, and `ai/registry/providers.js`
 * records what it cost in production: Groq's health check passed on plain text
 * while every schema-using task — article generation, topic selection, CDL
 * extraction, E-Doc placement — failed, because the pinned models rejected
 * `json_schema`. The console said healthy; the product was down.
 *
 * Two model pins in the vision lane were likewise retired by their vendors and
 * went unnoticed for months, because nothing ever asked a provider to look at an
 * image.
 *
 * So the assertions below are mostly about *failing correctly*: a provider that
 * answers text but not JSON, or accepts one image but not two, or returns a
 * schema-valid object without having read the image, must not be reported
 * healthy.
 *
 * Nothing here contacts a vendor. Every adapter takes an injected `fetchImpl`.
 */

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'ts', delete: () => 'del' } } },
    db: { collection: () => ({ doc: () => ({ set: jest.fn(), get: jest.fn() }) }) },
}));

const mockStore = {
    readConfig: jest.fn(),
    resolveCredentials: jest.fn(),
    recordTestResult: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../ai/credentials/store', () => mockStore);

const mockExecute = jest.fn();
jest.mock('../../ai/providers', () => ({
    getAdapter: (provider) => ({
        id: provider.adapter,
        execute: (context) => mockExecute(provider.id, context),
    }),
}));

const { testProviderConnection, PROBE_STATUS } = require('../../ai/tasks/healthCheck');
const { PROBES, RED_PNG, BLUE_PNG } = require('../../ai/tasks/healthProbes');
const { AiError } = require('../../ai/router/errors');

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

beforeEach(() => {
    jest.clearAllMocks();
    mockStore.readConfig.mockResolvedValue({ enabled: true, accountId: 'a'.repeat(32) });
    mockStore.resolveCredentials.mockResolvedValue({
        complete: true,
        values: { apiKey: 'k', apiToken: 't' },
        missing: [],
        source: 'secret-manager',
    });
    mockExecute.mockImplementation(healthyProvider);
});

describe('probes exercise what SafeHaul actually asks for', () => {
    it('runs a probe for every capability the provider declares', async () => {
        const result = await testProviderConnection('gemini');
        const probes = byId(result.capabilities);

        expect(result.success).toBe(true);
        // Gemini declares the full set, so nothing may be skipped.
        for (const probe of PROBES) {
            expect(probes[probe.id].status).toBe(PROBE_STATUS.PASSED);
        }
    });

    it('skips a capability the provider does not offer, and does not call it a failure', async () => {
        // Cloudflare is text-only. Reporting "failed vision" would read as
        // though something broke, when the provider simply does not offer it.
        const result = await testProviderConnection('cloudflare');
        const probes = byId(result.capabilities);

        expect(probes.vision_single.status).toBe(PROBE_STATUS.SKIPPED);
        expect(probes.vision_multi.status).toBe(PROBE_STATUS.SKIPPED);
        expect(result.success).toBe(true);
    });

    it('sends real images to a vision probe, and two of them to the multi-image probe', async () => {
        await testProviderConnection('gemini');

        const single = mockExecute.mock.calls.find(([, ctx]) => ctx.images?.length === 1)[1];
        const multi = mockExecute.mock.calls.find(([, ctx]) => ctx.images?.length === 2)[1];

        expect(single.images[0].dataUrl).toBe(RED_PNG);
        expect(multi.images.map((image) => image.dataUrl)).toEqual([RED_PNG, BLUE_PNG]);
    });

    it('tests the vision model, not the text model, for image probes', async () => {
        // The pins that rotted were the vision ones. A probe resolving the text
        // model would have kept reporting healthy throughout.
        await testProviderConnection('groq');

        const visionCall = mockExecute.mock.calls.find(([, ctx]) => ctx.images?.length === 1)[1];
        expect(visionCall.model).toBe('qwen/qwen3.6-27b');
    });
});

describe('failing correctly', () => {
    it('fails the provider when structured JSON is rejected but text works', async () => {
        // The exact production incident: plain text fine, every schema request
        // a 400, connection test green.
        mockExecute.mockImplementation((providerId, context) => {
            if (context.schema) {
                throw new AiError('provider_request_rejected', 'HTTP 400', { providerId, status: 400 });
            }
            return { text: 'ready', model: context.model };
        });

        const result = await testProviderConnection('groq');
        const probes = byId(result.capabilities);

        expect(probes.text.status).toBe(PROBE_STATUS.PASSED);
        expect(probes.structured_json.status).toBe(PROBE_STATUS.FAILED);
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/Structured JSON/);
    });

    it('fails when the vision model has been retired by the vendor', async () => {
        mockExecute.mockImplementation((providerId, context) => {
            if (context.images) {
                throw new AiError('model_unavailable', 'HTTP 404', { providerId, status: 404 });
            }
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('mistral');
        const probes = byId(result.capabilities);

        expect(probes.vision_single).toMatchObject({
            status: PROBE_STATUS.FAILED,
            category: 'model_unavailable',
        });
        expect(result.success).toBe(false);
    });

    it('fails a provider that returns the right shape without reading the image', async () => {
        // A schema-valid object is not evidence the model looked at anything.
        // This is the check that separates "answered" from "answered correctly".
        mockExecute.mockImplementation((providerId, context) => {
            if (context.images) return { text: '{"answer":"green"}', model: context.model };
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('gemini');
        const probes = byId(result.capabilities);

        expect(probes.vision_single.status).toBe(PROBE_STATUS.FAILED);
        expect(probes.vision_single.message).toMatch(/did not read the request correctly/);
    });

    it('fails a provider that only ever looks at the first image', async () => {
        // Answering "red" to a question about the second image means the second
        // image was dropped — which a naive "did it reply" check cannot see.
        mockExecute.mockImplementation((providerId, context) => {
            if (context.images?.length > 1) return { text: '{"answer":"red"}', model: context.model };
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('gemini');
        const probes = byId(result.capabilities);

        expect(probes.vision_single.status).toBe(PROBE_STATUS.PASSED);
        expect(probes.vision_multi.status).toBe(PROBE_STATUS.FAILED);
    });

    it('fails a verifier that rubber-stamps an unsupported claim', async () => {
        // The blog's fact-check stage is fail-closed: if it cannot run, nothing
        // publishes. A provider that approves everything is worse than one that
        // errors, so the probe uses a claim the source does not support.
        mockExecute.mockImplementation((providerId, context) => {
            if (context.schema?.properties?.supported) {
                return { text: '{"supported":true,"unsupportedClaims":[]}', model: context.model };
            }
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('gemini');

        expect(byId(result.capabilities).article_verification.status).toBe(PROBE_STATUS.FAILED);
    });

    it('validates structured output with SafeHaul own validator, not the vendor promise', async () => {
        mockExecute.mockImplementation((providerId, context) => {
            if (context.schema) return { text: '{"wrongKey":"red"}', model: context.model };
            return { text: 'ready', model: context.model };
        });

        const result = await testProviderConnection('gemini');

        expect(byId(result.capabilities).structured_json).toMatchObject({
            status: PROBE_STATUS.FAILED,
            category: 'schema_validation_failed',
        });
    });

    it('reports unparseable output as malformed rather than as a schema violation', async () => {
        mockExecute.mockImplementation((providerId, context) => (
            context.schema
                ? { text: 'I am afraid I cannot do that.', model: context.model }
                : { text: 'ready', model: context.model }
        ));

        const result = await testProviderConnection('gemini');

        expect(byId(result.capabilities).structured_json.category).toBe('malformed_response');
    });
});

describe('model pin reconciliation', () => {
    const { diagnoseModelPins } = require('../../ai/tasks/modelPins');

    /** A catalogue response in each vendor's own listing shape. */
    function catalogueReturning(idsByProvider) {
        return async (url) => {
            const providerId = Object.keys(idsByProvider).find((id) => url.includes(
                { gemini: 'generativelanguage', groq: 'api.groq', mistral: 'api.mistral' }[id] || id,
            ));
            const ids = idsByProvider[providerId];
            if (!ids) return { ok: false, status: 404, json: async () => ({}) };
            return {
                ok: true,
                status: 200,
                json: async () => (providerId === 'gemini'
                    ? { models: ids.map((id) => ({ name: `models/${id}` })) }
                    : { data: ids.map((id) => ({ id })) }),
            };
        };
    }

    it('reports a pin the vendor no longer lists as stale', async () => {
        // The exact shape of the failure that emptied the vision lane: the
        // credential works, the endpoint answers, and the model is simply gone.
        const result = await diagnoseModelPins({
            fetchImpl: catalogueReturning({ groq: ['openai/gpt-oss-20b'] }),
        });
        const groq = result.providers.find((entry) => entry.providerId === 'groq');

        expect(groq.status).toBe('stale');
        const visionPin = groq.pins.find((pin) => pin.model === 'qwen/qwen3.6-27b');
        expect(visionPin.present).toBe(false);
        expect(visionPin.capabilities).toEqual(expect.arrayContaining(['vision']));
        expect(result.stalePins).toBeGreaterThan(0);
    });

    it('reports every pin present as ok', async () => {
        const result = await diagnoseModelPins({
            fetchImpl: catalogueReturning({ groq: ['openai/gpt-oss-20b', 'qwen/qwen3.6-27b'] }),
        });

        expect(result.providers.find((entry) => entry.providerId === 'groq').status).toBe('ok');
    });

    it('tolerates a policy suffix the vendor does not list back', async () => {
        // Hugging Face accepts `openai/gpt-oss-120b:fastest`, where `:fastest`
        // selects a provider policy and is not part of the listed model id.
        const { catalogueContains } = require('../../ai/tasks/modelPins').__test;

        expect(catalogueContains(new Set(['openai/gpt-oss-120b']), 'openai/gpt-oss-120b:fastest')).toBe(true);
        expect(catalogueContains(new Set(['openai/gpt-oss-120b']), 'openai/gpt-oss-20b')).toBe(false);
    });

    it('says it could not check rather than inventing a verdict', async () => {
        const result = await diagnoseModelPins({
            fetchImpl: async () => { throw new Error('network down'); },
        });
        const gemini = result.providers.find((entry) => entry.providerId === 'gemini');

        // "unreachable" is the honest answer; "ok" and "stale" would both be lies.
        expect(gemini.status).toBe('unreachable');
        expect(gemini.pins).toEqual([]);

        // Cloudflare publishes no catalogue endpoint SafeHaul can read, and is
        // reported as unsupported rather than guessed at.
        const cloudflare = result.providers.find((entry) => entry.providerId === 'cloudflare');
        expect(cloudflare.status).toBe('unsupported');
    });

    it('skips an unconfigured provider instead of reporting it broken', async () => {
        mockStore.resolveCredentials.mockResolvedValue({ complete: false, values: {}, missing: ['apiKey'], source: null });

        const result = await diagnoseModelPins({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }) });

        expect(result.providers.find((entry) => entry.providerId === 'groq').status).toBe('unconfigured');
        expect(result.stalePins).toBe(0);
    });

    it('never returns a credential', async () => {
        const result = await diagnoseModelPins({
            fetchImpl: catalogueReturning({ groq: ['openai/gpt-oss-20b', 'qwen/qwen3.6-27b'] }),
        });

        expect(JSON.stringify(result)).not.toMatch(/apiKey|"k"|Bearer/);
    });
});

describe('safety and secrecy', () => {
    it('never sends anything but constant prompts and generated images', async () => {
        await testProviderConnection('gemini');

        const sent = JSON.stringify(mockExecute.mock.calls.map(([, context]) => ({
            inputText: context.inputText,
            systemInstructions: context.systemInstructions,
        })));
        // The article probes name a fictional body precisely so nothing in a
        // probe can be mistaken for real source material.
        expect(sent).toMatch(/Example Freight Authority/);
        expect(sent).not.toMatch(/FMCSA/);
        expect(sent).not.toMatch(/licence|license|CDL|driver/i);
    });

    it('never surfaces a vendor error body, which can quote the request back', async () => {
        mockExecute.mockImplementation((providerId) => {
            throw new AiError('provider_request_rejected', 'HTTP 400: prompt echoed SECRETVALUE', {
                providerId, status: 400,
            });
        });

        const result = await testProviderConnection('gemini');

        expect(JSON.stringify(result)).not.toMatch(/SECRETVALUE/);
    });

    it('refuses a retired provider before spending anything', async () => {
        const result = await testProviderConnection('github-models');

        expect(result.success).toBe(false);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('asks for credentials before probing, not after', async () => {
        mockStore.resolveCredentials.mockResolvedValue({ complete: false, values: {}, missing: ['apiKey'], source: null });

        const result = await testProviderConnection('gemini');

        expect(result).toMatchObject({ success: false, category: 'not_configured' });
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('keeps the response fields the existing console already reads', async () => {
        // `capabilities` is additive. Renaming or dropping any of these would
        // break a deployed browser that has not reloaded.
        const result = await testProviderConnection('gemini');

        expect(result).toEqual(expect.objectContaining({
            success: expect.any(Boolean),
            message: expect.any(String),
            model: expect.any(String),
            latencyMs: expect.any(Number),
            capabilities: expect.any(Array),
        }));
    });
});
