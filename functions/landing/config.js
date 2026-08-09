/**
 * Landing-page settings store.
 *
 * ## Why this exists
 *
 * Telegram lead delivery was originally configured only through two Google
 * Secret Manager values bound at deploy time. That is secure, but it means
 * rotating a bot token — or pointing leads at a different chat — requires a
 * functions deploy by someone with gcloud access. This store adds an operator
 * path: the same credentials, encrypted at rest in a server-only Firestore
 * document, editable from Super Admin → Landing Page Settings.
 *
 * ## What is stored, and how
 *
 * `platform_settings/landing_page` has **no Firestore rule match**, so it is
 * unreadable and unwritable by every client including a Super Admin token. It is
 * reachable only through the Admin SDK, from this file.
 *
 * The bot token and chat id are encrypted with the same AES-256-CBC helper that
 * already protects per-company SMS credentials (`functions/integrations/encryption.js`,
 * keyed by `SMS_ENCRYPTION_KEY` in Secret Manager). Reusing it is deliberate:
 * a second encryption scheme would be a second thing to get wrong, and this one
 * is already exercised in production.
 *
 * ## Precedence, and why the fallback stays
 *
 * `readTelegramConfig()` prefers the stored configuration and falls back to the
 * `LANDING_TELEGRAM_*` Secret Manager values. The fallback is not legacy
 * baggage — it is what keeps lead delivery working between this code deploying
 * and an operator first opening the new screen, and it is the recovery path if
 * the encryption key is ever unavailable.
 *
 * ## What never happens here
 *
 * No function in this file returns a decrypted credential to anything but the
 * delivery path, and no function logs one. `readMaskedSettings()` is the only
 * shape the UI ever receives, and it is built from metadata alone.
 */

const crypto = require('crypto');
const { admin, db } = require('../firebaseAdmin');
const { decrypt, encrypt } = require('../integrations/encryption');

const SETTINGS_COLLECTION = 'platform_settings';
const SETTINGS_DOC = 'landing_page';

/** Where a resolved credential came from. Surfaced to the operator, never the value. */
const CONFIG_SOURCES = Object.freeze({
    FIRESTORE: 'firestore',
    SECRET_MANAGER: 'secret-manager',
    NONE: 'none',
});

function settingsRef() {
    return db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC);
}

/**
 * A short, non-reversible fingerprint of a credential.
 *
 * Twelve hex characters of a SHA-256 digest is enough for an operator to
 * confirm "the token I just pasted is the one that is live" by comparing two
 * fingerprints, and far too little to attack the 48-character token behind it.
 */
function fingerprint(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

/** Last four characters of a chat id, for recognition without disclosure. */
function last4(value) {
    const text = String(value || '');
    return text.length <= 4 ? text : text.slice(-4);
}

/**
 * Decrypts a stored field, returning null rather than throwing.
 *
 * A decryption failure means the ciphertext predates a key change or the key is
 * unavailable. Neither should take the public lead endpoint down with a 500 —
 * the caller falls back to Secret Manager instead.
 */
function safeDecrypt(cipherText) {
    if (!cipherText) return null;
    try {
        const value = decrypt(cipherText);
        return value || null;
    } catch {
        // No error detail: the message can carry cipher metadata.
        console.error('[landingConfig] stored credential could not be decrypted.');
        return null;
    }
}

/** Reads the raw settings document, tolerating its absence. */
async function readRawSettings() {
    try {
        const snap = await settingsRef().get();
        return snap.exists ? (snap.data() || {}) : {};
    } catch (error) {
        console.error('[landingConfig] settings read failed', { message: error?.message || 'unknown' });
        return {};
    }
}

/**
 * Resolves the Telegram credentials the delivery path should use.
 *
 * @param {object} [fallback] Secret Manager values, injected by the caller that
 *   holds the bindings so this module needs no `defineSecret` of its own.
 * @returns {Promise<{enabled: boolean, botToken: string|null, chatId: string|null, source: string}>}
 */
async function readTelegramConfig(fallback = {}) {
    const stored = (await readRawSettings()).telegram || {};

    // An explicit `false` disables delivery outright. `undefined` means the
    // operator has never touched the screen, which must not disable the
    // Secret Manager path that was working before this feature existed.
    const explicitlyDisabled = stored.enabled === false;

    if (!explicitlyDisabled) {
        const botToken = safeDecrypt(stored.botTokenCipher);
        const chatId = safeDecrypt(stored.chatIdCipher);
        if (botToken && chatId) {
            return { enabled: true, botToken, chatId, source: CONFIG_SOURCES.FIRESTORE };
        }
    }

    if (explicitlyDisabled) {
        return { enabled: false, botToken: null, chatId: null, source: CONFIG_SOURCES.NONE };
    }

    const botToken = String(fallback.botToken || '').trim();
    const chatId = String(fallback.chatId || '').trim();
    if (botToken && chatId) {
        return { enabled: true, botToken, chatId, source: CONFIG_SOURCES.SECRET_MANAGER };
    }

    return { enabled: false, botToken: null, chatId: null, source: CONFIG_SOURCES.NONE };
}

/**
 * Builds the settings shape the Super Admin screen receives.
 *
 * Every field here is metadata. There is no branch of this function that can
 * return a token or a chat id, which is the property the UI depends on.
 *
 * @param {object} [fallback] Secret Manager values, used only to report whether
 *   a deploy-time fallback exists — never echoed.
 */
async function readMaskedSettings(fallback = {}) {
    const raw = await readRawSettings();
    const telegram = raw.telegram || {};

    const hasStoredToken = Boolean(telegram.botTokenCipher);
    const hasStoredChat = Boolean(telegram.chatIdCipher);
    const hasFallback = Boolean(String(fallback.botToken || '').trim() && String(fallback.chatId || '').trim());

    return {
        telegram: {
            enabled: telegram.enabled !== false && (hasStoredToken ? hasStoredChat : hasFallback),
            configured: hasStoredToken && hasStoredChat,
            source: (hasStoredToken && hasStoredChat)
                ? CONFIG_SOURCES.FIRESTORE
                : (hasFallback ? CONFIG_SOURCES.SECRET_MANAGER : CONFIG_SOURCES.NONE),
            botTokenFingerprint: telegram.botTokenFingerprint || null,
            botUsername: telegram.botUsername || null,
            chatIdLast4: telegram.chatIdLast4 || null,
            updatedAt: toMillis(telegram.updatedAt),
            updatedByEmail: telegram.updatedByEmail || null,
            lastDelivery: telegram.lastDelivery
                ? {
                    status: telegram.lastDelivery.status || null,
                    code: telegram.lastDelivery.code || null,
                    at: toMillis(telegram.lastDelivery.at),
                }
                : null,
            secretManagerFallbackAvailable: hasFallback,
        },
        content: raw.content || null,
        contentUpdatedAt: toMillis(raw.contentUpdatedAt),
    };
}

function toMillis(timestamp) {
    if (!timestamp) return null;
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
    return null;
}

/**
 * Persists Telegram credentials.
 *
 * The caller is responsible for having verified the token first; this function
 * stores what it is given. `botUsername` is the public name returned by
 * Telegram's `getMe`, kept so the screen can show *which* bot is live.
 *
 * @param {{botToken: string, chatId: string, enabled: boolean, botUsername: string|null}} config
 * @param {{uid: string|null, email: string|null}} actor
 */
async function writeTelegramConfig(config, actor) {
    const payload = {
        'telegram.enabled': config.enabled !== false,
        'telegram.botTokenCipher': encrypt(config.botToken),
        'telegram.botTokenFingerprint': fingerprint(config.botToken),
        'telegram.botUsername': config.botUsername || null,
        'telegram.chatIdCipher': encrypt(config.chatId),
        'telegram.chatIdLast4': last4(config.chatId),
        'telegram.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
        'telegram.updatedByUid': actor?.uid || null,
        'telegram.updatedByEmail': actor?.email || null,
    };

    await settingsRef().set({}, { merge: true });
    await settingsRef().update(payload);

    // Verify the round trip rather than trusting the write, matching the
    // environment vault's own mutation contract. Comparing fingerprints keeps
    // the plaintext out of this check.
    const verify = (await readRawSettings()).telegram || {};
    if (verify.botTokenFingerprint !== fingerprint(config.botToken)) {
        throw new Error('LANDING_CONFIG_WRITE_UNVERIFIED');
    }

    return { verified: true, botTokenFingerprint: verify.botTokenFingerprint };
}

/** Enables or disables delivery without touching the stored credentials. */
async function setTelegramEnabled(enabled, actor) {
    await settingsRef().set({}, { merge: true });
    await settingsRef().update({
        'telegram.enabled': Boolean(enabled),
        'telegram.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
        'telegram.updatedByUid': actor?.uid || null,
        'telegram.updatedByEmail': actor?.email || null,
    });
}

/**
 * Records the outcome of the most recent delivery attempt.
 *
 * `code` is one of the hand-written classifications from `telegram.js`, never a
 * raw error. Written best-effort: failing to record a delivery must not fail the
 * delivery itself.
 */
async function recordDeliveryOutcome(status, code = null) {
    try {
        await settingsRef().set({}, { merge: true });
        await settingsRef().update({
            'telegram.lastDelivery': {
                status,
                code,
                at: admin.firestore.Timestamp.now(),
            },
        });
    } catch (error) {
        console.warn('[landingConfig] delivery outcome not recorded', {
            message: error?.message || 'unknown',
        });
    }
}

/** Persists editable landing-page copy. Contains no credentials. */
async function writeContent(content, actor) {
    await settingsRef().set({}, { merge: true });
    await settingsRef().update({
        content,
        contentUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        contentUpdatedByEmail: actor?.email || null,
    });
}

module.exports = {
    CONFIG_SOURCES,
    SETTINGS_COLLECTION,
    SETTINGS_DOC,
    fingerprint,
    last4,
    readMaskedSettings,
    readRawSettings,
    readTelegramConfig,
    recordDeliveryOutcome,
    setTelegramEnabled,
    writeContent,
    writeTelegramConfig,
};
