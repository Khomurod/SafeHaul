/**
 * Adapter registry.
 *
 * Every vendor-specific detail in SafeHaul — base URLs, authorization header
 * names, request bodies, response envelopes — lives in this folder and nowhere
 * else. `scripts/check-ai-provider-boundary.mjs` fails CI if a direct provider
 * call appears outside it.
 *
 * The five OpenAI-compatible vendors are configured here rather than given
 * their own files, because the only thing that distinguishes them is the
 * header and, for two of them, which stored model override applies.
 */

const { groqAdapter } = require('./groq');
const { geminiAdapter } = require('./gemini');
const { cloudflareAdapter } = require('./cloudflare');
const { createOpenAiCompatibleAdapter } = require('./openaiCompatible');
const { AiError } = require('../router/errors');

const bearer = (field) => ({ credentials }) => ({ Authorization: `Bearer ${credentials[field]}` });

const mistralAdapter = createOpenAiCompatibleAdapter({
    id: 'mistral',
    buildHeaders: bearer('apiKey'),
});

const cerebrasAdapter = createOpenAiCompatibleAdapter({
    id: 'cerebras',
    buildHeaders: bearer('apiKey'),
});

const sambanovaAdapter = createOpenAiCompatibleAdapter({
    id: 'sambanova',
    buildHeaders: bearer('apiKey'),
});

const openrouterAdapter = createOpenAiCompatibleAdapter({
    id: 'openrouter',
    buildHeaders: ({ credentials }) => ({
        Authorization: `Bearer ${credentials.apiKey}`,
        // OpenRouter asks integrators to identify themselves. Both values are
        // public product identifiers, not credentials.
        'HTTP-Referer': 'https://safehaul.io',
        'X-Title': 'SafeHaul',
    }),
});

const huggingfaceAdapter = createOpenAiCompatibleAdapter({
    id: 'huggingface',
    buildHeaders: bearer('apiKey'),
});

/**
 * GitHub retired Models on 2026-07-30. The adapter is kept so the registry row
 * has a partner and so restoring the provider would be a one-line change, but
 * it refuses to run: the router already filters retired providers out, and
 * this is the backstop if a future caller bypasses that filter.
 */
const githubModelsAdapter = {
    id: 'githubModels',
    async execute({ provider }) {
        throw new AiError('provider_unavailable', 'GitHub Models was retired on 2026-07-30.', {
            providerId: provider?.id || 'github-models',
        });
    },
};

const ADAPTERS = Object.freeze({
    groq: groqAdapter,
    gemini: geminiAdapter,
    cloudflare: cloudflareAdapter,
    githubModels: githubModelsAdapter,
    mistral: mistralAdapter,
    cerebras: cerebrasAdapter,
    sambanova: sambanovaAdapter,
    openrouter: openrouterAdapter,
    huggingface: huggingfaceAdapter,
});

/**
 * @param {object} provider registry row
 * @returns {object} adapter
 */
function getAdapter(provider) {
    const adapter = ADAPTERS[provider?.adapter];
    if (!adapter) {
        throw new AiError('internal', `No adapter registered for "${provider?.adapter}".`, {
            providerId: provider?.id,
        });
    }
    return adapter;
}

module.exports = { ADAPTERS, getAdapter };
