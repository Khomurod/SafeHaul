/**
 * Source-specific retrieval and mutation for exactly one vault entry.
 *
 * Every function here takes a single resolved entry and returns a single value.
 * There is deliberately no "read everything" path: `process.env` is never
 * serialised, a Firestore integration document is never returned whole, and a
 * reveal for one key can never surface a second one.
 *
 * ## Live re-derivation, not client trust
 *
 * The permissions attached to a row in the list response are a *rendering* aid.
 * Every mutation here re-reads the registry definition and the live document
 * before acting, so a client that edits its own payload cannot widen what it is
 * allowed to do.
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('../firebaseAdmin');
const { decrypt, encrypt } = require('../integrations/encryption');
const {
    AVAILABILITY,
    getCompanyField,
    getCompanyTemplate,
    getGlobalEntry,
} = require('./registry');

/** Shown verbatim when a source cannot return what it stored. */
const UNAVAILABLE_MESSAGE = 'The source does not permit reading the saved value.';

/** Ciphertext produced by `integrations/encryption.js` is `ivHex:payloadHex`. */
const CIPHERTEXT_PATTERN = /^[0-9a-f]+:[0-9a-f]+$/i;

/**
 * Parses a company row id of the form
 * `company:{companyId}:{templateId}[:{instanceKey}]:{field}`.
 *
 * The instance key is a Firestore document id and is unique by construction —
 * never the free-text label, which two records may share. Document ids can
 * contain `:`, so the field is taken from the end and the key is whatever is
 * left in between.
 */
function parseCompanyEntryId(entryId) {
    const parts = String(entryId).split(':');
    if (parts.length < 4 || parts[0] !== 'company') return null;

    const companyId = parts[1];
    const templateId = parts[2];
    const field = parts[parts.length - 1];
    const instanceKey = parts.length > 4 ? parts.slice(3, -1).join(':') : null;

    if (!companyId || !templateId || !field) return null;
    return { companyId, templateId, field, instanceKey };
}

/**
 * Resolves an entry id to either a global registry entry or a validated
 * company-scoped field descriptor. Rejects anything the registry does not know.
 */
function resolveEntry(entryId) {
    if (typeof entryId !== 'string' || entryId.length === 0 || entryId.length > 300) {
        throw new HttpsError('invalid-argument', 'A valid entry identifier is required.');
    }

    const globalEntry = getGlobalEntry(entryId);
    if (globalEntry) return { kind: 'global', entry: globalEntry };

    const parsed = parseCompanyEntryId(entryId);
    if (!parsed) {
        throw new HttpsError('not-found', 'Unknown configuration entry.');
    }

    const template = getCompanyTemplate(parsed.templateId);
    const definition = getCompanyField(parsed.templateId, parsed.field);
    if (!template || !definition) {
        throw new HttpsError('not-found', 'Unknown configuration entry.');
    }

    return { kind: 'company', ...parsed, template, definition };
}

/**
 * Firestore reference for the document a company entry lives on.
 *
 * The instance key is always a document id, so every path here is built from
 * ids the inventory produced rather than from anything a caller typed. A key
 * containing a path separator would address a different collection, so it is
 * rejected outright.
 */
async function resolveCompanyDocument(resolved) {
    const { companyId, templateId, instanceKey } = resolved;

    if (instanceKey && instanceKey.includes('/')) {
        throw new HttpsError('invalid-argument', 'That entry identifier is not valid.');
    }

    switch (templateId) {
        case 'sms_provider':
            return db.collection('companies').doc(companyId)
                .collection('integrations').doc('sms_provider');
        case 'sms_keychain':
            return instanceKey
                ? db.collection('companies').doc(companyId)
                    .collection('integrations').doc('sms_provider')
                    .collection('keychain').doc(instanceKey)
                : null;
        case 'email_config':
            return db.collection('companies').doc(companyId)
                .collection('system_settings').doc('email_config');
        case 'facebook_page':
            return instanceKey ? db.collection('integrations_index').doc(instanceKey) : null;
        default:
            return null;
    }
}

/** Reads the stored (possibly encrypted) field off a company document. */
function readStoredField(data, resolved) {
    const { definition, field } = resolved;
    const container = definition.inConfig ? (data.config || {}) : data;
    return container[field];
}

/**
 * Decrypts a stored credential field.
 *
 * Values written before the encryption chokepoint existed are plaintext, and a
 * stored boolean (`isSandbox`) is never encrypted. Both are returned as-is
 * rather than being fed to `decrypt`, which would throw on a malformed IV.
 */
function decryptStored(stored, definition) {
    if (stored === null || stored === undefined) return null;
    if (typeof stored === 'boolean') return String(stored);
    if (typeof stored === 'number') return String(stored);
    if (typeof stored !== 'string') return null;
    if (!definition.encrypted) return stored;
    if (!CIPHERTEXT_PATTERN.test(stored)) return stored;
    return decrypt(stored);
}

/**
 * Retrieves the current value of one entry.
 *
 * @returns {Promise<{availability: string, value: string|null, unavailableReason: string|null, readFrom: string}>}
 */
async function revealValue(resolved) {
    if (resolved.kind === 'global') {
        const { entry } = resolved;

        switch (entry.availability) {
            case AVAILABILITY.SERVER_RUNTIME: {
                // Narrow, allowlisted lookup: `entry.key` came from the frozen
                // registry, never from the request payload.
                const value = process.env[entry.key];
                if (value === undefined || value === '') {
                    return {
                        availability: entry.availability,
                        value: null,
                        unavailableReason: 'This key is not configured in the current runtime.',
                        readFrom: 'process-env',
                    };
                }
                return { availability: entry.availability, value, unavailableReason: null, readFrom: 'process-env' };
            }
            case AVAILABILITY.KNOWN_LITERAL:
                return {
                    availability: entry.availability,
                    value: entry.literalValue ?? null,
                    unavailableReason: null,
                    readFrom: 'repository-config',
                };
            case AVAILABILITY.BROWSER_VISIBLE:
                // The Cloud Functions runtime has no access to the browser
                // bundle's build-time values. Saying so is the honest answer;
                // the client resolves this row from the bundle it is running.
                return {
                    availability: entry.availability,
                    value: null,
                    unavailableReason: null,
                    readFrom: 'client-bundle',
                };
            case AVAILABILITY.NOT_RETRIEVABLE:
            default:
                return {
                    availability: AVAILABILITY.NOT_RETRIEVABLE,
                    value: null,
                    unavailableReason: entry.unavailableReason || UNAVAILABLE_MESSAGE,
                    readFrom: 'none',
                };
        }
    }

    const docRef = await resolveCompanyDocument(resolved);
    if (!docRef) throw new HttpsError('not-found', 'That integration record no longer exists.');

    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'That integration record no longer exists.');

    const stored = readStoredField(snap.data() || {}, resolved);
    if (stored === null || stored === undefined || stored === '') {
        return {
            availability: resolved.definition.encrypted
                ? AVAILABILITY.FIRESTORE_ENCRYPTED
                : AVAILABILITY.FIRESTORE_PLAINTEXT,
            value: null,
            unavailableReason: 'Nothing is stored for this field.',
            readFrom: 'firestore',
        };
    }

    let value;
    try {
        value = decryptStored(stored, resolved.definition);
    } catch {
        // Never echo the ciphertext or the crypto error: both are useless to the
        // operator and one of them is sensitive.
        throw new HttpsError('internal', 'This value could not be decrypted with the current encryption key.');
    }

    return {
        availability: resolved.definition.encrypted
            ? AVAILABILITY.FIRESTORE_ENCRYPTED
            : AVAILABILITY.FIRESTORE_PLAINTEXT,
        value,
        unavailableReason: null,
        readFrom: 'firestore',
    };
}

/** Dot path of a company field inside its document. */
function fieldPath(resolved) {
    return resolved.definition.inConfig ? `config.${resolved.field}` : resolved.field;
}

/**
 * Re-derives whether a mutation is allowed, from the registry and the live
 * document — never from the caller's payload.
 */
async function assertMutationAllowed(resolved, operation) {
    if (resolved.kind === 'global') {
        throw new HttpsError(
            'failed-precondition',
            'This key is managed by its source and cannot be changed from here.',
        );
    }

    const { definition } = resolved;
    const docRef = await resolveCompanyDocument(resolved);
    if (!docRef) throw new HttpsError('not-found', 'That integration record no longer exists.');

    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'That integration record no longer exists.');

    const data = snap.data() || {};
    const present = (() => {
        const stored = readStoredField(data, resolved);
        return stored !== null && stored !== undefined && stored !== '';
    })();

    if (definition.providers) {
        const provider = data.provider || null;
        if (!provider || !definition.providers.includes(provider)) {
            throw new HttpsError(
                'failed-precondition',
                'This credential does not apply to the provider currently configured for this company.',
            );
        }
    }

    if (operation === 'update' && !definition.editable) {
        throw new HttpsError('failed-precondition', definition.editReason || 'This value cannot be edited here.');
    }
    if (operation === 'add') {
        if (!(definition.editable || definition.addable)) {
            throw new HttpsError('failed-precondition', 'This key cannot be added here.');
        }
        if (present) {
            throw new HttpsError('already-exists', 'That key already has a stored value. Use Replace instead.');
        }
    }
    if (operation === 'update' && !present) {
        throw new HttpsError('failed-precondition', 'Nothing is stored for this field yet. Use Add instead.');
    }
    if (operation === 'delete') {
        if (!definition.deletable) {
            throw new HttpsError('failed-precondition', definition.deleteReason || 'This value cannot be deleted here.');
        }
        if (!present) {
            throw new HttpsError('failed-precondition', 'Nothing is stored for this field.');
        }
    }

    return { docRef, data };
}

/** Coerces and validates the submitted value for a company field. */
function normalizeSubmittedValue(resolved, rawValue) {
    const { definition } = resolved;

    if (definition.valueType === 'boolean') {
        if (typeof rawValue === 'boolean') return rawValue;
        if (rawValue === 'true') return true;
        if (rawValue === 'false') return false;
        throw new HttpsError('invalid-argument', 'This field accepts only true or false.');
    }

    if (typeof rawValue !== 'string' || rawValue.trim() === '') {
        throw new HttpsError('invalid-argument', 'A non-empty value is required.');
    }
    const trimmed = rawValue.trim();
    if (trimmed.length > 8192) {
        throw new HttpsError('invalid-argument', 'That value is longer than this field accepts.');
    }
    if (trimmed === '__PRESERVE__') {
        // The SMS integration form uses this sentinel to mean "keep what is
        // stored". Accepting it here would write the literal string as a
        // credential and silently break sending.
        throw new HttpsError('invalid-argument', 'That value is reserved and cannot be stored.');
    }
    return trimmed;
}

/**
 * Writes one field, then verifies the write by reading it back and comparing
 * the round-tripped value. Returns only metadata — never the value.
 */
async function writeValue(resolved, rawValue, { operation }) {
    const { docRef } = await assertMutationAllowed(resolved, operation);
    const value = normalizeSubmittedValue(resolved, rawValue);
    const path = fieldPath(resolved);

    const storedValue = typeof value === 'boolean'
        ? value
        : (resolved.definition.encrypted ? encrypt(value) : value);

    await docRef.update({
        [path]: storedValue,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const verifySnap = await docRef.get();
    const roundTripped = decryptStored(readStoredField(verifySnap.data() || {}, resolved), resolved.definition);
    const expected = typeof value === 'boolean' ? String(value) : value;

    if (roundTripped !== expected) {
        throw new HttpsError('internal', 'The value was written but could not be verified. Check the record before retrying.');
    }

    return {
        verified: true,
        valueLength: typeof value === 'boolean' ? null : value.length,
    };
}

/** Deletes exactly one field, leaving every sibling untouched. */
async function deleteValue(resolved) {
    const { docRef } = await assertMutationAllowed(resolved, 'delete');
    const path = fieldPath(resolved);

    await docRef.update({
        [path]: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const verifySnap = await docRef.get();
    const stillThere = readStoredField(verifySnap.data() || {}, resolved);
    if (stillThere !== undefined && stillThere !== null) {
        throw new HttpsError('internal', 'The value could not be removed. Check the record before retrying.');
    }

    return { verified: true };
}

module.exports = {
    CIPHERTEXT_PATTERN,
    UNAVAILABLE_MESSAGE,
    decryptStored,
    deleteValue,
    fieldPath,
    normalizeSubmittedValue,
    parseCompanyEntryId,
    resolveCompanyDocument,
    resolveEntry,
    revealValue,
    writeValue,
};
