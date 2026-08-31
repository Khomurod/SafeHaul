/**
 * Everything that changes stored state: saving and deleting a credential,
 * enabling a provider, ordering the fallback, and non-secret config.
 *
 * Part of the AI Integrations callable surface. `onCall`, `HttpsError` and the
 * shared options and guards come from `./options` — see the note there about
 * why the `firebase-functions/v2` import lives beside the `secrets:` literal.
 */

const {
    HttpsError, callableOptions, onCall, requireCredentialField, requireRegisteredProvider,
    safeFailure, verifyCredentialReadable,
} = require('./options');

const { guardPrivileged } = require('../../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../../environmentVault/audit');
const { PROVIDERS } = require('../registry/providers');
const routingOrder = require('../router/order');
const store = require('../credentials/store');
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

        // Read it straight back, and say so if it cannot be read.
        //
        // Writing a secret and reading one need different IAM permissions, and
        // creating a secret grants nobody access to it. So this console could
        // create a credential it was then unable to use, report "saved", and
        // leave the provider skipped as unconfigured on every subsequent
        // request — with the operator reasonably certain they had just fixed it.
        // Verifying here turns a silent, invisible IAM gap into a sentence
        // naming what to grant.
        const verification = await verifyCredentialReadable(provider, field);

        return {
            providerId: provider.id,
            field: field.name,
            saved: true,
            replaced: isReplacement,
            ...verification,
        };
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

/**
 * Replaces the global provider order.
 *
 * The whole submitted list is validated before anything is written, and an
 * unknown id is a rejection rather than a silent drop: quietly discarding an id
 * would let a stale or malformed client shrink the routing order without the
 * operator being told, and a shorter order is a real change in behaviour.
 *
 * A partial list is legitimate — providers the operator did not rank keep their
 * registry positions behind the ones they did — so the only length constraint
 * is that it cannot exceed the registry.
 */
exports.setAiProviderPriority = onCall(callableOptions, async (request) => {
    const submitted = request.data?.providerIds;

    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, { setting: 'routing-order' });

    try {
        if (!Array.isArray(submitted)) {
            throw new HttpsError('invalid-argument', 'A provider order must be a list of provider ids.');
        }
        if (submitted.length > PROVIDERS.length) {
            throw new HttpsError('invalid-argument', 'That order names more providers than exist.');
        }

        const providerIds = [];
        const seen = new Set();
        for (const candidate of submitted) {
            // `read` rather than the default action: the retired GitHub Models
            // row keeps its place in the order so the list stays complete and
            // legible. Ordering it changes nothing — the router skips it as
            // `retired` regardless — whereas refusing the whole write because
            // the list contains it would make the screen impossible to save.
            const provider = requireRegisteredProvider(String(candidate || ''), 'read');
            if (seen.has(provider.id)) {
                throw new HttpsError('invalid-argument', 'That order lists the same provider twice.');
            }
            seen.add(provider.id);
            providerIds.push(provider.id);
        }

        const stored = await routingOrder.writeProviderOrder(providerIds, request.auth?.uid || null);

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.UPDATE,
            result: RESULTS.SUCCESS,
            metadata: {
                integration: 'AI providers',
                setting: 'routing-order',
                entryCount: stored.length,
                providerOrder: stored.join(','),
            },
        });

        // The effective order, not the submitted one: unranked providers are
        // appended in registry order, and returning what the router will
        // actually do is what stops the screen and the router disagreeing.
        return {
            order: routingOrder.orderProviders(PROVIDERS, stored).map((provider) => provider.id),
            saved: true,
        };
    } catch (error) {
        return safeFailure(error, 'setAiProviderPriority');
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
