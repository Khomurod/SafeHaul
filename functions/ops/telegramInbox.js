/**
 * What the alert bot's webhook (`./telegramWebhook.js`) receives, and pointing
 * the bot at it.
 *
 * A Start press on the console's one-time link arrives this way once the
 * console has pointed the bot here (`ensureWebhook`, on saving a token or
 * pressing Connect chat), and the release buttons will too. Telegram
 * signs each request with the secret given to `setWebhook`, in the
 * `X-Telegram-Bot-Api-Secret-Token` header. That secret is derived from the bot
 * token (HMAC), so nothing new is stored, a replaced token changes it, and a
 * request without it is refused before anything is read or written.
 *
 * Only what the console needs is kept: Start commands, with the chat and the
 * person who sent them, for a day (as long as Telegram itself keeps an update),
 * in `system_jobs/platformAlertsInbox`, which no client rule reaches. Older
 * entries are never read, and a TTL policy on `inboxExpiresAt` deletes the
 * document once its newest entry is a day old.
 */

const crypto = require('crypto');

const { admin, db } = require('../firebaseAdmin');
const telegram = require('./telegram');

const REGION = 'us-central1';
const FUNCTION_NAME = 'telegramWebhook';
const INBOX_PATH = Object.freeze(['system_jobs', 'platformAlertsInbox']);
const INBOX_LIMIT = 50;
const INBOX_RETENTION_MS = 24 * 60 * 60 * 1000;
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/** This function's own address, which the bot is pointed at. */
function webhookUrl() {
    const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.FIREBASE_PROJECT_ID;
    if (!project) throw new Error('Google Cloud project id is not available in this runtime.');
    return `https://${REGION}-${project}.cloudfunctions.net/${FUNCTION_NAME}`;
}

/** The header value Telegram sends, for this token: 64 characters of [0-9a-f]. */
function webhookSecret(token) {
    return crypto.createHmac('sha256', String(token)).update('safehaul:telegram-webhook:v1').digest('hex');
}

function secretMatches(given, token) {
    if (typeof given !== 'string' || !token) return false;
    const a = Buffer.from(given, 'utf8');
    const b = Buffer.from(webhookSecret(token), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Points the bot here. Refuses a bot another service already receives (`webhook_set`). */
async function ensureWebhook(token, deps) {
    await telegram.setWebhook(token, webhookUrl(), webhookSecret(token), deps);
}

function inboxRef() {
    return db.collection(INBOX_PATH[0]).doc(INBOX_PATH[1]);
}

const pick = (source, keys) => Object.fromEntries(keys
    .filter((key) => source?.[key] !== undefined && source?.[key] !== null)
    .map((key) => [key, typeof source[key] === 'string' ? source[key].slice(0, 128) : source[key]]));

/** A Start command, cut down to what `telegram.startsIn` reads; anything else, null. */
function keptUpdate(update) {
    const message = update?.message;
    const text = typeof message?.text === 'string' ? message.text.trim() : '';
    if (!Number.isSafeInteger(update?.update_id) || !/^\/start(?:@\w+)?(?:\s|$)/.test(text)) return null;
    return {
        update_id: update.update_id,
        message: {
            text: text.slice(0, 128),
            date: Number.isFinite(message.date) ? message.date : null,
            chat: pick(message.chat, ['id', 'type', 'title', 'first_name', 'last_name', 'username']),
            from: pick(message.from, ['id', 'first_name', 'last_name', 'username']),
        },
    };
}

const isRecent = (entry, now) => Number.isFinite(entry?.message?.date)
    && now - entry.message.date * 1000 < INBOX_RETENTION_MS;

/**
 * Adds one kept update, once, dropping what Telegram itself would no longer
 * hold. `inboxExpiresAt` is a day after the newest one: a Firestore TTL policy
 * deletes the document then, when no later Start has rewritten it.
 */
async function recordUpdate(update, now = Date.now()) {
    const kept = keptUpdate(update);
    if (!kept) return false;
    const ref = inboxRef();
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const stored = Array.isArray(snapshot.data()?.updates) ? snapshot.data().updates : [];
        const recent = stored.filter((entry) => entry.update_id !== kept.update_id && isRecent(entry, now));
        const updates = [...recent, kept].slice(-INBOX_LIMIT);
        const newest = Math.max(...updates.map((entry) => (entry.message.date ?? now / 1000) * 1000));
        transaction.set(ref, { updates, inboxExpiresAt: admin.firestore.Timestamp.fromMillis(newest + INBOX_RETENTION_MS) });
    });
    return true;
}

/** The kept updates of the last day, oldest first. */
async function readUpdates(now = Date.now()) {
    const snapshot = await inboxRef().get();
    const updates = snapshot.exists ? snapshot.data()?.updates : null;
    if (!Array.isArray(updates)) return [];
    return updates.filter((entry) => isRecent(entry, now)).sort((a, b) => a.update_id - b.update_id);
}

async function clearInbox() {
    await inboxRef().delete();
}

module.exports = {
    REGION,
    INBOX_PATH,
    SECRET_HEADER,
    webhookUrl,
    webhookSecret,
    secretMatches,
    ensureWebhook,
    keptUpdate,
    recordUpdate,
    readUpdates,
    clearInbox,
};
