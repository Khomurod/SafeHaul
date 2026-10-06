/**
 * Super Admin → System Health → Telegram alerts.
 *
 * Connects the hourly watcher (`./watcher.js`) to the operator's Telegram:
 * save a bot token, connect the chat that wrote to the bot, send a test, or
 * remove it all. The environment vault's guards apply as everywhere else in the
 * console: the exact super-admin role, recent sign-in for changes, rate limits,
 * and a value-free audit record. No response carries the token or the chat id.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');

const { guardPrivileged, assertSuperAdmin, assertWithinRateLimit } = require('../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../environmentVault/audit');
const settings = require('./alertSettings');
const telegram = require('./telegram');

const INTEGRATION = 'Telegram alerts';
const CONNECTED_TEXT = 'SafeHaul: уведомления подключены. Сюда придёт сообщение, если ИИ или блог перестанут работать, и ещё одно, когда всё восстановится.';
const TEST_TEXT = 'SafeHaul: тестовое сообщение. Уведомления работают.';

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
            return new HttpsError('failed-precondition', 'The bot cannot write to that chat. Send /start to the bot again, then press Connect chat.');
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
        return {
            bot: connection.botUsername ? { username: connection.botUsername } : null,
            chat: connection.chatId !== undefined && connection.chatId !== null
                ? { title: connection.chatTitle || 'Telegram chat' }
                : null,
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
        await settings.replaceSettings({
            telegram: { botUsername: bot.username, tokenSavedAt: new Date().toISOString() },
        });
        await audit(request, ACTIONS.UPDATE, {
            setting: 'bot-token', key: saved.secretId, valueLength: saved.valueLength, sensitivity: 'sensitive',
        });
        return { bot: { username: bot.username } };
    } catch (error) {
        return safeFailure(error, 'savePlatformAlertToken');
    }
});

exports.connectPlatformAlertChat = onCall({ cors: true }, async (request) => {
    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, { integration: INTEGRATION, setting: 'chat' });

    try {
        const { saved, token } = await requireConnection();
        const chat = await telegram.latestChat(token);
        if (!chat) {
            const bot = saved.telegram?.botUsername ? `@${saved.telegram.botUsername}` : 'the bot';
            throw new HttpsError('failed-precondition', `Open Telegram, send /start to ${bot}, then press Connect chat again.`);
        }
        // Sent before it is saved, so a connected chat is one that was reached.
        await telegram.sendMessage(token, chat.id, CONNECTED_TEXT);
        await settings.replaceSettings({
            telegram: {
                ...(saved.telegram || {}),
                chatId: chat.id,
                chatTitle: chat.title,
                connectedAt: new Date().toISOString(),
            },
        });
        await audit(request, ACTIONS.UPDATE, { setting: 'chat' });
        return { chat: { title: chat.title } };
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
