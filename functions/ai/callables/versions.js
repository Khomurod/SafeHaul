/**
 * The model versions table: which versions each provider's lanes use now, what
 * the daily check last found, "check now", and the auto-select switch.
 *
 * Part of the AI Integrations callable surface. `onCall`, `HttpsError` and the
 * shared options and guards come from `./options` — see the note there about
 * why the `firebase-functions/v2` import lives beside the `secrets:` literal.
 *
 * The check itself is `../../ops/modelRefresh.js`; "check now" runs the same
 * pass the hourly schedule does, for every provider at once, and the lease there
 * keeps it from overlapping a scheduled run.
 */

const { HttpsError, callableOptions, onCall, safeFailure } = require('./options');

const { assertSuperAdmin, assertWithinRateLimit, guardPrivileged } = require('../../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../../environmentVault/audit');
const { PROVIDERS, isRetired, resolveModels } = require('../registry/providers');
const routingOrder = require('../router/order');
const store = require('../credentials/store');
const { lanesOf, operatorChose } = require('../tasks/modelCheck');
const { RESULT } = require('../tasks/modelVerification');
const {
    credentialsReady, readCheckState, runModelRefresh, setAutoSelect,
} = require('../../ops/modelRefresh');

/**
 * "Check now" stops starting tests after this: the last one ends within its own
 * 25 s, and saving and the Telegram message fit in what is left of 180 s.
 */
const CHECK_NOW_BUDGET_MS = 120 * 1000;

const LANE_STATUSES = new Set(['ok', 'failing', 'unknown', 'skipped']);
const RESULTS_KNOWN = new Set(Object.values(RESULT));
const REASONS = new Set(['first', 'daily', 'failing', 'requested']);
const ACCOUNT_RESULTS = new Set([RESULT.KEY, RESULT.QUOTA]);

const modelIds = (value) => (Array.isArray(value) ? value.filter((id) => typeof id === 'string').slice(0, 6) : null);
const isoOrNull = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null);

/**
 * One provider's row, rebuilt field by field: what crosses the boundary is an
 * allowlist, not whatever the stored record happens to hold.
 *
 * `models` is what the router uses now (`resolveModels`), whatever the last
 * check recorded, so the table cannot describe a list the router is not using.
 */
function versionsRow(provider, config, ready) {
    const check = config.modelCheck || {};
    let state = 'ready';
    if (config.enabled === false) state = 'off';
    else if (!ready) state = 'not_set_up';

    const lanes = lanesOf(provider).map(({ lane, capability }) => {
        const found = check.lanes?.[lane] || {};
        const results = Array.isArray(found.results) ? found.results : [];
        const resultOf = (model) => {
            const entry = results.find((item) => item?.model === model);
            return RESULTS_KNOWN.has(entry?.result) ? entry.result : null;
        };
        let status = LANE_STATUSES.has(found.status) ? found.status : null;
        // Chosen by hand since the last check: what it found is about another list.
        if (operatorChose(provider, capability, config)) status = 'skipped';
        return {
            id: lane,
            models: resolveModels(provider, capability, config).map((model) => ({ id: model, result: resultOf(model) })),
            status,
            // Only while auto-select is off: what the check would have changed the list to.
            suggested: modelIds(found.suggested),
        };
    });

    return {
        id: provider.id,
        displayName: provider.displayName,
        state,
        account: ACCOUNT_RESULTS.has(check.account) ? check.account : null,
        checkedAt: isoOrNull(check.checkedAt),
        reason: REASONS.has(check.reason) ? check.reason : null,
        lanes,
    };
}

/** The whole table, in the order the router tries providers. */
async function readVersions() {
    const [configs, storedOrder, checkState] = await Promise.all([
        store.readAllConfigs(),
        routingOrder.readProviderOrder(),
        readCheckState(),
    ]);
    const providers = routingOrder.orderProviders(PROVIDERS, storedOrder).filter((provider) => !isRetired(provider));
    // The same test the check applies (`credentialsReady`), so "not set up" means "the check skips it".
    const ready = await Promise.all(providers.map((provider) => store.resolveCredentials(provider.id)
        .then(credentialsReady)
        .catch(() => false)));
    return {
        ...checkState,
        providers: providers.map((provider, index) => versionsRow(provider, configs.get(provider.id) || { enabled: true }, ready[index])),
        generatedAt: new Date().toISOString(),
    };
}

exports.getAiModelVersions = onCall(callableOptions, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST);
    await assertWithinRateLimit(request, 'list', ACTIONS.LIST);

    try {
        const versions = await readVersions();
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.LIST,
            result: RESULTS.SUCCESS,
            metadata: { integration: 'AI model versions', entryCount: versions.providers.length },
        });
        return versions;
    } catch (error) {
        return safeFailure(error, 'getAiModelVersions');
    }
});

/**
 * Runs the daily check now, for every enabled provider with its key. A change of
 * what the router uses, when auto-select is on, so it is guarded as a mutation.
 */
exports.checkAiModelVersionsNow = onCall({
    ...callableOptions,
    // Above the default 60 s: three providers' tests run side by side, and one
    // provider alone can spend a minute on a busy day.
    timeoutSeconds: 180,
}, async (request) => {
    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, { setting: 'model-check' });

    try {
        const outcome = await runModelRefresh({ force: true, budgetMs: CHECK_NOW_BUDGET_MS });
        // A provider whose check threw is not one the table can call checked.
        const checkedCount = Math.max(0, (outcome.checked?.length || 0) - (outcome.errors || 0));
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.UPDATE,
            result: outcome.skipped ? RESULTS.FAILED : RESULTS.SUCCESS,
            metadata: {
                integration: 'AI model versions',
                setting: 'model-check',
                checkedCount,
                reason: outcome.skipped ? 'already-running' : null,
            },
        });
        return { skipped: outcome.skipped ? 'running' : null, checkedCount, ...(await readVersions()) };
    } catch (error) {
        return safeFailure(error, 'checkAiModelVersionsNow');
    }
});

exports.setAiModelAutoSelect = onCall(callableOptions, async (request) => {
    const enabled = request.data?.enabled;

    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, {
        setting: 'model-auto-select', enabled: typeof enabled === 'boolean' ? enabled : null,
    });

    try {
        if (typeof enabled !== 'boolean') {
            throw new HttpsError('invalid-argument', 'Say whether auto-select should be on or off.');
        }
        await setAutoSelect(enabled);
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.UPDATE,
            result: RESULTS.SUCCESS,
            metadata: { integration: 'AI model versions', setting: 'model-auto-select', enabled },
        });
        // Awaited, so a failed read reaches the catch below rather than the caller unmapped.
        return await readVersions();
    } catch (error) {
        return safeFailure(error, 'setAiModelAutoSelect');
    }
});

exports.CHECK_NOW_BUDGET_MS = CHECK_NOW_BUDGET_MS;
exports.versionsRow = versionsRow;
