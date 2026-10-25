/**
 * The connection test.
 *
 * Part of the AI Integrations callable surface. `onCall`, `HttpsError` and the
 * shared options and guards come from `./options` — see the note there about
 * why the `firebase-functions/v2` import lives beside the `secrets:` literal.
 */

const { callableOptions, onCall, requireRegisteredProvider, safeFailure } = require('./options');

const { assertSuperAdmin, assertWithinRateLimit } = require('../../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../../environmentVault/audit');
const { randomUUID } = require('node:crypto');
const { testProviderConnection, PROBE_STATUS } = require('../tasks/healthCheck');
const { recordAiTelemetry } = require('../telemetry/record');

/**
 * The operator's Test, as one row of the Logs tab's Connection tests, marked
 * `manual`. Only the log: provider health stays the router's, which counts real
 * requests and the hourly watcher's probes, so a test run while diagnosing an
 * outage is never itself counted as one. Each capability probe is one attempt.
 */
function recordManualTest(provider, result) {
    const ran = (result.capabilities || []).filter((probe) => probe.status !== PROBE_STATUS.SKIPPED);
    return recordAiTelemetry({
        transactionId: randomUUID(),
        taskType: 'health_check',
        trigger: 'manual',
        providerId: provider.id,
        model: result.model || null,
        outcome: result.success ? 'success' : 'failure',
        // A test the vendor throttled has no headline category; its first probe's says why.
        category: result.success ? null : (result.category || ran.find((probe) => probe.category)?.category || 'internal'),
        latencyMs: result.latencyMs,
        inputSummary: `${ran.length} capability probe${ran.length === 1 ? '' : 's'}`,
        attempts: ran.map((probe, index) => ({
            providerId: provider.id,
            model: probe.model,
            attemptNumber: index + 1,
            status: probe.status === PROBE_STATUS.NOT_RUN ? 'skipped' : 'attempted',
            skipReason: probe.status === PROBE_STATUS.NOT_RUN ? 'not_run' : null,
            success: probe.status === PROBE_STATUS.PASSED,
            category: probe.category,
            vendorCode: probe.vendorCode,
            httpStatus: probe.httpStatus,
            latencyMs: probe.latencyMs,
        })),
    });
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

exports.testAiProvider = onCall({
    ...callableOptions,
    // The probes run serially and each may take up to `PROBE_TIMEOUT_MS`, so a
    // vision provider's full set does not fit the 60-second default. This is the
    // same mistake the CDL path had — a deadline larger than the function it
    // runs inside — and it bites hardest exactly when an operator is diagnosing
    // a stalled provider. `HEALTH_TOTAL_BUDGET_MS` keeps the work below this.
    timeoutSeconds: 180,
}, async (request) => {
    const providerId = String(request.data?.providerId || '');

    await assertSuperAdmin(request, ACTIONS.TEST, { providerId });
    await assertWithinRateLimit(request, 'test', ACTIONS.TEST, { providerId });

    try {
        const provider = requireRegisteredProvider(providerId, 'read');
        const result = await testProviderConnection(provider.id);
        // Never throws: a log row that cannot be written does not fail the test.
        await recordManualTest(provider, result);

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.TEST,
            result: result.success ? RESULTS.SUCCESS : RESULTS.FAILED,
            metadata: {
                providerId: provider.id,
                integration: `${provider.displayName} (AI)`,
                reason: result.success ? null : result.category,
            },
        });

        // `message` is safe category text produced by the health check, never
        // the vendor's own error body.
        return {
            providerId: provider.id,
            success: result.success,
            message: result.message,
            model: result.model || null,
            latencyMs: result.latencyMs,
            // The per-capability breakdown. Without it the console can only show
            // one verdict, which is exactly the state that let "text works,
            // structured JSON is rejected on every request" read as healthy.
            //
            // Rebuilt field by field rather than spread, for the same reason
            // every other response on this surface is: what crosses the boundary
            // is an allowlist, not whatever the internal shape happens to hold.
            capabilities: (result.capabilities || []).map((probe) => ({
                id: probe.id,
                label: probe.label,
                status: probe.status,
                category: probe.category || null,
                // The vendor's own status line and machine-readable code. Both
                // were captured in providers/http.js and then dropped, which is
                // why this screen could only say "Failed": the difference between
                // `404 model_not_found` and `429` is the difference between
                // repinning a model and waiting a minute. Safe by construction —
                // a status is a number and the code was pattern-validated.
                httpStatus: Number.isInteger(probe.httpStatus) ? probe.httpStatus : null,
                vendorCode: typeof probe.vendorCode === 'string' ? probe.vendorCode : null,
                model: probe.model || null,
                latencyMs: typeof probe.latencyMs === 'number' ? probe.latencyMs : null,
                message: probe.message || '',
            })),
        };
    } catch (error) {
        return safeFailure(error, 'testAiProvider');
    }
});
