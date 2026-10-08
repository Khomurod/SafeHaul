// functions/ai/registry/savedModels.js
//
// The model versions the daily check verified, per lane, as each provider's
// `ai_provider_config/{id}.modelLists` keeps them.
//
// `resolveModels` in ./providers.js reads this on every routing decision, so it
// must never be able to break routing: anything malformed (a missing field, a
// wrong type, an id that is not shaped like a model id, an empty list) reads as
// "nothing saved", and the provider's built-in list from ./modelVersions.js
// applies. The config document is read with the rest of the provider's config,
// so a Firestore fault falls back to the router's last known configs, and only
// the daily check writes the field (`../../ops/modelRefresh.js`), saving only
// versions that passed.
//
// A saved list also records the built-in list it was checked against (`seed`),
// and applies only while the release still ships that list: a release that
// changes a lane's versions is used at once, rather than after the next check
// has found the old ones failing.
//
// Two lanes are managed, the two the daily check verifies: photos, and text and
// structured output. Article writing is not: it keeps its built-in list, because
// a version that reads a licence well can still be too slow, or refuse, to
// write an article (`gemini-3.5-flash-lite` answers the article request with a
// 400; `ministral-14b-2512` needs 33-48s against the row's 45s timeout).

const { CAPABILITIES, LANES } = require('./capabilities');
const { MAX_VERSIONS_PER_LANE } = require('./modelVersions');

/** The capabilities whose models a saved lane list replaces. */
const MANAGED_LANES = Object.freeze({
    [LANES.VISION]: Object.freeze([CAPABILITIES.VISION, CAPABILITIES.MULTI_IMAGE]),
    [LANES.TEXT]: Object.freeze([
        CAPABILITIES.TEXT,
        CAPABILITIES.STRUCTURED_JSON,
        CAPABILITIES.SUMMARIZATION,
        CAPABILITIES.CLASSIFICATION,
    ]),
});

/**
 * The shape of every model id a vendor uses today: `gemini-3.6-flash`,
 * `openai/gpt-oss-120b`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
 * `openai/gpt-oss-120b:fastest`. Anything else is not saved, and not read.
 */
const MODEL_ID_PATTERN = /^[A-Za-z0-9@][A-Za-z0-9._:/@+-]{0,127}$/;

/** The managed lane a capability's model comes from, or null for one that keeps its built-in list. */
function managedLane(capability) {
    for (const [lane, capabilities] of Object.entries(MANAGED_LANES)) {
        if (capabilities.includes(capability)) return lane;
    }
    return null;
}

/**
 * Reduces whatever a stored list holds to usable model ids: strings of the
 * right shape, each once, at most `MAX_VERSIONS_PER_LANE`.
 *
 * @param {unknown} value
 * @returns {string[]} possibly empty
 */
function sanitizeModelList(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const entry of value) {
        if (typeof entry !== 'string') continue;
        const model = entry.trim();
        if (!MODEL_ID_PATTERN.test(model) || out.includes(model)) continue;
        out.push(model);
        if (out.length >= MAX_VERSIONS_PER_LANE) break;
    }
    return out;
}

/**
 * The verified versions saved for this capability's lane, or null when the
 * capability keeps its built-in list, nothing usable is saved, or the list was
 * checked against other built-in versions than the release's.
 *
 * @param {object} config the provider's stored config
 * @param {string} capability
 * @param {string[]} builtIn the capability's built-in list in this release
 * @returns {string[]|null}
 */
function savedModels(config, capability, builtIn) {
    const lane = managedLane(capability);
    if (!lane) return null;
    const saved = config?.modelLists?.[lane];
    const seed = saved?.seed;
    const sameSeed = Array.isArray(seed) && Array.isArray(builtIn) && seed.length === builtIn.length
        && seed.every((model, index) => model === builtIn[index]);
    if (!sameSeed) return null;
    const models = sanitizeModelList(saved?.models);
    return models.length > 0 ? models : null;
}

module.exports = {
    MANAGED_LANES,
    MODEL_ID_PATTERN,
    managedLane,
    sanitizeModelList,
    savedModels,
};
