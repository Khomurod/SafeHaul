/**
 * Each vendor's own list of the models it offers, read with the managed
 * credential the provider is already configured with.
 *
 * Two readers share it: the model-pin diagnostic (`./modelPins.js`), which asks
 * whether each listed version still exists, and the daily model check
 * (`../../ops/modelRefresh.js`), which also needs to know what else is on offer.
 * So a catalogue is read into entries rather than bare ids:
 *
 *   { id, alias, chat, vision, deprecated }
 *
 * `chat` and `vision` are `null` where the vendor does not say; `alias` marks a
 * moving name (Mistral's `-latest`) that counts as present but is never a
 * version to pin, because it can change under us without a word.
 *
 * A catalogue error body is still a vendor error body, so a failure is
 * reported by status alone.
 */

const CATALOGUE_TIMEOUT_MS = 15000;

const entry = (id, extra = {}) => ({
    id: String(id || ''), alias: false, chat: null, vision: null, deprecated: false, ...extra,
});

/** OpenAI-compatible `/models`: ids and nothing else worth reading. */
const openAiShape = (body) => (body?.data || []).map((model) => entry(model?.id));

/**
 * How to list models, per vendor.
 *
 * Only providers with a documented catalogue endpoint appear. Cloudflare's model
 * catalogue is per-account and behind a different API shape, so it is reported
 * as unsupported rather than guessed at: saying "we could not check" is honest;
 * inventing a check is not.
 */
const CATALOGUES = Object.freeze({
    gemini: {
        url: (provider) => `${provider.apiBaseUrl}/models?pageSize=1000`,
        headers: (credentials) => ({ 'x-goog-api-key': credentials.apiKey }),
        // Gemini returns `models/gemini-3.6-flash`; the pins omit the prefix.
        entries: (body) => (body?.models || []).map((model) => entry(String(model?.name || '').replace(/^models\//, ''), {
            chat: Array.isArray(model?.supportedGenerationMethods)
                ? model.supportedGenerationMethods.includes('generateContent')
                : null,
        })),
    },
    groq: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
        entries: (body) => (body?.data || []).map((model) => entry(model?.id, { deprecated: model?.active === false })),
    },
    mistral: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
        entries: (body, now) => (body?.data || []).flatMap((model) => {
            const capabilities = model?.capabilities || {};
            const retiresAt = Date.parse(model?.deprecation);
            const facts = {
                chat: typeof capabilities.completion_chat === 'boolean' ? capabilities.completion_chat : null,
                vision: typeof capabilities.vision === 'boolean' ? capabilities.vision : null,
                deprecated: Number.isFinite(retiresAt) && retiresAt <= now,
            };
            const aliases = (model?.aliases || []).map((alias) => entry(alias, { ...facts, alias: true }));
            return [entry(model?.id, { ...facts, alias: /-latest$/.test(String(model?.id || '')) }), ...aliases];
        }),
    },
    cerebras: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
        entries: openAiShape,
    },
    sambanova: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
        entries: openAiShape,
    },
    openrouter: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
        entries: openAiShape,
    },
    huggingface: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
        entries: openAiShape,
    },
});

/**
 * Reads one vendor's catalogue.
 *
 * @param {object} provider registry row
 * @param {object} credentials resolved credential values
 * @param {object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {number} [options.now]
 * @returns {Promise<{ status: 'ok', entries: object[] }
 *   | { status: 'unsupported'|'unauthorized'|'unreachable', httpStatus?: number, message?: string }>}
 */
async function fetchCatalogue(provider, credentials, { fetchImpl = fetch, now = Date.now() } = {}) {
    const catalogue = CATALOGUES[provider.id];
    if (!catalogue) return { status: 'unsupported' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATALOGUE_TIMEOUT_MS);
    try {
        const response = await fetchImpl(catalogue.url(provider), {
            method: 'GET',
            headers: catalogue.headers(credentials),
            signal: controller.signal,
        });
        if (!response.ok) {
            const status = response.status === 401 || response.status === 403 ? 'unauthorized' : 'unreachable';
            return { status, httpStatus: response.status };
        }
        const entries = (catalogue.entries(await response.json(), now) || []).filter((item) => item.id);
        return { status: 'ok', entries };
    } catch (error) {
        return {
            status: 'unreachable',
            // Message only, and only for an operator: never a response body.
            message: error?.name === 'AbortError' ? 'Timed out.' : 'Could not reach the vendor catalogue.',
        };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { CATALOGUES, CATALOGUE_TIMEOUT_MS, fetchCatalogue };
