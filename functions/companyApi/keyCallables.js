/**
 * A Company Admin's API keys: make one, list them, turn one off.
 *
 * Company Admins only (`assertCompanyAdminStrict`), as for every other
 * credential the company holds: a recruiter can read applications on screen,
 * but cannot hand a machine a standing way to read all of them.
 *
 * `company_api_keys/{keyId}` is server-only: no Firestore rule names it, so no
 * client reads it, a Super Admin's included. It keeps the key's hash, never the
 * key, which is returned once by `createCompanyApiKey` and nowhere else.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('../firebaseAdmin');
const { assertCompanyAdminStrict } = require('../shared/companyAccess');
const { checkRateLimit } = require('../shared/rateLimiter');
const {
    KEYS_COLLECTION: KEYS,
    MAX_ACTIVE_KEYS,
    MAX_NAME_LENGTH,
    MINT_LIMIT,
    SCOPES,
    cleanKeyName,
    displayPrefix,
    hashKey,
    keyView,
    millisOf,
    mintKey,
    normalizeScopes,
} = require('./apiKeys');

const KEY_ID = /^[0-9a-f]{16}$/;

function requireText(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new HttpsError('invalid-argument', `${field} is required.`);
    }
    return value.trim();
}

/** The signed-in Company Admin of `companyId`, by uid and the name the records show. */
async function companyAdmin(request, companyId) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Login required.');
    await assertCompanyAdminStrict(uid, companyId);
    return { uid, name: request.auth.token?.name || request.auth.token?.email || null };
}

const activeKeysOf = (companyId) => db.collection(KEYS)
    .where('companyId', '==', companyId)
    .where('revokedAt', '==', null);

exports.createCompanyApiKey = onCall({ cors: true }, async (request) => {
    const companyId = requireText(request.data?.companyId, 'companyId');
    const actor = await companyAdmin(request, companyId);

    const name = cleanKeyName(request.data?.name);
    if (!name) {
        throw new HttpsError('invalid-argument', `Give the key a name of 1 to ${MAX_NAME_LENGTH} characters.`);
    }
    const resolved = normalizeScopes(request.data?.scopes);
    if (resolved.unknown) {
        throw new HttpsError('invalid-argument', `Unknown permission: ${resolved.unknown.join(', ')}.`);
    }
    const allowed = await checkRateLimit(`api_key_mint_${actor.uid}`, MINT_LIMIT.limit, MINT_LIMIT.windowSeconds, 'closed');
    if (!allowed) {
        throw new HttpsError('resource-exhausted', 'Too many keys made just now. Try again in a few minutes.');
    }

    const { keyId, key } = mintKey();
    const ref = db.collection(KEYS).doc(keyId);
    // Counted and written in one transaction, so two presses at once cannot pass
    // the limit together.
    await db.runTransaction(async (tx) => {
        const active = await tx.get(activeKeysOf(companyId));
        if (active.size >= MAX_ACTIVE_KEYS) {
            throw new HttpsError(
                'failed-precondition',
                `A company can have ${MAX_ACTIVE_KEYS} keys turned on. Turn one off before making another.`,
            );
        }
        tx.set(ref, {
            companyId,
            name,
            hash: hashKey(key),
            scopes: resolved.scopes,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: actor.uid,
            createdByName: actor.name,
            lastUsedAt: null,
            revokedAt: null,
            revokedBy: null,
            revokedByName: null,
        });
    });

    // The key's id only: the key itself is never logged.
    console.log(`[createCompanyApiKey] key ${keyId} made for company ${companyId} by ${actor.uid}`);
    return {
        keyId,
        key,
        name,
        prefix: displayPrefix(keyId),
        scopes: resolved.scopes,
        createdAt: new Date().toISOString(),
    };
});

exports.listCompanyApiKeys = onCall({ cors: true }, async (request) => {
    const companyId = requireText(request.data?.companyId, 'companyId');
    await companyAdmin(request, companyId);

    const snap = await db.collection(KEYS).where('companyId', '==', companyId).get();
    // Turned-on keys first, newest first within each.
    const keys = snap.docs
        .map((doc) => ({ view: keyView(doc.id, doc.data()), created: millisOf(doc.data()?.createdAt) || 0 }))
        .sort((a, b) => (Boolean(a.view.revokedAt) - Boolean(b.view.revokedAt)) || (b.created - a.created))
        .map(({ view }) => view);

    return { keys, scopes: SCOPES, maxActiveKeys: MAX_ACTIVE_KEYS };
});

exports.revokeCompanyApiKey = onCall({ cors: true }, async (request) => {
    const companyId = requireText(request.data?.companyId, 'companyId');
    const actor = await companyAdmin(request, companyId);
    const keyId = requireText(request.data?.keyId, 'keyId');
    if (!KEY_ID.test(keyId)) throw new HttpsError('not-found', 'No such key.');

    const ref = db.collection(KEYS).doc(keyId);
    const snap = await ref.get();
    // Another company's key is answered as no key at all.
    if (!snap.exists || snap.data()?.companyId !== companyId) throw new HttpsError('not-found', 'No such key.');
    if (snap.data()?.revokedAt) return { keyId, revoked: true, alreadyRevoked: true };

    await ref.update({
        revokedAt: admin.firestore.FieldValue.serverTimestamp(),
        revokedBy: actor.uid,
        revokedByName: actor.name,
    });
    console.log(`[revokeCompanyApiKey] key ${keyId} of company ${companyId} turned off by ${actor.uid}`);
    return { keyId, revoked: true, alreadyRevoked: false };
});

