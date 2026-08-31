/**
 * Model pin reconciliation, and why a throttled diagnostic is not a failed
 * capability.
 *
 * Part of the `aiHealthCheck` suite. The provider fake, the credential store
 * double, the healthy-answer generator and the reset are in
 * `aiHealthCheck.support.js`. Each `jest.mock` below has to stay in this file,
 * because Jest hoists it per file and cannot register one from a helper.
 */

jest.mock('../../firebaseAdmin', () => require('./aiHealthCheck.support').firebaseAdminMock());
jest.mock('../../ai/credentials/store', () => require('./aiHealthCheck.support').credentialsStoreMock());
jest.mock('../../ai/providers', () => require('./aiHealthCheck.support').providersMock());

const { testProviderConnection, PROBE_STATUS } = require('../../ai/tasks/healthCheck');
const { AiError } = require('../../ai/router/errors');
const {
    mockStore, mockExecute, healthyProvider, resetHealthCheckState,
} = require('./aiHealthCheck.support');

beforeEach(resetHealthCheckState);

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

/**
 * A diagnostic must be able to say "I did not learn anything", and it must not
 * dress that up as either a pass or a failure.
 *
 * Measured against the live vendors on 2026-08-18: a two-image probe against
 * Groq's free tier returned `429 ... tokens per minute (TPM): Limit 8000, Used
 * 3051, Requested 5023`. One vision probe costs roughly 2.5k of an 8k/minute
 * budget and the multi-image one roughly 5k, so six serial probes cannot fit --
 * the connection test was spending the allowance and then reporting the
 * resulting 429 as "this provider cannot read images". Groq's preview vision
 * model separately returned `503 ... currently over capacity`. Neither says
 * anything about the capability.
 */
describe('a throttled diagnostic is not a failed capability', () => {
    it('reports a rate limit as rate_limited, not failed', async () => {
        mockExecute.mockImplementation(async (providerId, context) => {
            if (context.images) {
                throw new AiError('rate_limited', 'HTTP 429', {
                    providerId, status: 429, vendorCode: 'rate_limited',
                });
            }
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('gemini');
        const vision = result.capabilities.find((entry) => entry.id === 'vision_single');

        expect(vision.status).toBe(PROBE_STATUS.RATE_LIMITED);
        expect(vision.message).toMatch(/throttled/i);
        // And it is still not a pass: claiming health for a capability nobody
        // tested is the failure this whole file exists to prevent.
        expect(result.success).toBe(false);
        // But the headline must not accuse the capability either.
        expect(result.category).toBeNull();
        expect(result.message).toMatch(/throttled/i);
    });

    it('reports a vendor outage as inconclusive, not failed', async () => {
        mockExecute.mockImplementation(async (providerId, context) => {
            if (context.images) {
                throw new AiError('provider_unavailable', 'HTTP 503', { providerId, status: 503 });
            }
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('gemini');
        const vision = result.capabilities.find((entry) => entry.id === 'vision_single');

        expect(vision.status).toBe(PROBE_STATUS.INCONCLUSIVE);
        expect(result.success).toBe(false);
    });

    it('still calls a rejected request a failure, because that IS about the capability', async () => {
        mockExecute.mockImplementation(async (providerId, context) => {
            if (context.images) {
                throw new AiError('provider_request_rejected', 'HTTP 400', {
                    providerId, status: 400, vendorCode: 'invalid_request_error',
                });
            }
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('gemini');
        const vision = result.capabilities.find((entry) => entry.id === 'vision_single');

        expect(vision.status).toBe(PROBE_STATUS.FAILED);
        expect(result.category).toBe('provider_request_rejected');
    });

    it('carries the vendor status and code through, which is what made "Failed" useless', async () => {
        mockExecute.mockImplementation(async (providerId, context) => {
            if (context.images) {
                throw new AiError('model_unavailable', 'HTTP 404', {
                    providerId, status: 404, vendorCode: 'model_not_found',
                });
            }
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('gemini');
        const vision = result.capabilities.find((entry) => entry.id === 'vision_single');

        expect(vision).toMatchObject({ httpStatus: 404, vendorCode: 'model_not_found' });
    });

    it('waits the vendor stated pause once and keeps the real answer', async () => {
        let visionAttempts = 0;
        mockExecute.mockImplementation(async (providerId, context) => {
            // Only the single-image probe. Two probes carry images, so counting
            // every image call would conflate the second probe with a retry.
            if (context.images?.length === 1) {
                visionAttempts += 1;
                if (visionAttempts === 1) {
                    throw new AiError('rate_limited', 'HTTP 429', {
                        providerId, status: 429, retryAfterHintMs: 5,
                    });
                }
            }
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('gemini');

        expect(visionAttempts).toBeGreaterThan(1);
        expect(result.capabilities.find((entry) => entry.id === 'vision_single').status)
            .toBe(PROBE_STATUS.PASSED);
    });

    it('does not retry when the vendor stated no wait', async () => {
        let visionAttempts = 0;
        mockExecute.mockImplementation(async (providerId, context) => {
            // Only the single-image probe. Two probes carry images, so counting
            // every image call would conflate the second probe with a retry.
            if (context.images?.length === 1) {
                visionAttempts += 1;
                throw new AiError('rate_limited', 'HTTP 429', { providerId, status: 429 });
            }
            return healthyProvider(providerId, context);
        });

        await testProviderConnection('gemini');

        expect(visionAttempts).toBe(1);
    });

    it('does not honour an absurd stated wait', async () => {
        let visionAttempts = 0;
        mockExecute.mockImplementation(async (providerId, context) => {
            // Only the single-image probe. Two probes carry images, so counting
            // every image call would conflate the second probe with a retry.
            if (context.images?.length === 1) {
                visionAttempts += 1;
                throw new AiError('rate_limited', 'HTTP 429', {
                    providerId, status: 429, retryAfterHintMs: 10 * 60 * 1000,
                });
            }
            return healthyProvider(providerId, context);
        });

        await testProviderConnection('gemini');

        expect(visionAttempts).toBe(1);
    });
});
