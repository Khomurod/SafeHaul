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

const { PROVIDERS, isRetired, resolveModels } = require('../registry/providers');
const { CAPABILITIES } = require('../registry/capabilities');
const store = require('../credentials/store');

const { CATALOGUES, CATALOGUE_TIMEOUT_MS, fetchCatalogue } = require('./modelCatalogue');

/**
 * Every distinct model version this provider would be asked for, and for which
 * capability. Every version in a list, not only the first: a version kept in
 * reserve is useless if its vendor has withdrawn it.
 */
function pinnedModels(provider, config) {
    const pins = new Map();
    for (const capability of provider.capabilities) {
        // Not a model axis — no provider pins a model for it.
        if (capability === CAPABILITIES.LONG_CONTEXT) continue;
        for (const model of resolveModels(provider, capability, config)) {
            if (!pins.has(model)) pins.set(model, []);
            pins.get(model).push(capability);
        }
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

    if (!CATALOGUES[provider.id]) {
        return {
            ...base,
            status: 'unsupported',
            message: 'This vendor publishes no catalogue endpoint SafeHaul can read.',
            pins: [],
        };
    }

    // Both reads sat outside the try below, so an infrastructure fault on one
    // provider failed the whole diagnosis as a generic `internal` — a check whose
    // purpose is to name a specific fault reporting nothing specific at all.
    // Now the fault is reported against the provider it belongs to and the other
    // vendors are still checked.
    let config;
    let credentials;
    try {
        config = await store.readConfig(provider.id);
        credentials = await store.resolveCredentials(provider.id, deps);
    } catch (error) {
        console.error(`[ai/modelPins] Could not resolve ${provider.id}: ${error?.message || 'unknown'}`);
        return { ...base, status: 'credential_error', pins: [] };
    }
    // Unreadable is a different fault from unconfigured, and only one of them is
    // fixed by adding a credential.
    if (Array.isArray(credentials.unreadable) && credentials.unreadable.length > 0) {
        return { ...base, status: 'credential_error', pins: [] };
    }
    if (!credentials.complete) {
        return { ...base, status: 'unconfigured', pins: [] };
    }

    const catalogue = await fetchCatalogue(provider, credentials.values, { fetchImpl });
    if (catalogue.status !== 'ok') {
        return {
            ...base,
            status: 'unreachable',
            ...(catalogue.httpStatus ? { httpStatus: catalogue.httpStatus } : {}),
            ...(catalogue.message ? { message: catalogue.message } : {}),
            pins: [],
        };
    }

    const listed = new Set(catalogue.entries.map((item) => item.id));
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
