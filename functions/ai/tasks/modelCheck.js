/**
 * The daily model check for one provider: what its catalogue offers, how each
 * version of its lanes does on the lane's test, and what each lane's list
 * should be afterwards.
 *
 * `../../ops/modelRefresh.js` decides when to run it and saves what it returns;
 * this module only asks and decides. `decideLane` is pure, so every rule about
 * a list is a test.
 *
 * ## The rules
 *
 * - **A version leaves a lane only for a reason about itself:** the vendor no
 *   longer lists it or refuses it as gone, it read the fake licence wrong (or
 *   answered the text probe in no usable shape), or it would not take the
 *   request at all. A busy, slow or unreachable vendor, a refused key and a spent
 *   allowance say nothing about the version, so it stays where it is: the
 *   router's rests already handle a bad hour.
 * - **A version joins only by passing the test,** after the lane's own versions,
 *   in the candidate order of `../registry/modelCandidates.js`, while the lane
 *   has room (three at most).
 * - **A lane is never emptied.** If nothing passes, the list stays as it was and
 *   the lane is reported as failing.
 * - **The order of the versions that stay never changes.** A version that is
 *   busy today and first tomorrow should not flip places twice.
 * - **An account problem stops the provider's check** (a refused key, a spent
 *   allowance): every further request would fail the same way.
 */

const { LANES, CAPABILITIES } = require('../registry/capabilities');
const { resolveModels } = require('../registry/providers');
const { MAX_VERSIONS_PER_LANE } = require('../registry/modelVersions');
const { managedLane } = require('../registry/savedModels');
const { candidatesFor } = require('../registry/modelCandidates');
const { RESULT, verifyModel } = require('./modelVerification');
const { fetchCatalogue } = require('./modelCatalogue');

/** Results that say the version cannot do the lane's job. */
const DISQUALIFYING = new Set([RESULT.GONE, RESULT.MISREAD, RESULT.REFUSED]);
/** Results about the account, not the version. */
const ACCOUNT = new Set([RESULT.KEY, RESULT.QUOTA]);

/** At most this many tests per provider per run: two lanes, their versions, and a few candidates. */
const MAX_TESTS_PER_PROVIDER = 10;
/** New names tried per lane per run, so a lane with room cannot spend the whole budget. */
const MAX_CANDIDATES_PER_LANE = 2;
/** Between two tests of one provider: Mistral's free plan allows one request a second. */
const TEST_SPACING_MS = 1200;

/** The capability whose models a lane's list replaces, for asking `resolveModels`. */
const LANE_CAPABILITY = Object.freeze({
    [LANES.VISION]: CAPABILITIES.VISION,
    [LANES.TEXT]: CAPABILITIES.STRUCTURED_JSON,
});

/**
 * The lane's list after a check.
 *
 * @param {object} params
 * @param {string[]} params.current the lane's versions before the check, in order
 * @param {Map<string, { result: string }>} params.checked what each tested version did
 * @param {string[]} params.additions candidates that passed, best first
 * @returns {{ models: string[], dropped: { model: string, result: string }[], added: string[],
 *   status: 'ok'|'failing'|'unknown', changed: boolean }}
 */
function decideLane({ current, checked, additions }) {
    const resultOf = (model) => checked.get(model)?.result;
    const kept = current.filter((model) => !DISQUALIFYING.has(resultOf(model)));
    const fresh = additions.filter((model) => !current.includes(model));
    const passed = current.some((model) => resultOf(model) === RESULT.PASSED) || fresh.length > 0;
    const unsure = kept.some((model) => resultOf(model) !== RESULT.PASSED);

    if (kept.length === 0 && fresh.length === 0) {
        // Never an empty lane: the list stays, and the lane is reported as failing.
        return { models: [...current], dropped: [], added: [], status: 'failing', changed: false };
    }
    const models = [...kept, ...fresh].slice(0, MAX_VERSIONS_PER_LANE);
    const dropped = current
        .filter((model) => !models.includes(model))
        .map((model) => ({ model, result: resultOf(model) || RESULT.GONE }));
    const added = fresh.filter((model) => models.includes(model));
    const changed = models.length !== current.length || models.some((model, index) => model !== current[index]);
    let status = 'failing';
    if (passed) status = 'ok';
    else if (unsure) status = 'unknown';
    return { models, dropped, added, status, changed };
}

/** The managed lanes this provider serves, with the capability that picks each one's models. */
function lanesOf(provider) {
    return Object.entries(LANE_CAPABILITY)
        .filter(([, capability]) => provider.capabilities.includes(capability))
        .map(([lane, capability]) => ({ lane, capability }));
}

/** Whether an operator named this lane's model by hand: then the check leaves it alone. */
function operatorChose(provider, capability, config) {
    return (provider.configFields || []).some((field) => Array.isArray(field.appliesTo)
        && field.appliesTo.some((applied) => managedLane(applied) === managedLane(capability))
        && typeof config?.[field.name] === 'string' && config[field.name].trim());
}

const sleepFor = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Checks one provider.
 *
 * @param {object} params
 * @param {object} params.provider registry row
 * @param {object} params.config the provider's stored config
 * @param {object} params.credentials resolved credentials (`values`)
 * @param {number} params.deadlineAt no test starts after this
 * @param {object} [params.deps] `{ fetchImpl, verify, sleep, now }`, for tests
 * @returns {Promise<{ catalogue: string, account: (string|null), lanes: object }>}
 */
async function checkProvider({ provider, config, credentials, deadlineAt, deps = {} }) {
    const verify = deps.verify || verifyModel;
    const sleep = deps.sleep || sleepFor;
    const now = deps.now || Date.now;

    const catalogue = await fetchCatalogue(provider, credentials.values, { fetchImpl: deps.fetchImpl, now: now() });
    if (catalogue.status === 'unauthorized') return { catalogue: catalogue.status, account: RESULT.KEY, lanes: {} };
    const listed = catalogue.status === 'ok' ? new Set(catalogue.entries.map((item) => item.id)) : null;
    // A Hugging Face pin carries a routing policy (`:fastest`) its catalogue does not list.
    const isListed = (model) => !listed || listed.has(model) || listed.has(model.split(':')[0]);

    let tests = 0;
    let account = null;
    const test = async (lane, model) => {
        if (tests > 0) await sleep(TEST_SPACING_MS);
        tests += 1;
        const outcome = await verify({ provider, lane, model, credentials, config, deps });
        if (ACCOUNT.has(outcome.result)) account = outcome.result;
        return outcome;
    };
    const mayTest = () => !account && tests < MAX_TESTS_PER_PROVIDER && now() < deadlineAt;

    const lanes = {};
    for (const { lane, capability } of lanesOf(provider)) {
        if (operatorChose(provider, capability, config)) {
            lanes[lane] = { status: 'skipped', reason: 'operator', models: resolveModels(provider, capability, config), results: [] };
            continue;
        }
        const current = resolveModels(provider, capability, config);
        const checked = new Map();
        for (const model of current) {
            if (!isListed(model)) {
                checked.set(model, { model, result: RESULT.GONE, category: 'not_listed' });
            } else if (mayTest()) {
                checked.set(model, await test(lane, model));
            }
        }

        const room = MAX_VERSIONS_PER_LANE - current.filter((model) => !DISQUALIFYING.has(checked.get(model)?.result)).length;
        const additions = [];
        const tried = [];
        if (room > 0 && catalogue.status === 'ok') {
            for (const candidate of candidatesFor(provider.id, lane, catalogue.entries, current)) {
                if (additions.length >= room || tried.length >= MAX_CANDIDATES_PER_LANE || !mayTest()) break;
                const outcome = await test(lane, candidate);
                tried.push(outcome);
                if (outcome.result === RESULT.PASSED) additions.push(candidate);
            }
        }

        lanes[lane] = {
            ...decideLane({ current, checked, additions }),
            previous: current,
            results: [...checked.values(), ...tried].map(({ model, result, category }) => ({ model, result, category: category || null })),
        };
    }
    return { catalogue: catalogue.status, account, lanes };
}

module.exports = {
    MAX_TESTS_PER_PROVIDER,
    MAX_CANDIDATES_PER_LANE,
    TEST_SPACING_MS,
    lanesOf,
    operatorChose,
    decideLane,
    checkProvider,
};
