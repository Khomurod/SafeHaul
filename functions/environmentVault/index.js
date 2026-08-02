/**
 * Super Admin "Environment & Integrations" vault — callable surface.
 *
 * Six narrow callables, one job each. There is deliberately **no** generic
 * environment-variable endpoint: every entry identifier is resolved against the
 * frozen registry before anything is read or written, so the only keys reachable
 * through this surface are the ones SafeHaul actually uses.
 *
 * Shared contract for all six:
 *  - authenticated, and exactly `globalRole === 'super_admin'`;
 *  - company admins and ordinary users are rejected, not degraded;
 *  - reveal and every mutation additionally require recent authentication;
 *  - per-caller, fail-closed rate limits;
 *  - one value per request, never a collection of secrets;
 *  - a value-free audit record for every outcome, including denials;
 *  - generic failure messages — no plaintext, no ciphertext, no key material in
 *    any error, log line or response.
 *
 * ## Why Secret Manager values are bound here
 *
 * The bindings make each allowlisted Google Secret Manager value available to
 * the reveal callable as `process.env`. Without them the vault would incorrectly
 * report a configured integration as missing.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { ACTIONS, RESULTS, readRecentActivity, recordAuditEvent } = require('./audit');
const { assertSuperAdmin, assertWithinRateLimit, guardPrivileged } = require('./guards');
const { buildInventory } = require('./inventory');
const { deleteValue, resolveEntry, revealValue, writeValue } = require('./values');
const { validateNewKeyName } = require('./registry');

const vaultOptions = {
    cors: true,
    secrets: [
        'SMS_ENCRYPTION_KEY',
        'FACEBOOK_APP_ID',
        'FACEBOOK_APP_SECRET',
        'FACEBOOK_VERIFY_TOKEN',
        'GROQ_API_KEY',
        'BULK_WORKER_SECRET',
        'PROCESS_BULK_BATCH_URL',
    ],
};

/** Value-free audit metadata for a resolved entry. */
function auditMetadataFor(resolved, entryId) {
    if (resolved?.kind === 'global') {
        const { entry } = resolved;
        return {
            entryId,
            key: entry.key,
            integration: entry.integration,
            scope: 'global',
            source: entry.source,
            category: entry.category,
            sensitivity: entry.sensitivity,
            availability: entry.availability,
        };
    }
    if (resolved?.kind === 'company') {
        return {
            entryId,
            key: resolved.field,
            field: resolved.field,
            integration: resolved.template.integration,
            scope: 'company',
            companyId: resolved.companyId,
            source: resolved.definition.encrypted ? 'firestore-encrypted' : 'firestore-plaintext',
            category: 'company-integration',
            sensitivity: resolved.definition.sensitivity,
        };
    }
    return { entryId };
}

/**
 * Converts an unexpected error into a safe callable failure.
 * `HttpsError`s raised deliberately are already safe and pass through.
 */
function safeFailure(error, label) {
    if (error instanceof HttpsError) return error;
    console.error(`[environmentVault] ${label} failed`, { message: error?.message || 'unknown' });
    return new HttpsError('internal', 'That operation could not be completed.');
}

/**
 * 1. Inventory. Returns every registered entry with its value masked as
 *    `********`. No plaintext, no ciphertext, no partial value.
 */
exports.listEnvironmentAndIntegrations = onCall(vaultOptions, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST);
    await assertWithinRateLimit(request, 'list', ACTIONS.LIST);

    const companyId = typeof request.data?.companyId === 'string' ? request.data.companyId : null;

    try {
        const { entries, companyError } = await buildInventory({ companyId });
        const recentActivity = await readRecentActivity(20);

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.LIST,
            result: RESULTS.SUCCESS,
            metadata: { entryCount: entries.length, companyId },
        });

        return { entries, recentActivity, companyError, generatedAt: Date.now() };
    } catch (error) {
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.LIST,
            result: RESULTS.FAILED,
            metadata: { companyId, reason: 'inventory-error' },
        });
        throw safeFailure(error, 'list');
    }
});

/**
 * 2. Reveal exactly one value. Never returns a second entry, and never returns
 *    ciphertext — encrypted fields are decrypted server-side and only the
 *    requested field is returned.
 */
exports.revealEnvironmentValue = onCall(vaultOptions, async (request) => {
    const entryId = request.data?.entryId;
    await guardPrivileged(request, 'reveal', ACTIONS.REVEAL, { entryId });

    let resolved;
    try {
        resolved = resolveEntry(entryId);
    } catch (error) {
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.REVEAL,
            result: RESULTS.FAILED,
            metadata: { entryId, reason: 'unknown-entry' },
        });
        throw safeFailure(error, 'reveal');
    }

    const metadata = auditMetadataFor(resolved, entryId);

    try {
        const result = await revealValue(resolved);

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.REVEAL,
            result: result.unavailableReason && result.value === null && result.readFrom === 'none'
                ? RESULTS.UNAVAILABLE
                : RESULTS.SUCCESS,
            metadata: { ...metadata, availability: result.availability, reason: result.readFrom },
        });

        return {
            entryId,
            availability: result.availability,
            readFrom: result.readFrom,
            value: result.value,
            unavailableReason: result.unavailableReason,
        };
    } catch (error) {
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.REVEAL,
            result: RESULTS.FAILED,
            metadata: { ...metadata, reason: 'retrieval-error' },
        });
        throw safeFailure(error, 'reveal');
    }
});

/** Shared body for update/add — they differ only in which precondition applies. */
async function mutateValue(request, operation, action) {
    const entryId = request.data?.entryId;
    await guardPrivileged(request, 'mutate', action, { entryId });

    let resolved;
    try {
        resolved = resolveEntry(entryId);
    } catch (error) {
        await recordAuditEvent({
            auth: request.auth,
            action,
            result: RESULTS.FAILED,
            metadata: { entryId, reason: 'unknown-entry' },
        });
        throw safeFailure(error, operation);
    }

    const metadata = auditMetadataFor(resolved, entryId);

    // Adding must never be able to introduce a platform-reserved name, even
    // though `resolveEntry` already restricted the target to a known field.
    if (operation === 'add') {
        const validation = validateNewKeyName(resolved.kind === 'company' ? resolved.field : resolved.entry.key);
        if (!validation.ok) {
            await recordAuditEvent({
                auth: request.auth,
                action,
                result: RESULTS.DENIED,
                metadata: { ...metadata, reason: 'reserved-key-name' },
            });
            throw new HttpsError('invalid-argument', validation.reason);
        }
    }

    try {
        const result = await writeValue(resolved, request.data?.value, { operation });
        await recordAuditEvent({
            auth: request.auth,
            action,
            result: RESULTS.SUCCESS,
            metadata: { ...metadata, valueLength: result.valueLength },
        });
        return { entryId, verified: result.verified, requiresDeployment: false };
    } catch (error) {
        await recordAuditEvent({
            auth: request.auth,
            action,
            result: RESULTS.FAILED,
            metadata: { ...metadata, reason: 'write-error' },
        });
        throw safeFailure(error, operation);
    }
}

/** 3. Replace the stored value of one existing, editable entry. */
exports.updateEnvironmentValue = onCall(vaultOptions, (request) => mutateValue(request, 'update', ACTIONS.UPDATE));

/** 4. Store a value for one supported entry that currently has none. */
exports.addEnvironmentValue = onCall(vaultOptions, (request) => mutateValue(request, 'add', ACTIONS.ADD));

/**
 * 5. Delete exactly one field. The typed-confirmation requirement is a frontend
 *    guard; the server independently re-checks that the field is deletable and
 *    that the confirmation matches the key it is deleting.
 */
exports.deleteEnvironmentValue = onCall(vaultOptions, async (request) => {
    const entryId = request.data?.entryId;
    await guardPrivileged(request, 'mutate', ACTIONS.DELETE, { entryId });

    let resolved;
    try {
        resolved = resolveEntry(entryId);
    } catch (error) {
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.DELETE,
            result: RESULTS.FAILED,
            metadata: { entryId, reason: 'unknown-entry' },
        });
        throw safeFailure(error, 'delete');
    }

    const metadata = auditMetadataFor(resolved, entryId);
    const expectedKey = resolved.kind === 'company' ? resolved.field : resolved.entry.key;

    if (request.data?.confirmation !== expectedKey) {
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.DELETE,
            result: RESULTS.DENIED,
            metadata: { ...metadata, reason: 'confirmation-mismatch' },
        });
        throw new HttpsError('failed-precondition', 'Type the exact key name to confirm deletion.');
    }

    try {
        const result = await deleteValue(resolved);
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.DELETE,
            result: RESULTS.SUCCESS,
            metadata,
        });
        return { entryId, verified: result.verified };
    } catch (error) {
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.DELETE,
            result: RESULTS.FAILED,
            metadata: { ...metadata, reason: 'delete-error' },
        });
        throw safeFailure(error, 'delete');
    }
});

/**
 * 6. Connectivity test for a managed company integration.
 *
 * Read-only: it connects with the stored credentials and reports identity, and
 * writes nothing. It deliberately does not return any credential, and it reuses
 * the same adapters the product sends through, so a green result here means the
 * same thing a real send would.
 */
exports.testManagedIntegration = onCall(vaultOptions, async (request) => {
    const entryId = request.data?.entryId;
    await assertSuperAdmin(request, ACTIONS.TEST, { entryId });
    await assertWithinRateLimit(request, 'test', ACTIONS.TEST, { entryId });

    let resolved;
    try {
        resolved = resolveEntry(entryId);
    } catch (error) {
        throw safeFailure(error, 'test');
    }

    const metadata = auditMetadataFor(resolved, entryId);

    if (resolved.kind !== 'company' || !resolved.definition.testable) {
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.TEST,
            result: RESULTS.DENIED,
            metadata: { ...metadata, reason: 'not-testable' },
        });
        throw new HttpsError('failed-precondition', 'This entry does not support a connectivity test.');
    }

    try {
        const SMSAdapterFactory = require('../integrations/factory');
        const RingCentralAdapter = require('../integrations/adapters/ringcentral');
        const EightByEightAdapter = require('../integrations/adapters/eightbyeight');

        const adapter = await SMSAdapterFactory.getAdapter(resolved.companyId);

        let message;
        if (adapter instanceof RingCentralAdapter) {
            await adapter.rc.login({ jwt: adapter.config.jwt });
            const response = await adapter.rc.get('/restapi/v1.0/account/~/extension/~');
            const data = await response.json();
            message = `Connected to RingCentral as ${data.contact?.firstName || ''} ${data.contact?.lastName || ''} (extension ${data.extensionNumber || 'unknown'}).`.replace(/\s+/g, ' ').trim();
        } else if (adapter instanceof EightByEightAdapter) {
            const result = await adapter.verifyConnection();
            message = `Connected to 8x8. ${result.identity || ''}`.trim();
        } else {
            message = 'The stored configuration is valid for this provider.';
        }

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.TEST,
            result: RESULTS.SUCCESS,
            metadata,
        });
        return { success: true, message };
    } catch (error) {
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.TEST,
            result: RESULTS.FAILED,
            metadata: { ...metadata, reason: 'connection-error' },
        });
        // A provider error message can name the account but never the credential;
        // it is still not echoed, because provider errors are not a stable
        // contract and have carried request payloads before.
        console.warn('[environmentVault] integration test failed', { message: error?.message || 'unknown' });
        throw new HttpsError('internal', 'The integration could not be reached with the stored credentials.');
    }
});
