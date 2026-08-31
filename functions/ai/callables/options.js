/**
 * What every AI Integrations callable is built from: the `onCall` options, the
 * mask, and the small guards that turn a browser-supplied provider id into a
 * registry entry.
 *
 * **The `firebase-functions/v2` import belongs in this file, next to the
 * `secrets:` literal.** `test/unit/secretBindingGenerations.test.js` decides
 * which service accounts must be able to read a secret by scanning for
 * `secrets: [...]` and then asking, of the *same file*, which generation it
 * imports — a file declaring a binding without stating its generation is skipped
 * outright. Re-exporting `onCall` and `HttpsError` from here keeps the
 * declaration and the generation together and gives every handler module one
 * import instead of two.
 *
 * Be precise about what that guard would and would not have caught, because it
 * is easy to over-read: it asserts that nothing is bound from a generation
 * `EXPECTED` does not list, and that no `EXPECTED` entry names a secret nothing
 * binds. It does **not** assert that a secret is still bound from every
 * generation listed. So separating this literal from its import would have been
 * *silent*, not caught. What the guard does catch — and the reason the pairing
 * above matters — is a binding turning up under the wrong generation, which is
 * exactly what a careless split of a mixed v1/v2 file would produce.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');

const { getProvider, isRetired } = require('../registry/providers');
const store = require('../credentials/store');

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
