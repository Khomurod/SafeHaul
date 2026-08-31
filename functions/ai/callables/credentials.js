/**
 * Reading a credential back, diagnosing why one cannot be read, and the
 * one-time Groq migration.
 *
 * Part of the AI Integrations callable surface. `onCall`, `HttpsError` and the
 * shared options and guards come from `./options` — see the note there about
 * why the `firebase-functions/v2` import lives beside the `secrets:` literal.
 */

const {
    HttpsError, callableOptions, onCall, requireCredentialField, requireRegisteredProvider,
    safeFailure,
} = require('./options');

const {
    guardPrivileged, assertSuperAdmin, assertWithinRateLimit,
} = require('../../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../../environmentVault/audit');
const { buildSecretId } = require('../credentials/secretManager');
const store = require('../credentials/store');
const { testProviderConnection } = require('../tasks/healthCheck');
const { diagnoseCredentialAccess } = require('../tasks/credentialAccess');
// ---------------------------------------------------------------------------
// Reveal — exactly one credential, per request
// ---------------------------------------------------------------------------

exports.revealAiCredential = onCall(callableOptions, async (request) => {
    const providerId = String(request.data?.providerId || '');
    const fieldName = String(request.data?.field || '');

    await guardPrivileged(request, 'reveal', ACTIONS.REVEAL, { providerId, field: fieldName });

    try {
        const provider = requireRegisteredProvider(providerId, 'read');
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

// ---------------------------------------------------------------------------
// Groq credential migration
// ---------------------------------------------------------------------------

/**
 * Copies the legacy `GROQ_API_KEY` deploy binding into the managed credential
 * store, entirely server-side.
 *
 * The token is read from the function's own runtime environment and written
 * straight to Secret Manager. It is never returned to the browser, never
 * placed in a response, and never logged — an operator can migrate without
 * ever seeing the value, and revealing it stays a separate, separately-audited
 * action.
 *
 * The old binding is deliberately left in place. `resolveCredentials` prefers
 * the managed credential and falls back to the legacy one, so until an
 * operator removes the binding there is a working rollback path that needs no
 * code change. `docs/ai-platform.md` documents the final cleanup.
 */
exports.migrateGroqCredential = onCall(callableOptions, async (request) => {
    await guardPrivileged(request, 'mutate', ACTIONS.ADD, { providerId: 'groq' });

    try {
        const provider = requireRegisteredProvider('groq');
        const legacyValue = process.env.GROQ_API_KEY;

        if (!legacyValue || !legacyValue.trim()) {
            throw new HttpsError('failed-precondition', 'There is no legacy Groq binding on this runtime to migrate.');
        }

        const existing = await store.readCredentials('groq').catch(() => ({ values: {} }));
        if (existing.values?.apiKey) {
            return {
                providerId: 'groq',
                migrated: false,
                alreadyManaged: true,
                verified: null,
                message: 'Groq already has a managed credential. Replace it directly if you need to change it.',
            };
        }

        const saved = await store.saveCredential('groq', 'apiKey', legacyValue.trim());

        // Verify against Groq before declaring the migration good. A migration
        // that silently wrote a stale or truncated value would look successful
        // right up until the next driver tried to auto-fill a licence.
        const verification = await testProviderConnection('groq');

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.ADD,
            result: verification.success ? RESULTS.SUCCESS : RESULTS.FAILED,
            metadata: {
                providerId: 'groq',
                field: 'apiKey',
                key: saved.secretId,
                integration: `${provider.displayName} (AI)`,
                sensitivity: 'critical',
                valueLength: saved.valueLength,
                reason: verification.success ? 'migrated-and-verified' : `verification-${verification.category}`,
            },
        });

        return {
            providerId: 'groq',
            migrated: true,
            alreadyManaged: false,
            verified: verification.success,
            // Safe category text only.
            message: verification.success
                ? 'Groq credential migrated to Secret Manager and verified. The legacy binding is retained as a rollback path.'
                : `Credential migrated, but verification failed: ${verification.message} The legacy binding is still active.`,
        };
    } catch (error) {
        return safeFailure(error, 'migrateGroqCredential');
    }
});
