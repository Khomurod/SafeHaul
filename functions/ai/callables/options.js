/**
 * What every AI Integrations callable is built from: the `onCall` options, the
 * mask, and the small guards that turn a browser-supplied provider id into a
 * registry entry.
 *
 * `onCall` and `HttpsError` are re-exported from here, which gives every
 * handler module one import instead of two and keeps the `firebase-functions/v2`
 * import beside the options. Keep it there if the options ever bind a secret:
 * `test/unit/secretBindingGenerations.test.js` reads which generation binds a
 * `secrets: [...]` declaration from the import in the *same file*, and skips a
 * file that states none.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');

const { getProvider } = require('../registry/providers');
const store = require('../credentials/store');

const callableOptions = {
    cors: true,
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
function requireRegisteredProvider(providerId) {
    const provider = getProvider(providerId);
    if (!provider) {
        throw new HttpsError('not-found', 'Unknown AI provider.');
    }
    return provider;
}

/** Resolves a credential field name against the provider's declared fields. */
function requireCredentialField(provider, fieldName) {
    const field = provider.secretFields.find((candidate) => candidate.name === fieldName);
    if (!field) throw new HttpsError('not-found', 'Unknown credential field.');
    return field;
}

/**
 * Confirms a just-written credential can actually be read back.
 *
 * Returns a report, never a value or its length — the value's length is already
 * recorded in the audit trail, where it belongs, and does not need to travel to
 * a browser as well.
 */
async function verifyCredentialReadable(provider, field) {
    const read = await store.readCredentials(provider.id).catch(() => null);
    if (read === null) {
        return {
            readable: false,
            message: 'Saved, but SafeHaul could not read it back. Grant roles/secretmanager.secretAccessor'
                + ' on this secret to the Functions runtime service account, then run the credential access check.',
        };
    }
    if (Array.isArray(read.unreadable) && read.unreadable.includes(field.name)) {
        return {
            readable: false,
            message: 'Saved, but this runtime is not permitted to read it. Grant'
                + ' roles/secretmanager.secretAccessor on this secret to the Functions runtime service account.'
                + ' 1st and 2nd generation functions use different accounts — check both.',
        };
    }
    if (!read.values?.[field.name]) {
        return {
            readable: false,
            message: 'Saved, but the new version did not read back. Try the credential access check.',
        };
    }
    return { readable: true, message: null };
}

module.exports = {
    HttpsError,
    MASK,
    callableOptions,
    onCall,
    requireCredentialField,
    requireRegisteredProvider,
    safeFailure,
    verifyCredentialReadable,
};
