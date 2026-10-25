/**
 * The Telegram Bot API, for SafeHaul's own alerts to its operator.
 *
 * Built fresh, as `functions/index.js` rules for anything Telegram: the bot the
 * retired landing page used is not restored. A few methods, a ten-second
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
 * The newest hundred updates, or none while another request is reading them.
 *
 * Telegram keeps undelivered updates for 24 hours and, by default, answers with
 * the oldest; a negative offset asks for the newest hundred instead (and forgets
 * the rest, which nothing else reads). It answers 409 both when a webhook is set
 * and when another `getUpdates` is still running, as when two pages check at
 * once, so the webhook is asked about before the bot is called another
 * service's.
 */
async function latestUpdates(token, deps) {
    try {
        const updates = await callTelegram(token, 'getUpdates', { offset: -100, limit: 100, allowed_updates: ['message'] }, deps);
        return Array.isArray(updates) ? updates : [];
    } catch (error) {
        if (error?.code !== 'webhook_set') throw error;
        const webhook = await callTelegram(token, 'getWebhookInfo', {}, deps);
        if (webhook?.url) throw error;
        return [];
    }
}

/** A person as Telegram names them, for the console. */
function personName(user) {
    const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ');
    return name || (user?.username ? `@${user.username}` : 'Telegram user');
}

/**
 * What the bot heard about a one-time Start link: the chat that pressed Start on
 * it while it was valid, and whether a Start without it arrived after it was
 * handed out.
 *
 * The code comes from a one-time link the console hands the person connecting
 * (`t.me/<bot>?start=<code>`), so nobody else who writes to the bot, however
 * often, is connected in their place. A Start counts by when it was pressed,
 * not by when the console asks, so a person who pressed it in time is
 * connected even if the page asks later. Telegram shows the person only
 * "/start" either way, so a Start without the code (the bot opened from search,
 * "/start" typed, an older link) is reported rather than silently ignored.
 *
 * The chat carries `by`, the person who pressed it, when Telegram names one:
 * only they hold the console's link, so they are the one the console trusts.
 *
 * @param {Array<object>} updates Telegram updates, newest last
 * @param {{ code: string, createdAt: number, expiresAt: number }} link times in ms
 * @returns {{ chat: ({ id: (number|string), title: string, by?: { id: number, name: string } }|null), strayStart: boolean }}
 */
function startsIn(updates, link) {
    if (!link?.code) return { chat: null, strayStart: false };
    let chat = null;
    let strayStart = false;
    for (const update of updates) {
        const message = update?.message;
        const [command, payload, extra] = String(message?.text || '').trim().split(/\s+/);
        if (!/^\/start(?:@\w+)?$/.test(command)) continue;
        // Telegram dates a message in whole seconds.
        const sentAt = Number.isFinite(message?.date) ? message.date * 1000 : Date.now();
        const chatId = message?.chat?.id;
        if (payload === link.code && extra === undefined && (typeof chatId === 'number' || typeof chatId === 'string')) {
            if (sentAt <= link.expiresAt) {
                const by = Number.isSafeInteger(message.from?.id) ? { id: message.from.id, name: personName(message.from) } : null;
                chat = { id: chatId, title: chatTitle(message.chat), ...(by ? { by } : {}) };
            }
        } else if (sentAt >= link.createdAt) {
            strayStart = true;
        }
    }
    return { chat, strayStart };
}

/**
 * `startsIn` over what the bot received: the webhook's inbox when
 * `deps.readInbox` is given, else the bot's own queue (a bot no webhook takes).
 */
async function startsOnLink(token, link, deps) {
    if (!link?.code) return { chat: null, strayStart: false };
    const updates = deps?.readInbox ? await deps.readInbox() : await latestUpdates(token, deps);
    return startsIn(updates, link);
}

async function sendMessage(token, chatId, text, deps) {
    await callTelegram(token, 'sendMessage', {
        chat_id: chatId,
        text: String(text).slice(0, MAX_MESSAGE_CHARS),
        disable_web_page_preview: true,
    }, deps);
}

/**
 * A message with buttons under it, each `{ text, data }`, one row per array.
 * Returns the message's id, which later edits name.
 */
async function sendButtons(token, chatId, text, rows, deps) {
    const message = await callTelegram(token, 'sendMessage', {
        chat_id: chatId,
        text: String(text).slice(0, MAX_MESSAGE_CHARS),
        disable_web_page_preview: true,
        reply_markup: keyboard(rows),
    }, deps);
    return message?.message_id ?? null;
}

const keyboard = (rows) => ({
    inline_keyboard: (rows || []).map((row) => row.map(({ text, data }) => ({ text, callback_data: data }))),
});

/** Replaces a message's text and buttons; no `rows` leaves it with none. */
async function editMessage(token, chatId, messageId, text, rows, deps) {
    await callTelegram(token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: String(text).slice(0, MAX_MESSAGE_CHARS),
        disable_web_page_preview: true,
        reply_markup: keyboard(rows),
    }, deps);
}

/** Ends a button's spinner, with a short note the presser sees. */
async function answerButton(token, callbackId, text, deps) {
    await callTelegram(token, 'answerCallbackQuery', {
        callback_query_id: callbackId,
        ...(text ? { text: String(text).slice(0, 200) } : {}),
    }, deps);
}

/**
 * Points the bot's updates at `url`, signed with `secret` in the
 * `X-Telegram-Bot-Api-Secret-Token` header. A bot whose webhook already goes
 * elsewhere belongs to another service and is left alone (`webhook_set`).
 */
async function setWebhook(token, url, secret, deps) {
    const current = await callTelegram(token, 'getWebhookInfo', {}, deps);
    if (current?.url && current.url !== url) {
        throw new TelegramError('webhook_set', 'This bot sends its updates to another service.');
    }
    await callTelegram(token, 'setWebhook', {
        url,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
        max_connections: 5,
    }, deps);
}

/**
 * Stops the bot sending its updates here. Pending ones are dropped (nobody will
 * read them), unless `keepPending`: then the bot's own queue still holds them.
 */
async function deleteWebhook(token, deps, { keepPending = false } = {}) {
    await callTelegram(token, 'deleteWebhook', { drop_pending_updates: !keepPending }, deps);
}

module.exports = {
    TOKEN_PATTERN,
    MAX_MESSAGE_CHARS,
    TelegramError,
    callTelegram,
    getBot,
    startsIn,
    startsOnLink,
    sendMessage,
    sendButtons,
    editMessage,
    answerButton,
    setWebhook,
    deleteWebhook,
};
