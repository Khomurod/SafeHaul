/**
 * A connected Gmail that stopped working, and how the team hears about it.
 *
 * - `markGmailNeedsReconnect` records `gmailStatus: 'needs_reconnect'` on the
 *   server-only `email_config`, with a reason code and the time. It changes
 *   the status only while the stored token is still the one that failed
 *   (compared by the fingerprint of its sealed value), so a reconnect made in
 *   the meantime is never undone.
 * - `noteGmailReconnectNeeded` tells the team in the bell, once a UTC day
 *   (`createNotification` with a fixed id), each day a send is refused for it.
 *
 * Both are best effort and never throw: the send that found the failure
 * reports it either way. Logs carry the company id and codes only.
 */
const { admin, db } = require('../../firebaseAdmin');
const { createNotification } = require('../createNotification');
const { gmailTokenFingerprint } = require('../smtpSettings');

/** Why a stored grant stopped working (`gmailStatusReason`). */
const RECONNECT_REASONS = Object.freeze(['invalid_grant', 'insufficient_scope', 'admin_policy', 'expired']);

const emailConfigRef = (companyId) => db.collection('companies').doc(companyId)
    .collection('system_settings').doc('email_config');

/** True when the settings the reader returned are a Gmail that needs reconnecting. */
const gmailNeedsReconnect = (settings) => settings?.kind === 'gmail' && settings.status === 'needs_reconnect';

/** Companies already told today by this instance: a repeat costs a refused write and a log line. */
const toldOn = new Map();

/** The team's bell notice for today, once a UTC day. */
async function noteGmailReconnectNeeded(companyId) {
    const day = new Date(Date.now()).toISOString().slice(0, 10);
    if (toldOn.get(companyId) === day) return;
    try {
        await createNotification(db, companyId, {
            type: 'gmail_reconnect',
            title: 'Gmail needs reconnecting',
            message: 'Emails are not being sent from your company Gmail. A company admin can reconnect it in Settings → Email.',
        }, { id: `gmail_reconnect_${day}` });
        toldOn.set(companyId, day);
    } catch (error) {
        console.warn(`[gmailStatus] company ${companyId}: the reconnect notice was not written (${error?.code ?? 'error'})`);
    }
}

/**
 * Marks the company's Gmail as needing a reconnect when `tokenFingerprint` is
 * still the stored token's, then writes today's notice. Answers what it did:
 * `marked`, `already` (it was marked before), `replaced` (Gmail was
 * reconnected or disconnected since; nothing is written) or `failed`.
 */
async function markGmailNeedsReconnect(companyId, reason, tokenFingerprint) {
    const code = RECONNECT_REASONS.includes(reason) ? reason : 'invalid_grant';
    let outcome;
    try {
        outcome = await db.runTransaction(async (transaction) => {
            const ref = emailConfigRef(companyId);
            const snap = await transaction.get(ref);
            const stored = snap.exists ? snap.data() || {} : {};
            const sameToken = stored.provider === 'gmail'
                && typeof stored.gmailRefreshToken === 'string'
                && gmailTokenFingerprint(stored.gmailRefreshToken) === tokenFingerprint;
            if (!sameToken) return 'replaced';
            if (stored.gmailStatus === 'needs_reconnect') return 'already';
            transaction.update(ref, {
                gmailStatus: 'needs_reconnect',
                gmailStatusReason: code,
                gmailStatusAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return 'marked';
        });
    } catch (error) {
        console.error(`[gmailStatus] company ${companyId}: the Gmail status was not written (${error?.code ?? 'error'})`);
        outcome = 'failed';
    }
    console.warn(`[gmailStatus] company ${companyId}: Gmail needs reconnecting (${code}); status ${outcome}`);
    if (outcome !== 'replaced') await noteGmailReconnectNeeded(companyId);
    return outcome;
}

module.exports = {
    RECONNECT_REASONS,
    gmailNeedsReconnect,
    markGmailNeedsReconnect,
    noteGmailReconnectNeeded,
    _resetNoticesForTesting: () => toldOn.clear(),
};
