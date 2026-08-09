/**
 * Super Admin callables for Landing Page Settings.
 *
 * ## Security contract
 *
 * Every callable here reuses the Environment & Integrations guards rather than
 * inventing its own, because those guards already encode the decisions this
 * screen needs: **exact** `globalRole === 'super_admin'` (no company-admin path),
 * authentication within the last 15 minutes, a fail-closed rate limit, and a
 * value-free audit record on every outcome including denials.
 *
 * ## The one rule that matters most
 *
 * **No callable in this file can return a bot token.** `getLandingPageSettings`
 * is built from `readMaskedSettings()`, which reads metadata fields only and has
 * no code path that touches the ciphertext. There is deliberately no "reveal"
 * callable to pair with the environment vault's: a bot token that can be read
 * back adds an exfiltration route and buys nothing, because an operator who
 * needs a new token gets one from BotFather, not from us.
 *
 * What the operator gets instead is a fingerprint (12 hex characters of a
 * SHA-256 digest), the bot's public username, and the last four characters of
 * the chat id — enough to confirm *which* credentials are live, and not enough
 * to reconstruct them.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../environmentVault/audit');
const { assertSuperAdmin, assertWithinRateLimit, guardPrivileged } = require('../environmentVault/guards');
const config = require('./config');
const leads = require('./leads');
const telegram = require('./telegram');

/**
 * Secret bindings.
 *
 * `SMS_ENCRYPTION_KEY` decrypts the stored credentials; the two `LANDING_*`
 * values are the deploy-time fallback, bound so this screen can report honestly
 * whether one exists rather than guessing.
 */
const landingOptions = {
    cors: true,
    region: 'us-central1',
    secrets: [
        'SMS_ENCRYPTION_KEY',
        'LANDING_TELEGRAM_BOT_TOKEN',
        'LANDING_TELEGRAM_CHAT_ID',
    ],
};

/** The integration name recorded on every audit row from this screen. */
const INTEGRATION = 'Telegram (landing leads)';

function fallbackCredentials() {
    return {
        botToken: process.env.LANDING_TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.LANDING_TELEGRAM_CHAT_ID || '',
    };
}

/**
 * Converts an unexpected error into a safe callable failure.
 *
 * Mirrors the environment vault's own handler: a raw error from this module
 * could carry a Firestore path or, worse, a Telegram request URL with the token
 * in it, so nothing but a typed `HttpsError` is ever re-thrown.
 */
function safeFailure(error, scope) {
    if (error instanceof HttpsError) return error;
    console.error(`[landingSettings] ${scope} failed`, { message: error?.message || 'unknown' });
    return new HttpsError('internal', 'The operation could not be completed.');
}

/** Rejects a value that is not a plausible Telegram bot token. */
function validateBotToken(value) {
    const token = String(value || '').trim();
    // BotFather issues `<numeric bot id>:<35-character secret>`. Checking the
    // shape catches a truncated paste before it is stored and before a lead
    // silently fails to arrive.
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
        throw new HttpsError('invalid-argument', 'That does not look like a Telegram bot token.');
    }
    return token;
}

/** Rejects a value that is not a plausible chat id. */
function validateChatId(value) {
    const chatId = String(value || '').trim();
    // Numeric ids (optionally negative for groups and supergroups) or an
    // @channelusername. Anything else is a typo.
    if (!/^-?\d{1,20}$/.test(chatId) && !/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(chatId)) {
        throw new HttpsError('invalid-argument', 'Enter a numeric chat ID or an @channelusername.');
    }
    return chatId;
}

/**
 * Reads the masked settings for the screen.
 *
 * Uses the lighter `list` budget and does not require recent authentication:
 * this returns no secret, so forcing a password prompt to look at a status page
 * would train operators to re-enter their password for no reason.
 */
exports.getLandingPageSettings = onCall(landingOptions, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST, { integration: INTEGRATION });
    await assertWithinRateLimit(request, 'list', ACTIONS.LIST, { integration: INTEGRATION }, 'landing');

    try {
        const settings = await config.readMaskedSettings(fallbackCredentials());
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.LIST,
            result: RESULTS.SUCCESS,
            metadata: { integration: INTEGRATION, scope: 'global', key: 'landing.settings' },
        });
        return settings;
    } catch (error) {
        throw safeFailure(error, 'getLandingPageSettings');
    }
});

/**
 * Stores new Telegram credentials.
 *
 * The token is verified against Telegram before it is written, so an operator
 * who pastes a truncated value is told immediately instead of discovering it
 * when the next lead does not arrive. A failed verification stores nothing.
 */
exports.updateLandingTelegramConfig = onCall(landingOptions, async (request) => {
    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, { integration: INTEGRATION }, 'landing');

    try {
        const botToken = validateBotToken(request.data?.botToken);
        const chatId = validateChatId(request.data?.chatId);
        const enabled = request.data?.enabled !== false;

        const verification = await telegram.verifyBotToken(botToken);
        if (!verification.ok) {
            await recordAuditEvent({
                auth: request.auth,
                action: ACTIONS.UPDATE,
                result: RESULTS.FAILED,
                metadata: { integration: INTEGRATION, key: 'LANDING_TELEGRAM_BOT_TOKEN', reason: verification.code },
            });
            throw new HttpsError(
                'failed-precondition',
                verification.code === 'invalid-token'
                    ? 'Telegram rejected that bot token.'
                    : 'The bot token could not be verified right now. Try again shortly.',
            );
        }

        const result = await config.writeTelegramConfig(
            { botToken, chatId, enabled, botUsername: verification.username },
            { uid: request.auth?.uid || null, email: request.auth?.token?.email || null },
        );

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.UPDATE,
            result: RESULTS.SUCCESS,
            metadata: {
                integration: INTEGRATION,
                key: 'LANDING_TELEGRAM_BOT_TOKEN',
                scope: 'global',
                source: 'firestore-encrypted',
                // A length is the only fact about the value that is recorded,
                // matching the vault's rule. It cannot reconstruct a token.
                valueLength: botToken.length,
            },
        });

        // Returns the fingerprint, never the token.
        return {
            verified: result.verified,
            botTokenFingerprint: result.botTokenFingerprint,
            botUsername: verification.username,
        };
    } catch (error) {
        throw safeFailure(error, 'updateLandingTelegramConfig');
    }
});

/** Turns delivery on or off without touching the stored credentials. */
exports.setLandingTelegramEnabled = onCall(landingOptions, async (request) => {
    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, { integration: INTEGRATION }, 'landing');

    try {
        const enabled = request.data?.enabled === true;
        await config.setTelegramEnabled(enabled, {
            uid: request.auth?.uid || null,
            email: request.auth?.token?.email || null,
        });

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.UPDATE,
            result: RESULTS.SUCCESS,
            metadata: { integration: INTEGRATION, setting: 'telegram.enabled', enabled, scope: 'global' },
        });

        return { enabled };
    } catch (error) {
        throw safeFailure(error, 'setLandingTelegramEnabled');
    }
});

/**
 * Sends a fixed test message using the stored credentials.
 *
 * Reports success or a classified failure code — never Telegram's own response
 * body, which echoes request context.
 */
exports.sendLandingTelegramTest = onCall(landingOptions, async (request) => {
    await guardPrivileged(request, 'test', ACTIONS.TEST, { integration: INTEGRATION }, 'landing');

    try {
        const resolved = await config.readTelegramConfig(fallbackCredentials());
        if (!resolved.enabled || !resolved.botToken || !resolved.chatId) {
            await recordAuditEvent({
                auth: request.auth,
                action: ACTIONS.TEST,
                result: RESULTS.UNAVAILABLE,
                metadata: { integration: INTEGRATION, reason: 'not-configured' },
            });
            return { ok: false, code: 'not-configured' };
        }

        const outcome = await telegram.sendMessage(
            resolved.botToken,
            resolved.chatId,
            telegram.buildTestMessage(request.auth?.token?.email || null),
        );

        await config.recordDeliveryOutcome(outcome.ok ? 'delivered' : 'failed', outcome.code);
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.TEST,
            result: outcome.ok ? RESULTS.SUCCESS : RESULTS.FAILED,
            metadata: { integration: INTEGRATION, source: resolved.source, reason: outcome.code || undefined },
        });

        return { ok: outcome.ok, code: outcome.code, source: resolved.source };
    } catch (error) {
        throw safeFailure(error, 'sendLandingTelegramTest');
    }
});

/** Lists captured leads for the settings table. */
exports.listLandingLeads = onCall(landingOptions, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST, { integration: INTEGRATION });
    await assertWithinRateLimit(request, 'list', ACTIONS.LIST, { integration: INTEGRATION }, 'landing');

    try {
        const rows = await leads.listLeads(request.data?.limit);
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.LIST,
            result: RESULTS.SUCCESS,
            metadata: { integration: INTEGRATION, key: 'landing_leads', entryCount: rows.length },
        });
        return { leads: rows };
    } catch (error) {
        throw safeFailure(error, 'listLandingLeads');
    }
});

/**
 * Re-attempts delivery for one stored lead.
 *
 * This is the payoff for storing leads at all: an outage becomes a button
 * rather than a lost customer.
 */
exports.retryLandingLeadDelivery = onCall(landingOptions, async (request) => {
    await guardPrivileged(request, 'mutate', ACTIONS.UPDATE, { integration: INTEGRATION }, 'landing');

    try {
        const leadId = String(request.data?.leadId || '');
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(leadId)) {
            throw new HttpsError('invalid-argument', 'A valid lead id is required.');
        }

        const lead = await leads.readLeadForRetry(leadId);
        if (!lead) throw new HttpsError('not-found', 'That lead no longer exists.');

        const resolved = await config.readTelegramConfig(fallbackCredentials());
        if (!resolved.enabled || !resolved.botToken || !resolved.chatId) {
            return { ok: false, code: 'not-configured' };
        }

        const message = lead.stage === leads.LEAD_STAGES.QUALIFIED
            ? telegram.buildQualifiedLeadMessage(lead)
            : telegram.buildNewLeadMessage(lead, { sourcePage: lead.sourcePage, utmSource: lead.utmSource });

        const outcome = await telegram.sendMessage(resolved.botToken, resolved.chatId, message);

        await leads.recordDelivery(
            leadId,
            outcome.ok ? leads.DELIVERY_STATUS.DELIVERED : leads.DELIVERY_STATUS.FAILED,
            outcome.code,
        );
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.UPDATE,
            result: outcome.ok ? RESULTS.SUCCESS : RESULTS.FAILED,
            metadata: { integration: INTEGRATION, entryId: leadId, key: 'landing_leads', reason: outcome.code || undefined },
        });

        return { ok: outcome.ok, code: outcome.code };
    } catch (error) {
        throw safeFailure(error, 'retryLandingLeadDelivery');
    }
});

exports._test = {
    INTEGRATION,
    validateBotToken,
    validateChatId,
};
