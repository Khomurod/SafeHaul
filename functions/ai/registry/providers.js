/**
 * The frozen AI provider registry.
 *
 * This module is the single authority on which AI vendors SafeHaul may talk
 * to, what each one can do, and what it needs to be configured. Three rules
 * make it load-bearing rather than decorative:
 *
 *  1. A provider id supplied by a browser is only ever *looked up* here. It is
 *     never concatenated into a Secret Manager resource name, a URL, or a
 *     Firestore path. An id that is not in this table does not exist.
 *  2. `secretFields` drive the Secret Manager naming convention in
 *     `../credentials/secretManager.js`. The browser never names a secret.
 *  3. `capabilities` is a hard gate in the router, not a hint. A provider that
 *     does not declare `vision` can never be handed a CDL photograph.
 *
 * `priority` is the **default** attempt order, not necessarily the effective
 * one: an operator can reorder providers from Super Admin → AI Integrations,
 * and `../router/order.js` applies that override on top of these rows. Every
 * gate above still applies afterwards, so a reorder can never route a task to a
 * provider that could not have served it before.
 *
 * Adding a provider means adding a row to `./providerTable.js`, its model
 * versions to `./modelVersions.js`, and an adapter in `../providers/`.
 * Nothing else in the application should need to change.
 */


const { CAPABILITIES } = require('./capabilities');
const { STRUCTURED_MODE, PROVIDER_LIST } = require('./providerTable');
const { MODEL_VERSIONS, MAX_VERSIONS_PER_LANE } = require('./modelVersions');

/**
 * A row's ordered model versions per capability, frozen. A provider with no
 * list fails here, at load, rather than routing with no model at all.
 */
function freezeModelVersions(providerId) {
    const lists = MODEL_VERSIONS[providerId];
    if (!lists) throw new Error(`No model versions declared for AI provider "${providerId}".`);
    return Object.freeze(Object.fromEntries(
        Object.entries(lists).map(([capability, versions]) => [capability, Object.freeze([...versions])]),
    ));
}

function freezeProvider(row) {
    const modelVersions = freezeModelVersions(row.id);
    return Object.freeze({
        ...row,
        capabilities: Object.freeze([...row.capabilities]),
        secretFields: Object.freeze([...row.secretFields]),
        configFields: Object.freeze([...row.configFields]),
        modelVersions,
        // The first version of each list. Everything that reads one pin per
        // capability — the console and the provider list — reads this, and
        // sees exactly what a single-pin row showed it.
        defaultModels: Object.freeze(Object.fromEntries(
            Object.entries(modelVersions)
                .filter(([, versions]) => versions.length > 0)
                .map(([capability, versions]) => [capability, versions[0]]),
        )),
        structuredModeByCapability: Object.freeze({ ...(row.structuredModeByCapability || {}) }),
        healthTest: Object.freeze({ ...row.healthTest }),
    });
}

const PROVIDERS = Object.freeze(
    PROVIDER_LIST
        .slice()
        .sort((a, b) => a.priority - b.priority)
        .map(freezeProvider),
);

const PROVIDERS_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

/**
 * The **default** fallback order, and since 2026-08-08 only the default.
 *
 * A Super Admin can store an override in `ai_routing_config/order`, which
 * `functions/ai/router/order.js` applies on top of these rows; the router
 * degrades to this order whenever no usable override exists. So `priority`
 * above is what SafeHaul ships with and falls back to, not necessarily what a
 * given deployment is running — read `listAiProviders().routing.order` for
 * that.
 *
 * Derived from `priority` rather than written out twice, so the table above
 * stays the only place the default order lives.
 */
const DEFAULT_FALLBACK_ORDER = Object.freeze(PROVIDERS.map((provider) => provider.id));

/**
 * The single lookup every caller must use. Returns `null` for anything not in
 * the table, which is what stops a browser-supplied id from reaching a URL or
 * a secret name.
 *
 * @param {unknown} providerId
 * @returns {object|null}
 */
function getProvider(providerId) {
    if (typeof providerId !== 'string') return null;
    return PROVIDERS_BY_ID.get(providerId) || null;
}

/** Throwing variant for server paths where an unknown id is a programming error. */
function requireProvider(providerId) {
    const provider = getProvider(providerId);
    if (!provider) {
        throw new Error(`Unknown AI provider "${String(providerId)}".`);
    }
    return provider;
}

function isRetired(provider) {
    return Boolean(provider && provider.retired);
}

/**
 * Whether a provider can satisfy every capability a task requires. Retired
 * providers answer `false` for everything.
 *
 * @param {object} provider
 * @param {string[]} capabilities
 */
function supportsAllCapabilities(provider, capabilities) {
    if (!provider || isRetired(provider)) return false;
    return capabilities.every((capability) => provider.capabilities.includes(capability));
}

/**
 * The model versions this provider should be asked for, for a capability, in
 * order, honouring any operator override in stored config.
 *
 * An override is the operator naming the one model their account can reach, so
 * it replaces the list rather than joining it. A capability with no list of its
 * own falls back to the text list, as a single pin always did. A row without
 * `modelVersions` (a hand-built row in a test) falls back to `defaultModels`.
 *
 * @param {object} provider registry row
 * @param {string} capability
 * @param {object} config non-secret stored config for this provider
 * @returns {string[]} possibly empty, never null
 */
function resolveModels(provider, capability, config = {}) {
    for (const field of provider.configFields || []) {
        if (!Array.isArray(field.appliesTo)) continue;
        if (!field.appliesTo.includes(capability)) continue;
        const override = config?.[field.name];
        if (typeof override === 'string' && override.trim()) return [override.trim()];
    }
    const lists = provider.modelVersions;
    if (lists) {
        // An empty list is no list: fall back to text, as a missing pin did.
        const versions = lists[capability]?.length ? lists[capability] : lists[CAPABILITIES.TEXT];
        return (versions || []).slice(0, MAX_VERSIONS_PER_LANE);
    }
    const single = provider.defaultModels?.[capability] || provider.defaultModels?.[CAPABILITIES.TEXT];
    return single ? [single] : [];
}

/**
 * The first model version this provider should use for a capability, honouring
 * any operator override in stored config.
 *
 * @param {object} provider registry row
 * @param {string} capability
 * @param {object} config non-secret stored config for this provider
 * @returns {string|null}
 */
function resolveModel(provider, capability, config = {}) {
    return resolveModels(provider, capability, config)[0] || null;
}

/**
 * How this provider should be asked for JSON *for this capability*.
 *
 * Structured-output support is a property of the model, not only of the vendor,
 * and the two can disagree within one provider. Groq accepts `json_schema` on
 * its `openai/gpt-oss-*` models and rejects it with a 400 on the only model
 * that can read an image. A single per-provider mode cannot express that, and
 * the shape SafeHaul sends has to match the model the router actually resolved.
 *
 * Falls back to the row's `structuredMode`, so a provider whose whole catalogue
 * behaves alike needs no map at all.
 *
 * @param {object} provider registry row
 * @param {string} capability the primary capability the router resolved
 * @returns {string} a `STRUCTURED_MODE` value
 */
function resolveStructuredMode(provider, capability) {
    const override = provider.structuredModeByCapability?.[capability];
    return override || provider.structuredMode;
}

module.exports = {
    PROVIDERS,
    DEFAULT_FALLBACK_ORDER,
    STRUCTURED_MODE,
    getProvider,
    requireProvider,
    isRetired,
    supportsAllCapabilities,
    resolveModels,
    resolveModel,
    resolveStructuredMode,
};
