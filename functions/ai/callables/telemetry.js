/**
 * The Logs tab: AI transactions, and the model-pin diagnosis beside them.
 *
 * Part of the AI Integrations callable surface. `onCall`, `HttpsError` and the
 * shared options and guards come from `./options` — see the note there about
 * why the `firebase-functions/v2` import lives beside the `secrets:` literal.
 */

const { callableOptions, onCall, safeFailure } = require('./options');

const { assertSuperAdmin, assertWithinRateLimit } = require('../../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../../environmentVault/audit');
const { getProvider } = require('../registry/providers');
const { readTelemetry, MAX_PAGE } = require('../telemetry/record');
const { TASK_TYPES } = require('../tasks/contract');
const { diagnoseModelPins } = require('../tasks/modelPins');
// ---------------------------------------------------------------------------
// Logs — AI transactions, for the AI Integrations → Logs tab
// ---------------------------------------------------------------------------

/**
 * The filter values a browser may send.
 *
 * Validated against SafeHaul's own vocabularies rather than passed through, for
 * the same reason a provider id is only ever *looked up* in the frozen registry:
 * a value from a request must never reach a Firestore query unchecked. An
 * unrecognised value is dropped, not rejected — a stale bookmark should show
 * unfiltered logs, not an error.
 */
const TELEMETRY_OUTCOMES = Object.freeze(['success', 'failure']);
const TASK_TYPE_VALUES = Object.freeze(Object.values(TASK_TYPES));

function normalizeLogFilters(payload = {}) {
    const providerId = getProvider(payload.providerId) ? payload.providerId : null;
    const search = typeof payload.search === 'string'
        // Bounded: this becomes a substring scan, not a query.
        ? payload.search.trim().slice(0, 120)
        : '';

    return {
        taskType: TASK_TYPE_VALUES.includes(payload.taskType) ? payload.taskType : null,
        outcome: TELEMETRY_OUTCOMES.includes(payload.outcome) ? payload.outcome : null,
        providerId,
        search,
        from: typeof payload.from === 'string' ? payload.from : null,
        to: typeof payload.to === 'string' ? payload.to : null,
        limit: Number(payload.limit) || undefined,
    };
}

/**
 * `ai_telemetry` is server-only in the security rules (`allow read: if false`),
 * so the console cannot read it directly and this is the only door. Guarded
 * exactly as `listAiProviders` is — super admin, rate limited, audited — because
 * it is the same kind of surface: operational detail about a credentialed
 * integration.
 */
exports.listAiTelemetry = onCall(callableOptions, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST);
    await assertWithinRateLimit(request, 'list', ACTIONS.LIST);

    try {
        const filters = normalizeLogFilters(request.data || {});
        const { entries, windowSize, truncated } = await readTelemetry(filters);

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.LIST,
            result: RESULTS.SUCCESS,
            // Value-free: which filters were used, never what was returned.
            metadata: {
                integration: 'AI telemetry',
                entryCount: entries.length,
                filtered: Boolean(
                    filters.taskType || filters.outcome || filters.providerId
                    || filters.search || filters.from || filters.to,
                ),
            },
        });

        return {
            entries,
            // The UI says so out loud rather than implying the list is complete.
            truncated,
            windowSize,
            maxWindow: MAX_PAGE,
            generatedAt: new Date().toISOString(),
        };
    } catch (error) {
        return safeFailure(error, 'listAiTelemetry');
    }
});

/**
 * Reconciles every registry model pin against the vendors' live catalogues.
 *
 * The standing guard against the drift that emptied the vision lane: six pins
 * naming models their vendors had retired, invisible to every test because
 * fixtures cannot know what a vendor withdrew. Answering it needs real
 * credentials, so it runs here — on demand, server-side, using the managed
 * credential each provider is already configured with — and is deliberately not
 * wired into CI or any scheduled job.
 *
 * No credential is returned, logged or echoed; the response is model names and
 * whether the vendor still lists them.
 */
exports.diagnoseAiModelPins = onCall(callableOptions, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST);
    await assertWithinRateLimit(request, 'test', ACTIONS.LIST);

    try {
        const result = await diagnoseModelPins();

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.LIST,
            result: RESULTS.SUCCESS,
            metadata: { integration: 'AI model pins', stalePins: result.stalePins },
        });

        return { ...result, generatedAt: new Date().toISOString() };
    } catch (error) {
        return safeFailure(error, 'diagnoseAiModelPins');
    }
});

// Exported for `callables.js`'s `__test` surface: the filter normaliser is
// asserted directly, because what it drops is a security property.
exports.normalizeLogFilters = normalizeLogFilters;
