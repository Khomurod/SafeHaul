import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

/**
 * Client for the Super Admin Landing Page Settings callables.
 *
 * Re-authentication handling is shared with the environment vault, so a stale
 * session produces the same prompt-and-retry behaviour here as it does there.
 *
 * There is deliberately **no reveal call**. The server has no callable that
 * returns the Telegram bot token, so this client has nothing to expose: a saved
 * token is write-only from the browser's point of view, and the screen
 * identifies it by fingerprint and bot username instead.
 */

export {
    ReauthCancelledError,
    isReauthCancelled,
    isReauthRequired,
    reauthenticateWithPassword,
} from './environmentVault';

export function describeLandingError(error, fallback = 'That operation could not be completed.') {
    if (!error) return fallback;
    switch (error.code) {
        case 'functions/unauthenticated':
            return 'Your session has ended. Sign in again to continue.';
        case 'functions/permission-denied':
            return 'Super Admin access is required for this action.';
        case 'functions/resource-exhausted':
            return 'Too many requests. Wait a moment and try again.';
        case 'functions/not-found':
            return 'That record no longer exists. Refresh the list.';
        case 'functions/invalid-argument':
        case 'functions/failed-precondition':
            // The server writes these messages to be read by an operator, so the
            // typed prefix is stripped and the rest is shown as-is.
            return error.message?.replace(/^.*?:\s*/, '') || fallback;
        default:
            return fallback;
    }
}

/**
 * Turns a classified delivery code into something an operator can act on.
 *
 * The codes come from `functions/landing/telegram.js` and never carry any part
 * of a Telegram response, so mapping them here is safe and is the only place
 * that knows the wording.
 */
export function describeDeliveryCode(code) {
    switch (code) {
        case 'not-configured':
            return 'No bot token and chat are configured yet.';
        case 'invalid-token':
            return 'Telegram rejected the bot token. Generate a new one with BotFather and save it here.';
        case 'bot-blocked-or-not-in-chat':
            return 'The bot is not a member of that chat, or has been blocked. Add it to the group and try again.';
        case 'invalid-chat-id-or-message':
            return 'Telegram did not recognise that chat ID.';
        case 'telegram-rate-limited':
            return 'Telegram is rate-limiting this bot. Try again shortly.';
        case 'telegram-unavailable':
            return 'Telegram is unavailable right now. Leads are still being recorded.';
        case 'telegram-timeout':
            return 'Telegram did not respond in time. Leads are still being recorded.';
        case 'telegram-network-error':
            return 'The request to Telegram failed. Leads are still being recorded.';
        case 'telegram-rejected':
        case 'telegram-unreadable-response':
            return 'Telegram refused the message without an explanation.';
        default:
            return code ? `Delivery failed (${code}).` : null;
    }
}

export async function getLandingPageSettings() {
    const call = httpsCallable(functions, 'getLandingPageSettings');
    const result = await call({});
    return result.data;
}

/**
 * Saves the Telegram credentials.
 *
 * The server verifies the token with Telegram before storing it, so a rejected
 * save means the token is wrong rather than that the write failed.
 */
export async function updateLandingTelegramConfig({ botToken, chatId, enabled }) {
    const call = httpsCallable(functions, 'updateLandingTelegramConfig');
    const result = await call({ botToken, chatId, enabled });
    return result.data;
}

export async function setLandingTelegramEnabled(enabled) {
    const call = httpsCallable(functions, 'setLandingTelegramEnabled');
    const result = await call({ enabled });
    return result.data;
}

export async function sendLandingTelegramTest() {
    const call = httpsCallable(functions, 'sendLandingTelegramTest');
    const result = await call({});
    return result.data;
}

export async function listLandingLeads(limit = 50) {
    const call = httpsCallable(functions, 'listLandingLeads');
    const result = await call({ limit });
    return result.data;
}

export async function retryLandingLeadDelivery(leadId) {
    const call = httpsCallable(functions, 'retryLandingLeadDelivery');
    const result = await call({ leadId });
    return result.data;
}
