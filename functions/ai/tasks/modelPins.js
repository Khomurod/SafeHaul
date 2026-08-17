/**
 * Reconciles registry model pins against each vendor's live catalogue.
 *
 * ## Why this exists
 *
 * A registry pin is a claim about the world, and the world moves. On 2026-08-17
 * an audit found six pins naming models their vendors had retired — two of them
 * the entire Mistral vision lane, retired 2025-12-31 and 2026-05-31, and one an
 * OpenRouter slug that had never been OpenRouter's naming at all. Every CDL and
 * E-Doc image request routed to those providers had been failing for months.
 *
 * Nothing in the repository could have noticed. Unit tests use fixtures by
 * design, the connection test never resolved the vision model, and a pin is
 * just a string until a request is made with it. So the only thing that can
 * catch this class of drift is asking the vendor — which means real
 * credentials, and therefore not CI.
 *
 * This runs on demand from Super Admin, server-side, using the managed
 * credential the provider is already configured with. It is deliberately not
 * wired into any scheduled job or test lane.
 *
 * ## What it does not do
 *
 * It lists models; it does not evaluate them. A model that is present but
 * refuses `json_schema`, or is present but ignores images, passes here and fails
 * the capability probes in ./healthCheck.js. The two are complementary: this
 * answers "does the name still resolve", the probes answer "does it do the job".
 */

const { PROVIDERS, isRetired, resolveModel } = require('../registry/providers');
const { CAPABILITIES } = require('../registry/capabilities');
const store = require('../credentials/store');

const CATALOGUE_TIMEOUT_MS = 15000;

/**
 * How to list models, per vendor.
 *
 * Only providers with a documented catalogue endpoint appear. Cloudflare's model
 * catalogue is per-account and behind a different API shape, so it is reported
 * as unsupported rather than guessed at — saying "we could not check" is honest;
 * inventing a check is not.
 *
 * `extract` returns an array of model id strings from the parsed body.
 */
const CATALOGUES = Object.freeze({
    gemini: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ 'x-goog-api-key': credentials.apiKey }),
        // Gemini returns `models/gemini-3.6-flash`; the pins omit the prefix.
        extract: (body) => (body?.models || []).map((model) => String(model?.name || '').replace(/^models\//, '')),
    },
    groq: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
        extract: (body) => (body?.data || []).map((model) => model?.id),
    },
    mistral: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
        extract: (body) => (body?.data || []).flatMap((model) => [model?.id, ...(model?.aliases || [])]),
    },
    cerebras: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
        extract: (body) => (body?.data || []).map((model) => model?.id),
    },
    sambanova: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
        extract: (body) => (body?.data || []).map((model) => model?.id),
    },
    openrouter: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
        extract: (body) => (body?.data || []).map((model) => model?.id),
    },
    huggingface: {
        url: (provider) => `${provider.apiBaseUrl}/models`,
        headers: (credentials) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
        extract: (body) => (body?.data || []).map((model) => model?.id),
    },
});

/** Every distinct model this provider would resolve, and for which capability. */
function pinnedModels(provider, config) {
    const pins = new Map();
    for (const capability of provider.capabilities) {
        // Not a model axis — no provider pins a model for it.
        if (capability === CAPABILITIES.LONG_CONTEXT) continue;
        const model = resolveModel(provider, capability, config);
        if (!model) continue;
        if (!pins.has(model)) pins.set(model, []);
        pins.get(model).push(capability);
    }
    return pins;
}

/**
 * A pin matches when the catalogue lists it exactly, or lists it minus a policy
 * suffix. Hugging Face accepts `openai/gpt-oss-120b:fastest`, where `:fastest`
 * selects a provider policy and is not part of the model id it lists back.
 */
function catalogueContains(catalogue, model) {
    if (catalogue.has(model)) return true;
    const withoutPolicy = model.split(':')[0];
    return catalogue.has(withoutPolicy);
}

async function checkProvider(provider, { fetchImpl = fetch, deps = {} } = {}) {
    const base = { providerId: provider.id, displayName: provider.displayName };

    if (isRetired(provider)) {
        return { ...base, status: 'retired', pins: [] };
    }

    const catalogue = CATALOGUES[provider.id];
    if (!catalogue) {
        return {
            ...base,
            status: 'unsupported',
            message: 'This vendor publishes no catalogue endpoint SafeHaul can read.',
            pins: [],
        };
    }

    const config = await store.readConfig(provider.id);
    const credentials = await store.resolveCredentials(provider.id, deps);
    if (!credentials.complete) {
        return { ...base, status: 'unconfigured', pins: [] };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATALOGUE_TIMEOUT_MS);
    try {
        const response = await fetchImpl(catalogue.url(provider), {
            method: 'GET',
            headers: catalogue.headers(credentials.values),
            signal: controller.signal,
        });
        if (!response.ok) {
            // Status only. A catalogue error body is still a vendor error body.
            return { ...base, status: 'unreachable', httpStatus: response.status, pins: [] };
        }

        const listed = new Set(
            (catalogue.extract(await response.json()) || []).filter(Boolean).map(String),
        );
        const pins = [...pinnedModels(provider, config)].map(([model, capabilities]) => ({
            model,
            capabilities,
            present: catalogueContains(listed, model),
        }));

        return {
            ...base,
            status: pins.every((pin) => pin.present) ? 'ok' : 'stale',
            catalogueSize: listed.size,
            pins,
        };
    } catch (error) {
        return {
            ...base,
            status: 'unreachable',
            // Message only, and only for an operator: never a response body.
            message: error?.name === 'AbortError' ? 'Timed out.' : 'Could not reach the vendor catalogue.',
            pins: [],
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * @param {object} [options]
 * @returns {Promise<{ providers: Array, stalePins: number }>}
 */
async function diagnoseModelPins(options = {}) {
    const providers = [];
    for (const provider of PROVIDERS) {
        providers.push(await checkProvider(provider, options));
    }
    const stalePins = providers.reduce(
        (total, entry) => total + entry.pins.filter((pin) => !pin.present).length,
        0,
    );

    // A provider that was unconfigured, unreachable, or has no readable
    // catalogue contributes zero stale pins — but that is not evidence its pins
    // are good, it is evidence they were never looked at. Counting those
    // separately is what stops "0 stale" being reported as "all clear" after a
    // run that checked almost nothing.
    const checked = providers.filter((entry) => entry.status === 'ok' || entry.status === 'stale');
    const unchecked = providers.filter((entry) => (
        entry.status !== 'ok' && entry.status !== 'stale' && entry.status !== 'retired'
    ));

    return {
        providers,
        stalePins,
        checkedCount: checked.length,
        uncheckedCount: unchecked.length,
        // The only condition under which an all-clear is truthful.
        complete: unchecked.length === 0 && checked.length > 0,
    };
}

module.exports = {
    diagnoseModelPins,
    CATALOGUES,
    CATALOGUE_TIMEOUT_MS,
    __test: { checkProvider, pinnedModels, catalogueContains },
};
