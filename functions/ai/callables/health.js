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
const { testProviderConnection } = require('../tasks/healthCheck');
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
