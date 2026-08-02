/**
 * Super Admin → AI Integrations callables.
 *
 * These deliberately reuse the Environment & Integrations vault's guards and
 * audit trail rather than starting a parallel security model. The same rules
 * therefore apply without having to be re-implemented or re-argued:
 *
 *  - exact `globalRole === 'super_admin'`, read from the verified ID token
 *    with no Firestore fallback;
 *  - recent authentication (15 minutes) for every reveal and every mutation;
 *  - fail-closed per-operation rate limits;
 *  - one credential per reveal request;
 *  - value-free audit records in `environment_audit_log`;
 *  - safe, generic errors that never echo a provider's response.
 *
 * The two consoles also share one source of truth: AI credentials live in
 * Secret Manager under `SAFEHAUL_AI_*` and are inventoried by the vault
 * registry, which derives its rows from the same frozen AI provider table used
 * here. There is no second credential store.
 *
 * Provider ids arriving from the browser are resolved through that frozen
 * registry before anything else happens, so no request can name a Secret
 * Manager resource, a URL or a Firestore path of its own choosing.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');

const { guardPrivileged, assertSuperAdmin, assertWithinRateLimit } = require('../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../environmentVault/audit');
const { PROVIDERS, getProvider, isRetired, resolveModel } = require('./registry/providers');
const { CAPABILITY_LABELS } = require('./registry/capabilities');
const { buildSecretId } = require('./credentials/secretManager');
const store = require('./credentials/store');
const { testProviderConnection } = require('./tasks/healthCheck');
const { readRecentTelemetry } = require('./telemetry/record');

const callableOptions = {
    cors: true,
    // The legacy Groq binding must be readable so the console can report the
    // provider as configured before an operator has migrated it, and so the
    // migration itself can verify the old value server-side.
    secrets: ['GROQ_API_KEY'],
};

/** Masked stand-in. Fixed width, so it reveals nothing about real length. */
const MASK = '********';

/** Converts an unexpected error into a generic failure, logging the message only. */
function safeFailure(error, label) {
    if (error instanceof HttpsError) throw error;
    console.error(`[ai/${label}] ${error?.message || 'unknown error'}`);
    throw new HttpsError('internal', 'The request could not be completed.');
}

/**
 * Resolves a browser-supplied provider id through the frozen registry.
 * Everything downstream depends on this having happened.
 */
function requireRegisteredProvider(providerId, action) {
    const provider = getProvider(providerId);
    if (!provider) {
        throw new HttpsError('not-found', 'Unknown AI provider.');
    }
    if (isRetired(provider) && action !== 'read') {
        throw new HttpsError('failed-precondition', provider.retired.reason);
    }
    return provider;
}

/** Resolves a credential field name against the provider's declared fields. */
function requireCredentialField(provider, fieldName) {
    const field = provider.secretFields.find((candidate) => candidate.name === fieldName);
    if (!field) throw new HttpsError('not-found', 'Unknown credential field.');
    return field;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * Builds one console row per provider.
 *
 * No secret value appears anywhere in this response — not masked-with-real-
 * length, not a prefix, not a hash. `configured` is a boolean derived
 * server-side.
 */
async function buildProviderRow(provider, configs) {
    const config = configs.get(provider.id) || { enabled: true };
    const credentials = await store.readCredentials(provider.id).catch(() => ({
        complete: false, values: {}, missing: provider.secretFields.map((f) => f.name),
    }));

    // Groq may still be served by the pre-migration deploy binding.
    let credentialSource = credentials.complete ? 'secret-manager' : null;
    let configured = credentials.complete;
    if (!configured && provider.id === 'groq' && process.env.GROQ_API_KEY) {
        configured = true;
        credentialSource = 'legacy-env';
    }

    const cooldown = store.cooldownState(config);
    const missingConfig = provider.configFields
        .filter((field) => field.required)
        .filter((field) => !(typeof config[field.name] === 'string' && config[field.name].trim()))
        .map((field) => field.name);

    return {
        id: provider.id,
        displayName: provider.displayName,
        priority: provider.priority,
        docsUrl: provider.docsUrl,
        retired: provider.retired || null,
        capabilities: provider.capabilities.map((capability) => ({
            id: capability,
            label: CAPABILITY_LABELS[capability],
        })),
        credentialFields: provider.secretFields.map((field) => ({
            name: field.name,
            label: field.label,
            description: field.description,
            required: field.required,
            configured: Boolean(credentials.values[field.name])
                || (provider.id === 'groq' && field.name === 'apiKey' && credentialSource === 'legacy-env'),
            // Always the same fixed mask. Never a real value or its length.
            maskedValue: MASK,
        })),
        configFields: provider.configFields.map((field) => ({
            name: field.name,
            label: field.label,
            description: field.description,
            required: Boolean(field.required),
            placeholder: field.placeholder || '',
            // Non-secret settings are safe to show in full: an account id or a
            // model slug is configuration, not a credential.
            value: typeof config[field.name] === 'string' ? config[field.name] : '',
        })),
        defaultModels: provider.defaultModels,
        resolvedModels: Object.fromEntries(
            provider.capabilities.map((capability) => [capability, resolveModel(provider, capability, config)]),
        ),
        configured: configured && missingConfig.length === 0,
        missingCredentials: credentials.missing,
        missingConfig,
        credentialSource,
        enabled: config.enabled !== false && !provider.retired,
        health: provider.retired ? 'retired' : (config.health || (configured ? 'unknown' : 'unconfigured')),
        consecutiveFailures: Number(config.consecutiveFailures || 0),
        cooldown: cooldown.active
            ? { active: true, until: cooldown.until, reason: cooldown.reason }
            : { active: false, until: null, reason: null },
        lastTest: config.lastTestAt
            ? {
                at: config.lastTestAt?.toDate?.()?.toISOString?.() || null,
                success: Boolean(config.lastTestSuccess),
                category: config.lastTestCategory || null,
            }
            : null,
        lastSuccessAt: config.lastSuccessAt?.toDate?.()?.toISOString?.() || null,
    };
}

exports.listAiProviders = onCall(callableOptions, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST);
    await assertWithinRateLimit(request, 'list', ACTIONS.LIST);

    try {
        const configs = await store.readAllConfigs();
        const providers = [];
        for (const provider of PROVIDERS) {
            providers.push(await buildProviderRow(provider, configs));
        }

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.LIST,
            result: RESULTS.SUCCESS,
            metadata: { integration: 'AI providers', entryCount: providers.length },
        });

        return {
            providers,
            telemetry: await readRecentTelemetry(25),
            generatedAt: new Date().toISOString(),
        };
    } catch (error) {
        return safeFailure(error, 'listAiProviders');
    }
});

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
// Mutations
// ---------------------------------------------------------------------------

exports.saveAiCredential = onCall(callableOptions, async (request) => {
    const providerId = String(request.data?.providerId || '');
    const fieldName = String(request.data?.field || '');
    const value = request.data?.value;

    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, { providerId, field: fieldName });

    try {
        const provider = requireRegisteredProvider(providerId);
        const field = requireCredentialField(provider, fieldName);

        if (typeof value !== 'string' || !value.trim()) {
            throw new HttpsError('invalid-argument', 'A credential value is required.');
        }
        if (value.length > 8192) {
            throw new HttpsError('invalid-argument', 'That value is too long to be a credential.');
        }

        const existing = await store.readCredentials(provider.id).catch(() => ({ values: {} }));
        const isReplacement = Boolean(existing.values?.[field.name]);

        const result = await store.saveCredential(provider.id, field.name, value.trim());

        await recordAuditEvent({
            auth: request.auth,
            action: isReplacement ? ACTIONS.UPDATE : ACTIONS.ADD,
            result: RESULTS.SUCCESS,
            metadata: {
                providerId: provider.id,
                field: field.name,
                key: result.secretId,
                integration: `${provider.displayName} (AI)`,
                sensitivity: 'critical',
                valueLength: result.valueLength,
            },
        });

        // A new credential is an operator's signal that the provider should be
        // usable again, so clear any cooldown left over from when it was not.
        await store.clearCooldown(provider.id).catch(() => {});

        return { providerId: provider.id, field: field.name, saved: true, replaced: isReplacement };
    } catch (error) {
        return safeFailure(error, 'saveAiCredential');
    }
});

exports.deleteAiCredential = onCall(callableOptions, async (request) => {
    const providerId = String(request.data?.providerId || '');
    const fieldName = String(request.data?.field || '');
    const confirmation = String(request.data?.confirmation || '');

    await guardPrivileged(request, 'mutate', ACTIONS.DELETE, { providerId, field: fieldName });

    try {
        const provider = requireRegisteredProvider(providerId, 'read');
        const field = requireCredentialField(provider, fieldName);

        // Typed confirmation, matching the vault's delete dialog. The server
        // re-checks it so the guard is not merely a UI affordance.
        if (confirmation !== provider.displayName) {
            throw new HttpsError('failed-precondition', 'Type the provider name exactly to confirm deletion.');
        }

        const result = await store.deleteCredential(provider.id, field.name);

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.DELETE,
            result: RESULTS.SUCCESS,
            metadata: {
                providerId: provider.id,
                field: field.name,
                key: result.secretId,
                integration: `${provider.displayName} (AI)`,
                entryCount: result.destroyed,
            },
        });

        return { providerId: provider.id, field: field.name, deleted: true, versionsDestroyed: result.destroyed };
    } catch (error) {
        return safeFailure(error, 'deleteAiCredential');
    }
});

exports.setAiProviderEnabled = onCall(callableOptions, async (request) => {
    const providerId = String(request.data?.providerId || '');
    const enabled = request.data?.enabled !== false;

    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, { providerId, enabled });

    try {
        const provider = requireRegisteredProvider(providerId);
        await store.writeConfig(provider.id, { enabled });
        if (enabled) await store.clearCooldown(provider.id).catch(() => {});

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.UPDATE,
            result: RESULTS.SUCCESS,
            metadata: {
                providerId: provider.id,
                integration: `${provider.displayName} (AI)`,
                setting: 'enabled',
                enabled,
            },
        });

        return { providerId: provider.id, enabled };
    } catch (error) {
        return safeFailure(error, 'setAiProviderEnabled');
    }
});

exports.updateAiProviderConfig = onCall(callableOptions, async (request) => {
    const providerId = String(request.data?.providerId || '');
    const settings = request.data?.settings;

    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, { providerId });

    try {
        const provider = requireRegisteredProvider(providerId);
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            throw new HttpsError('invalid-argument', 'Settings must be an object.');
        }

        let config;
        try {
            // writeConfig rejects any key not declared on the registry row and
            // validates declared patterns, so a malformed Cloudflare account
            // id never reaches a URL.
            config = await store.writeConfig(provider.id, settings);
        } catch (error) {
            throw new HttpsError('invalid-argument', error.message);
        }

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.UPDATE,
            result: RESULTS.SUCCESS,
            metadata: {
                providerId: provider.id,
                integration: `${provider.displayName} (AI)`,
                setting: Object.keys(settings).slice(0, 5).join(','),
            },
        });

        return {
            providerId: provider.id,
            settings: Object.fromEntries(
                provider.configFields.map((field) => [field.name, config[field.name] || '']),
            ),
        };
    } catch (error) {
        return safeFailure(error, 'updateAiProviderConfig');
    }
});

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

exports.testAiProvider = onCall(callableOptions, async (request) => {
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
        };
    } catch (error) {
        return safeFailure(error, 'testAiProvider');
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

exports.__test = { buildProviderRow, MASK, requireRegisteredProvider };
