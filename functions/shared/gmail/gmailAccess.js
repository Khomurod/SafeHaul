/**
 * A short-lived Gmail access token for a company's connected Gmail.
 *
 * - The stored refresh token (sealed `enc:v1:`) is opened only here, so the
 *   calling function binds SMS_ENCRYPTION_KEY, and is exchanged at Google
 *   (`oauthClient.refreshAccessToken`).
 * - The access token lives only in this instance's memory, per company, until
 *   a minute before Google says it expires. It is never stored or logged.
 * - A grant Google no longer honours (`invalid_grant`, `admin_policy_enforced`)
 *   marks the company's Gmail `needs_reconnect` (`gmailStatus.js`) and fails
 *   with GMAIL_RECONNECT_NEEDED. Every other failure leaves the status alone.
 */
const { plainPassword } = require('../smtpSettings');
const { refreshAccessToken } = require('./oauthClient');
const { markGmailNeedsReconnect } = require('./gmailStatus');
const { GmailSendError } = require('./sendErrors');

/** A token is not used in its last minute, so a send never starts with one about to lapse. */
const EARLY_MS = 60 * 1000;

/** companyId → { tokenFingerprint, accessToken, usableUntil } */
const cached = new Map();
/** `${companyId}:${tokenFingerprint}` → the refresh in flight, shared by concurrent sends. */
const inFlight = new Map();

/** Google's OAuth error codes that mean the stored grant is gone, and the reason recorded. */
const RECONNECT_CODES = Object.freeze({
    invalid_grant: 'invalid_grant',
    admin_policy_enforced: 'admin_policy',
});

/** The GmailSendError for a failed refresh; a revoked grant is recorded first. */
async function refreshFailure(error, companyId, tokenFingerprint) {
    const code = typeof error?.code === 'string' ? error.code : 'error';
    console.warn(`[gmailAccess] company ${companyId}: Gmail access was refused (${code})`);
    const reason = RECONNECT_CODES[code];
    if (reason) {
        await markGmailNeedsReconnect(companyId, reason, tokenFingerprint);
        return new GmailSendError('GMAIL_RECONNECT_NEEDED');
    }
    if (code === 'gmail-not-configured') return new GmailSendError('GMAIL_NOT_CONFIGURED');
    if (code === 'google-unreachable') return new GmailSendError('GMAIL_UNAVAILABLE');
    return new GmailSendError('GMAIL_FAILED');
}

async function refresh({ companyId, settings }, options) {
    let refreshToken;
    try {
        refreshToken = plainPassword(settings.sealedRefreshToken);
    } catch {
        // SMS_ENCRYPTION_KEY is not bound on this function, or the token was sealed with another key.
        console.error(`[gmailAccess] company ${companyId}: the stored Gmail token could not be opened (token-unreadable)`);
        throw new GmailSendError('GMAIL_NOT_CONFIGURED');
    }
    let answer;
    try {
        answer = await refreshAccessToken(refreshToken, options);
    } catch (error) {
        throw await refreshFailure(error, companyId, settings.tokenFingerprint);
    }
    const lifetimeMs = (Number(answer.expiresIn) || 0) * 1000;
    if (lifetimeMs > EARLY_MS) {
        cached.set(companyId, {
            tokenFingerprint: settings.tokenFingerprint,
            accessToken: answer.accessToken,
            usableUntil: Date.now() + lifetimeMs - EARLY_MS,
        });
    }
    return answer.accessToken;
}

/**
 * An access token for the company's connected Gmail (`settings` as
 * `readSmtpSettings` returns them). `fresh: true` skips the kept one, after
 * Gmail refused it.
 */
async function gmailAccessToken({ companyId, settings }, { fresh = false, fetchImpl } = {}) {
    const kept = cached.get(companyId);
    if (kept && kept.tokenFingerprint !== settings.tokenFingerprint) cached.delete(companyId);
    else if (kept && !fresh && Date.now() < kept.usableUntil) return kept.accessToken;
    else if (kept) cached.delete(companyId);

    const key = `${companyId}:${settings.tokenFingerprint}`;
    if (!inFlight.has(key)) {
        const pending = refresh({ companyId, settings }, { fetchImpl });
        inFlight.set(key, pending);
        pending.then(() => inFlight.delete(key), () => inFlight.delete(key));
    }
    return inFlight.get(key);
}

/** Drops the company's kept access token, once Gmail refused what it allows. */
function forgetGmailAccessToken(companyId) {
    cached.delete(companyId);
}

module.exports = {
    forgetGmailAccessToken,
    gmailAccessToken,
    _resetAccessTokensForTesting: () => { cached.clear(); inFlight.clear(); },
};
