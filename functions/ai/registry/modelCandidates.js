// functions/ai/registry/modelCandidates.js
//
// Which models in a vendor's catalogue the daily model check may try for a
// lane, in the order it tries them.
//
// A candidate is only a name worth one test: nothing joins a lane until it has
// read the fake licence, or answered the structured probe, correctly
// (`../tasks/modelVerification.js`). So the rules here can stay simple, and they
// are deliberately narrow: stable, dated or versioned names only, never a
// preview, an experiment, or a moving alias such as `-latest`, which a vendor
// can repoint without a word. A provider with no rules here is still checked,
// but only on the versions it already has.
//
// Vendor knowledge, so it lives in the registry beside the model lists.

const { LANES } = require('./capabilities');

/** `gemini-3.6-flash` → [3, 6]: newer first. */
function versionOf(id) {
    const match = /(\d+(?:\.\d+)*)/.exec(id);
    return match ? match[1].split('.').map(Number) : [];
}

function newerFirst(a, b) {
    const left = versionOf(a.id);
    const right = versionOf(b.id);
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        const difference = (right[index] || 0) - (left[index] || 0);
        if (difference !== 0) return difference;
    }
    return a.id.localeCompare(b.id);
}

/** The first pattern a name matches decides its place; names matching none are not candidates. */
function byPreference(patterns) {
    return (entries) => entries
        .map((item) => ({ item, rank: patterns.findIndex((pattern) => pattern.test(item.id)) }))
        .filter(({ rank }) => rank >= 0)
        .sort((a, b) => a.rank - b.rank || newerFirst(a.item, b.item))
        .map(({ item }) => item.id);
}

const usable = (item) => item.chat !== false && !item.deprecated && !item.alias;

const RULES = Object.freeze({
    // Every stable Flash model reads images and answers in a schema; Pro is left
    // out because its free allowance is too small to serve a lane.
    gemini: {
        [LANES.VISION]: byPreference([/^gemini-\d+(?:\.\d+)?-flash$/, /^gemini-\d+(?:\.\d+)?-flash-lite$/]),
        [LANES.TEXT]: byPreference([/^gemini-\d+(?:\.\d+)?-flash$/, /^gemini-\d+(?:\.\d+)?-flash-lite$/]),
    },
    // Groq's catalogue does not say which models read images, so photos are
    // offered only the families that do.
    groq: {
        [LANES.VISION]: byPreference([/^qwen\/qwen\d+(?:\.\d+)?-\d+b$/, /^meta-llama\/llama-4-(?:scout|maverick)-[\w.-]+$/]),
        [LANES.TEXT]: byPreference([/^openai\/gpt-oss-\d+b$/, /^qwen\/qwen\d+(?:\.\d+)?-\d+b$/]),
    },
    // Mistral says which models read images. Dated names only; the Ministral
    // family first, because a free key can call it (Medium and Small had a
    // limit of zero on the free plan on 2026-10-07).
    mistral: {
        [LANES.VISION]: (entries) => byPreference([/^ministral-\d+b-\d{4}$/, /^(?:mistral-small|pixtral)-[\w-]*\d{4}$/, /^mistral-medium-\d{4}$/])(
            entries.filter((item) => item.vision === true),
        ),
        [LANES.TEXT]: byPreference([/^ministral-\d+b-\d{4}$/, /^mistral-small-\d{4}$/, /^mistral-medium-\d{4}$/]),
    },
});

/**
 * The catalogue's candidates for a lane, best first, without the versions the
 * lane already has.
 *
 * @param {string} providerId
 * @param {string} lane
 * @param {object[]} entries catalogue entries (`../tasks/modelCatalogue.js`)
 * @param {string[]} [current] versions already in the lane
 * @returns {string[]}
 */
function candidatesFor(providerId, lane, entries, current = []) {
    const rule = RULES[providerId]?.[lane];
    if (!rule) return [];
    const have = new Set(current);
    return [...new Set(rule((entries || []).filter(usable)))].filter((id) => !have.has(id));
}

module.exports = { candidatesFor };
