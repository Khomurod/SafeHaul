/**
 * Provider connection test.
 *
 * Deliberately the smallest useful request: a fixed nonsense-free prompt with
 * a tiny output ceiling, exercising the provider's *configured* capability so
 * the test proves the credential works for the thing SafeHaul will actually
 * ask it to do.
 *
 * It never carries company, driver or applicant data — the prompt is a
 * constant — and it bypasses the router on purpose. The router's job is to
 * find a provider that works; a connection test must interrogate exactly the
 * provider the operator clicked, including one that is currently disabled or
 * in cooldown, because "why is this one failing" is the question being asked.
 */

const { requireProvider, resolveModel, isRetired } = require('../registry/providers');
const { CAPABILITIES } = require('../registry/capabilities');
const { getAdapter } = require('../providers');
const { AiError } = require('../router/errors');
const store = require('../credentials/store');

/** Constant, content-free, and cheap. */
const HEALTH_PROMPT = 'Reply with the single word: ready';
const HEALTH_TIMEOUT_MS = 15000;
const HEALTH_MAX_TOKENS = 16;

/**
 * @param {string} providerId
 * @param {object} [deps]
 * @returns {Promise<{ success: boolean, category?: string, message: string, model?: string, latencyMs: number }>}
 */
async function testProviderConnection(providerId, deps = {}) {
    const provider = requireProvider(providerId);
    const startedAt = Date.now();

    if (isRetired(provider)) {
        return {
            success: false,
            category: 'provider_unavailable',
            message: provider.retired.reason,
            latencyMs: 0,
        };
    }

    const config = await store.readConfig(provider.id);
    const missingConfig = provider.configFields
        .filter((field) => field.required)
        .filter((field) => !(typeof config[field.name] === 'string' && config[field.name].trim()));
    if (missingConfig.length > 0) {
        return {
            success: false,
            category: 'not_configured',
            message: `${missingConfig.map((field) => field.label).join(', ')} is required before testing.`,
            latencyMs: 0,
        };
    }

    const credentials = await store.resolveCredentials(provider.id, deps);
    if (!credentials.complete) {
        return {
            success: false,
            category: 'not_configured',
            message: 'Add credentials before testing this provider.',
            latencyMs: 0,
        };
    }

    const capability = provider.healthTest?.capability || CAPABILITIES.TEXT;
    const model = resolveModel(provider, capability, config);
    if (!model) {
        return {
            success: false,
            category: 'model_unavailable',
            message: 'No model is configured for this provider.',
            latencyMs: 0,
        };
    }

    try {
        const raw = await getAdapter(provider).execute({
            provider,
            capability,
            model,
            systemInstructions: '',
            inputText: HEALTH_PROMPT,
            images: null,
            schema: null,
            schemaName: 'safehaul_health_check',
            temperature: 0,
            maxOutputTokens: HEALTH_MAX_TOKENS,
            timeoutMs: HEALTH_TIMEOUT_MS,
            parentSignal: undefined,
            credentials: credentials.values,
            config,
            fetchImpl: deps.fetchImpl,
        });

        const latencyMs = Date.now() - startedAt;
        const success = typeof raw?.text === 'string' && raw.text.trim().length > 0;
        const result = success
            ? { success: true, message: `Connected. Responded in ${latencyMs}ms.`, model, latencyMs }
            : {
                success: false,
                category: 'malformed_response',
                message: 'The provider connected but returned nothing usable.',
                model,
                latencyMs,
            };
        await store.recordTestResult(provider.id, result);
        return result;
    } catch (error) {
        const aiError = error instanceof AiError
            ? error
            : new AiError('internal', error?.message || 'Test failed.', { providerId: provider.id });
        const result = {
            success: false,
            category: aiError.category,
            // Safe category text only, never the vendor's own error body.
            message: aiError.safeMessage,
            model,
            latencyMs: Date.now() - startedAt,
        };
        await store.recordTestResult(provider.id, result);
        return result;
    }
}

module.exports = { testProviderConnection, HEALTH_PROMPT, HEALTH_TIMEOUT_MS };
