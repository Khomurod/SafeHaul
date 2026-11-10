/**
 * Reading a credential back, and diagnosing why one cannot be read.
 *
 * Part of the AI Integrations callable surface. `onCall`, `HttpsError` and the
 * shared options and guards come from `./options` — see the note there about
 * why the `firebase-functions/v2` import lives beside the options.
 */

const {
    callableOptions, onCall, requireCredentialField, requireRegisteredProvider, safeFailure,
} = require('./options');

const {
    guardPrivileged, assertSuperAdmin, assertWithinRateLimit,
} = require('../../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../../environmentVault/audit');
const { buildSecretId } = require('../credentials/secretManager');
const store = require('../credentials/store');
const { diagnoseCredentialAccess } = require('../tasks/credentialAccess');
// ---------------------------------------------------------------------------
// Reveal — exactly one credential, per request
// ---------------------------------------------------------------------------

exports.revealAiCredential = onCall(callableOptions, async (request) => {
    const providerId = String(request.data?.providerId || '');
    const fieldName = String(request.data?.field || '');

    await guardPrivileged(request, 'reveal', ACTIONS.REVEAL, { providerId, field: fieldName });

    try {
        const provider = requireRegisteredProvider(providerId);
        const field = requireCredentialField(provider, fieldName);
        const revealed = await store.revealCredential(provider.id, field.name);

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.REVEAL,
            result: revealed.value ? RESULTS.SUCCESS : RESULTS.UNAVAILABLE,
            metadata: {
                providerId: provider.id,
                field: field.name,
                key: buildSecretId(provider.id, field.name),
                integration: `${provider.displayName} (AI)`,
                sensitivity: 'critical',
                // The length is the only fact about the value ever recorded,
                // and only so an operator can tell a truncated paste from a
                // whole key.
                valueLength: revealed.value ? revealed.value.length : 0,
            },
        });

        if (!revealed.value) {
            return {
                providerId: provider.id,
                field: field.name,
                value: null,
                unavailableReason: 'This credential is not configured.',
            };
        }

        return {
            providerId: provider.id,
            field: field.name,
            value: revealed.value,
            source: revealed.source,
            unavailableReason: null,
        };
    } catch (error) {
        return safeFailure(error, 'revealAiCredential');
    }
});

// ---------------------------------------------------------------------------
// Credential access diagnosis
// ---------------------------------------------------------------------------

/**
 * Reports whether this runtime can read the AI credentials, and as whom.
 *
 * Read `../tasks/credentialAccess.js` for why this is a product feature rather
 * than something to work out with `gcloud`. The short version: AI credentials are
 * read at runtime, nothing grants the runtime service account access
 * automatically, and 1st and 2nd generation functions default to *different*
 * service accounts — so a grant can fix some AI entry points and not others,
 * which from the outside reads as "AI works sometimes".
 *
 * This is the 2nd generation answer. `exports.diagnoseAiCredentialAccessV1` in
 * ./callablesV1.js is the 1st generation one, and the console shows both,
 * because the difference between them is the diagnosis.
 *
 * It is a read, so it takes the `list` guard rather than the mutate budget: no
 * value is revealed, so requiring a re-authentication to look at IAM state would
 * be friction without a security benefit.
 */
exports.diagnoseAiCredentialAccess = onCall(callableOptions, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST, { integration: 'AI credential access' });
    await assertWithinRateLimit(request, 'list', ACTIONS.LIST, { integration: 'AI credential access' });

    try {
        const report = await diagnoseCredentialAccess({ generation: 'v2' });

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.LIST,
            result: RESULTS.SUCCESS,
            metadata: {
                integration: 'AI credential access',
                setting: 'gen2',
                entryCount: report.providers.length,
                reason: report.unreadableCount > 0 ? 'credentials-unreadable' : null,
            },
        });

        return report;
    } catch (error) {
        return safeFailure(error, 'diagnoseAiCredentialAccess');
    }
});
