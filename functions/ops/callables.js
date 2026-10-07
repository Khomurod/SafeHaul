/**
 * Super Admin → System Health → Telegram alerts.
 *
 * Connects the hourly watcher (`./watcher.js`) to the operator's Telegram:
 * save a bot token, connect a chat through a one-time Start link, send a test,
 * or remove it all. The environment vault's guards apply as everywhere else in
 * the console: the exact super-admin role, recent sign-in for changes, rate
 * limits, and a value-free audit record. No response carries the token or the
 * chat id.
 */

const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

const { guardPrivileged, assertSuperAdmin, assertWithinRateLimit } = require('../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../environmentVault/audit');
const settings = require('./alertSettings');
const telegram = require('./telegram');

const INTEGRATION = 'Telegram alerts';
const CONNECTED_TEXT = 'SafeHaul: уведомления подключены. Сюда придёт сообщение, если ИИ или блог перестанут работать, и ещё одно, когда всё восстановится.';
const TEST_TEXT = 'SafeHaul: тестовое сообщение. Уведомления работают.';
const START_LINK_TTL_MS = 15 * 60 * 1000;
/** Telegram keeps an undelivered update this long, so an older Start cannot be found. */
const TELEGRAM_UPDATE_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Telegram's refusal, in the operator's terms. Its own text never reaches here. */
function telegramFailure(error) {
    if (!(error instanceof telegram.TelegramError)) return error;
    switch (error.code) {
        case 'token_invalid':
            return new HttpsError('invalid-argument', 'That is not a Telegram bot token. Copy the whole token @BotFather sent: digits, a colon, then letters and digits.');
        case 'token_rejected':
            return new HttpsError('failed-precondition', 'Telegram did not accept this token. Copy it again from @BotFather.');
        case 'blocked':
        case 'bad_request':
            return new HttpsError('failed-precondition', 'The bot cannot write to that chat. If you blocked the bot in Telegram, unblock it, then press Reconnect chat.');
        case 'webhook_set':
            return new HttpsError('failed-precondition', 'This bot is connected to another service. Create a new bot with @BotFather for SafeHaul alerts.');
        case 'rate_limited':
            return new HttpsError('resource-exhausted', 'Telegram asked us to slow down. Try again in a minute.');
        default:
            return new HttpsError('unavailable', 'Telegram could not be reached. Try again in a few minutes.');
    }
}

function safeFailure(error, label) {
    const mapped = telegramFailure(error);
    if (mapped instanceof HttpsError) throw mapped;
    // The name only: a Secret Manager error names resource paths, nothing more,
    // but nothing here needs even that in a log.
    console.error(`[ops/${label}] ${error?.name || 'Error'}${error?.code ? ` code=${error.code}` : ''}`);
    throw new HttpsError('internal', 'The request could not be completed.');
}

async function audit(request, action, metadata) {
    await recordAuditEvent({
        auth: request.auth,
        action,
        result: RESULTS.SUCCESS,
        metadata: { integration: INTEGRATION, ...metadata },
    });
}

/** The one-time Start link still waiting to be used, or null. */
function pendingStart(connection, now = Date.now()) {
    const pending = connection?.pendingStart;
    return pending?.code && Date.parse(pending.expiresAt) > now ? pending : null;
}

/**
 * The last link handed out, while a Start pressed on it in time could still be
 * found, or null. Its times in milliseconds; a link saved before links carried
 * `createdAt` is dated from its expiry.
 */
function lastStartWindow(connection, now = Date.now()) {
    const pending = connection?.pendingStart;
    const expiresAt = Date.parse(pending?.expiresAt);
    if (!pending?.code || !Number.isFinite(expiresAt) || now - expiresAt >= TELEGRAM_UPDATE_RETENTION_MS) return null;
    const createdAt = Date.parse(pending.createdAt);
    return {
        code: pending.code,
        createdAt: Number.isFinite(createdAt) ? createdAt : expiresAt - START_LINK_TTL_MS,
        expiresAt,
    };
}

function startLink(connection, pending) {
    return { link: `https://t.me/${connection.botUsername}?start=${pending.code}`, expiresAt: pending.expiresAt };
}

/** Saves the chat that pressed Start, once the bot has reached it. */
async function connectChat(request, token, connection, chat) {
    // Sent before it is saved, so a connected chat is one that was reached.
    await telegram.sendMessage(token, chat.id, CONNECTED_TEXT);
    const rest = { ...connection };
    delete rest.pendingStart;
    await settings.replaceSettings({
        telegram: { ...rest, chatId: chat.id, chatTitle: chat.title, connectedAt: new Date().toISOString() },
        // A new destination starts from "all well", so it hears about anything already down.
        watch: {},
    });
    await audit(request, ACTIONS.UPDATE, { setting: 'chat' });
    return { chat: { title: chat.title } };
}

async function requireConnection() {
    const saved = await settings.readSettings();
    const token = await settings.readBotToken();
    if (!token) throw new HttpsError('failed-precondition', 'Add the bot token first.');
    return { saved, token };
}

exports.getPlatformAlerts = onCall({ cors: true }, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST, { integration: INTEGRATION });
    await assertWithinRateLimit(request, 'list', ACTIONS.LIST, { integration: INTEGRATION });

    try {
        const { telegram: connection = {}, watch = {} } = await settings.readSettings();
        const checks = {};
        for (const [id, check] of Object.entries(watch.checks || {})) {
            checks[id] = { status: check?.status === 'down' ? 'down' : 'ok', since: check?.since || null };
        }
        const pending = pendingStart(connection);
        return {
            bot: connection.botUsername ? { username: connection.botUsername } : null,
            chat: connection.chatId !== undefined && connection.chatId !== null
                ? { title: connection.chatTitle || 'Telegram chat' }
                : null,
            pending: pending && connection.botUsername ? startLink(connection, pending) : null,
            watch: {
                lastRunAt: watch.lastRunAt || null,
                checks,
                lastDeliveryError: watch.lastDeliveryError || null,
            },
        };
    } catch (error) {
        return safeFailure(error, 'getPlatformAlerts');
    }
});

exports.savePlatformAlertToken = onCall({ cors: true }, async (request) => {
    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, { integration: INTEGRATION, setting: 'bot-token' });

    try {
        const token = typeof request.data?.token === 'string' ? request.data.token.trim() : '';
        if (!token) throw new HttpsError('invalid-argument', 'Enter the bot token.');
        if (token.length > 200 || !telegram.TOKEN_PATTERN.test(token)) {
            throw telegramFailure(new telegram.TelegramError('token_invalid', 'invalid'));
        }
        // Asked before it is stored: a token Telegram refuses is never saved.
        const bot = await telegram.getBot(token);
        const saved = await settings.writeBotToken(token);
        // The whole connection is replaced: a chat belongs to the bot it wrote to.
        // So is what the watcher last told it, so the next chat hears of anything
        // already down instead of a recovery it never heard begin.
        await settings.replaceSettings({
            telegram: { botUsername: bot.username, tokenSavedAt: new Date().toISOString() },
            watch: {},
        });
        await audit(request, ACTIONS.UPDATE, {
            setting: 'bot-token', key: saved.secretId, valueLength: saved.valueLength, sensitivity: 'sensitive',
        });
        return { bot: { username: bot.username } };
    } catch (error) {
        return safeFailure(error, 'savePlatformAlertToken');
    }
});

/**
 * A press hands out a one-time Start link, or connects the chat that pressed
 * Start on it. `checkOnly` is the page asking by itself while its link waits: it
 * connects the chat the same way but never hands out a link, so it needs no
 * recent sign-in (the link was handed out under one), and it spends a budget of
 * its own, so the asking cannot use up the console's.
 */
exports.connectPlatformAlertChat = onCall({ cors: true }, async (request) => {
    const checkOnly = request.data?.checkOnly === true;
    const metadata = { integration: INTEGRATION, setting: 'chat' };
    if (checkOnly) {
        await assertSuperAdmin(request, ACTIONS.UPDATE, metadata);
        await assertWithinRateLimit(request, 'list', ACTIONS.UPDATE, metadata, 'telegram-start');
    } else {
        await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, metadata);
    }

    try {
        const { saved, token } = await requireConnection();
        const connection = saved.telegram || {};
        const lastLink = lastStartWindow(connection);
        if (lastLink) {
            // A Start pressed while the link was valid counts whenever this is asked.
            const { chat, strayStart } = await telegram.startsOnLink(token, lastLink);
            // Awaited here, so a chat the bot cannot reach is refused in the operator's words.
            if (chat) return await connectChat(request, token, connection, chat);
            const pending = pendingStart(connection);
            if (pending) return { pending: startLink(connection, pending), ...(strayStart ? { strayStart: true } : {}) };
        }
        if (checkOnly) return { pending: null };

        // A code only this console has seen, in a link that sends it to the bot.
        // Bot names are public, so "whoever wrote last" is not proof of who the
        // operator is; this code is.
        const now = Date.now();
        const fresh = {
            code: crypto.randomBytes(12).toString('base64url'),
            createdAt: new Date(now).toISOString(),
            expiresAt: new Date(now + START_LINK_TTL_MS).toISOString(),
        };
        await settings.replaceSettings({ telegram: { ...connection, pendingStart: fresh } });
        return { pending: startLink(connection, fresh) };
    } catch (error) {
        return safeFailure(error, 'connectPlatformAlertChat');
    }
});

exports.sendPlatformAlertTest = onCall({ cors: true }, async (request) => {
    await assertSuperAdmin(request, ACTIONS.TEST, { integration: INTEGRATION });
    await assertWithinRateLimit(request, 'test', ACTIONS.TEST, { integration: INTEGRATION });

    try {
        const { saved, token } = await requireConnection();
        const chatId = saved.telegram?.chatId;
        if (chatId === undefined || chatId === null) {
            throw new HttpsError('failed-precondition', 'Connect the chat first.');
        }
        await telegram.sendMessage(token, chatId, TEST_TEXT);
        await audit(request, ACTIONS.TEST, { setting: 'test-message' });
        return { sent: true };
    } catch (error) {
        return safeFailure(error, 'sendPlatformAlertTest');
    }
});

exports.deletePlatformAlerts = onCall({ cors: true }, async (request) => {
    await guardPrivileged(request, 'mutate', ACTIONS.DELETE, { integration: INTEGRATION, setting: 'bot-token' });

    try {
        const result = await settings.destroyBotToken();
        // The watcher's memory goes too: a later connection starts from "all well".
        await settings.replaceSettings({ telegram: {}, watch: {} });
        await audit(request, ACTIONS.DELETE, { setting: 'bot-token', key: result.secretId, entryCount: result.destroyed });
        return { deleted: true };
    } catch (error) {
        return safeFailure(error, 'deletePlatformAlerts');
    }
});
