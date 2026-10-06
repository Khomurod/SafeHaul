/**
 * The Telegram Bot API, for SafeHaul's own alerts to its operator.
 *
 * Built fresh, as `functions/index.js` rules for anything Telegram: the bot the
 * retired landing page used is not restored. Three methods, a ten-second
 * timeout, and one rule above the others. The bot token travels in the URL
 * path, and Node attaches the URL to a failed fetch's error, so nothing here
 * ever returns, throws or logs a URL, a fetch error or Telegram's own text.
 */

const API_ORIGIN = 'https://api.telegram.org';
const TIMEOUT_MS = 10000;
const MAX_MESSAGE_CHARS = 4096;

/** `123456789:AA…`, as @BotFather issues them. */
const TOKEN_PATTERN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;

class TelegramError extends Error {
    /**
     * @param {'token_invalid'|'token_rejected'|'blocked'|'bad_request'|'webhook_set'|'rate_limited'|'unreachable'|'unavailable'} code
     */
    constructor(code, message) {
        super(message);
        this.name = 'TelegramError';
        this.code = code;
    }
}

function codeForStatus(status) {
    // A token Telegram does not know answers 401, or 404 for a malformed one.
    if (status === 401 || status === 404) return 'token_rejected';
    // The person blocked the bot, or the bot was removed from the group.
    if (status === 403) return 'blocked';
    // `getUpdates` refuses while a webhook is set on the bot.
    if (status === 409) return 'webhook_set';
    if (status === 429) return 'rate_limited';
    if (status === 400) return 'bad_request';
    return 'unavailable';
}

async function callTelegram(token, method, body, { fetchImpl = fetch } = {}) {
    if (!TOKEN_PATTERN.test(String(token || ''))) {
        throw new TelegramError('token_invalid', 'That is not a Telegram bot token.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    let payload = null;
    try {
        response = await fetchImpl(`${API_ORIGIN}/bot${token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
            signal: controller.signal,
        });
        // Read within the same ten seconds: an answer that stops halfway is no answer.
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
    } catch {
        // Not the error itself: its message names the URL, and so the token.
        throw new TelegramError('unreachable', 'Telegram could not be reached.');
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok || payload?.ok !== true) {
        // Telegram can also answer 200 with `ok: false` and the real code inside;
        // a 200 that cannot be read has no code, and counts as Telegram being down.
        const status = response.ok ? Number(payload?.error_code) || 0 : response.status;
        throw new TelegramError(codeForStatus(status), status
            ? `Telegram refused the request (${status}).`
            : 'Telegram sent an answer that could not be read.');
    }
    return payload.result;
}

/** The bot's own name, which is also the proof that the token works. */
async function getBot(token, deps) {
    const bot = await callTelegram(token, 'getMe', {}, deps);
    return { username: String(bot?.username || ''), id: bot?.id ?? null };
}

function chatTitle(chat) {
    if (chat.title) return String(chat.title);
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
    return name || (chat.username ? `@${chat.username}` : 'Telegram chat');
}

/**
 * The chat that most recently wrote to the bot, or null.
 *
 * This is how the operator is found without typing a chat id: they send the bot
 * any message, `/start` included, and the newest message names their chat.
 * Telegram keeps undelivered updates for 24 hours and, by default, answers with
 * the oldest; a negative offset asks for the newest ten instead (and forgets the
 * rest, which nothing else reads). Ten, not one, so that an update that is not a
 * message, such as the bot being unblocked, cannot hide the `/start` before it.
 */
async function latestChat(token, deps) {
    const updates = await callTelegram(token, 'getUpdates', { offset: -10, limit: 10, allowed_updates: ['message'] }, deps);
    const chats = (Array.isArray(updates) ? updates : [])
        .map((update) => update?.message?.chat)
        .filter((chat) => chat && (typeof chat.id === 'number' || typeof chat.id === 'string'));
    const chat = chats[chats.length - 1];
    return chat ? { id: chat.id, title: chatTitle(chat) } : null;
}

async function sendMessage(token, chatId, text, deps) {
    await callTelegram(token, 'sendMessage', {
        chat_id: chatId,
        text: String(text).slice(0, MAX_MESSAGE_CHARS),
        disable_web_page_preview: true,
    }, deps);
}

module.exports = {
    TOKEN_PATTERN,
    MAX_MESSAGE_CHARS,
    TelegramError,
    callTelegram,
    getBot,
    latestChat,
    sendMessage,
};
