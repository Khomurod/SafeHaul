/**
 * Telegram transport for landing-page lead notifications.
 *
 * Two rules govern everything in this file:
 *
 *  1. **The bot token never leaves the server, and never enters a log line.**
 *     Telegram puts the token in the *URL path*, so an error object from `fetch`
 *     — or any logger that helpfully prints the request it failed on — is a
 *     credential leak. Every failure path here therefore records a short,
 *     hand-written code and never the error object, the URL or the response body.
 *  2. **A delivery failure is reported, not thrown away.** The caller decides
 *     what to do; this module's job is to say precisely what happened without
 *     saying it with a secret in hand.
 */

/** Telegram rejects `sendMessage` bodies over 4096 characters. */
const MAX_MESSAGE_LENGTH = 4096;

/** Network calls that hang must not hold a function instance open. */
// Written without a numeric separator: the Functions ESLint config parses at an
// older ECMAScript version and rejects `10_000`.
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Classifies a Telegram HTTP status into a stable, value-free code.
 *
 * These strings are persisted and shown to the operator, so they are chosen to
 * be actionable ("the token is wrong" vs "the chat is wrong") without echoing
 * anything Telegram sent back.
 */
function classifyStatus(status) {
    if (status === 401) return 'invalid-token';
    if (status === 403) return 'bot-blocked-or-not-in-chat';
    if (status === 400) return 'invalid-chat-id-or-message';
    if (status === 429) return 'telegram-rate-limited';
    if (status >= 500) return 'telegram-unavailable';
    return `telegram-http-${status}`;
}

/**
 * Performs one Telegram API call.
 *
 * @param {string} token Bot token. Never logged.
 * @param {string} method Telegram Bot API method name.
 * @param {object|null} body JSON body, or null for a bare GET-style call.
 * @param {Function} [fetchImpl] Injected for tests.
 * @returns {Promise<{ok: boolean, code: string|null, result: object|null}>}
 */
async function callTelegram(token, method, body, fetchImpl = global.fetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
            signal: controller.signal,
        });

        if (!response.ok) {
            return { ok: false, code: classifyStatus(response.status), result: null };
        }

        // A 200 from Telegram can still carry `ok: false`. Read it defensively:
        // a body that will not parse is a failure, not a crash.
        let payload = null;
        try {
            payload = await response.json();
        } catch {
            return { ok: false, code: 'telegram-unreadable-response', result: null };
        }

        if (!payload || payload.ok !== true) {
            return { ok: false, code: 'telegram-rejected', result: null };
        }

        return { ok: true, code: null, result: payload.result || null };
    } catch (error) {
        // Deliberately does not include `error` — for an aborted or failed
        // fetch, Node attaches the request URL, which contains the bot token.
        const aborted = error?.name === 'AbortError';
        return { ok: false, code: aborted ? 'telegram-timeout' : 'telegram-network-error', result: null };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Confirms a bot token is valid and returns the bot's public username.
 *
 * Called before a token is saved, so an operator who pastes a truncated token
 * finds out immediately rather than when the next lead silently fails to
 * arrive. The username is public information and safe to display.
 *
 * @returns {Promise<{ok: boolean, code: string|null, username: string|null}>}
 */
async function verifyBotToken(token, fetchImpl = global.fetch) {
    const outcome = await callTelegram(token, 'getMe', {}, fetchImpl);
    if (!outcome.ok) return { ok: false, code: outcome.code, username: null };
    return { ok: true, code: null, username: outcome.result?.username || null };
}

/**
 * Sends one message to a chat.
 *
 * @returns {Promise<{ok: boolean, code: string|null}>}
 */
async function sendMessage(token, chatId, text, fetchImpl = global.fetch) {
    const outcome = await callTelegram(token, 'sendMessage', {
        chat_id: chatId,
        text: String(text).slice(0, MAX_MESSAGE_LENGTH),
        disable_web_page_preview: true,
    }, fetchImpl);

    return { ok: outcome.ok, code: outcome.code };
}

/** Human-readable label for a stored lead field, used in both message builders. */
function line(label, value) {
    return `${label}: ${value || 'Not provided'}`;
}

/**
 * The notification sent the moment someone completes step one.
 *
 * Step one is only a name and an email, and that is the point: this fires
 * before the visitor has committed to answering qualification questions, so an
 * abandoned form still reaches a human.
 */
function buildNewLeadMessage(lead, meta = {}) {
    return [
        'New lead from safehaul.io',
        '',
        line('Name', lead.fullName),
        line('Work email', lead.workEmail),
        meta.sourcePage ? line('Page', meta.sourcePage) : null,
        meta.utmSource ? line('Source', meta.utmSource) : null,
        '',
        'Qualification details follow if they complete step two.',
    ].filter(Boolean).join('\n');
}

/** The follow-up sent when the visitor completes the qualification step. */
function buildQualifiedLeadMessage(lead) {
    return [
        'Lead qualified — safehaul.io',
        '',
        line('Name', lead.fullName),
        line('Work email', lead.workEmail),
        line('Company', lead.companyName),
        line('Fleet size', lead.companySize),
        line('Phone', lead.phone),
        line('Primary goal', lead.primaryGoal),
    ].join('\n');
}

/** The fixed message behind the Super Admin "Send test message" button. */
function buildTestMessage(actorEmail) {
    return [
        'SafeHaul test message',
        '',
        'Telegram lead delivery is configured correctly.',
        actorEmail ? `Requested by: ${actorEmail}` : null,
        'No action is needed.',
    ].filter(Boolean).join('\n');
}

module.exports = {
    MAX_MESSAGE_LENGTH,
    buildNewLeadMessage,
    buildQualifiedLeadMessage,
    buildTestMessage,
    callTelegram,
    classifyStatus,
    sendMessage,
    verifyBotToken,
};
