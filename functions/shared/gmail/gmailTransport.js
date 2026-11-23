/**
 * A Nodemailer transport that sends through a company's connected Gmail, so
 * every caller keeps the shape it has with SMTP: `transporter.sendMail(mail)`.
 *
 * Nodemailer builds the message (headers, HTML, attachments) exactly as it
 * does for SMTP; this transport uploads it whole to Gmail's
 * `users.messages.send` (simple upload, `message/rfc822`), with the scope the
 * company granted (`gmail.send`). Gmail reads the recipients from the headers,
 * so the Bcc header is kept in the upload (Gmail removes it before delivery),
 * as Nodemailer's own stream transport keeps it.
 *
 * How a send fails (`sendErrors.js`):
 * - a Gmail already marked `needs_reconnect` sends nothing and asks Google
 *   nothing; the team's daily notice is written;
 * - 401: one fresh access token, one retry;
 * - 429, and 403 with a rate-limit reason: GMAIL_RATE_LIMITED, status unchanged;
 * - 403 for a missing send scope: the Gmail is marked `needs_reconnect`;
 * - 400 and 413: this email only (GMAIL_REJECTED); 5xx or no answer in 30 s:
 *   GMAIL_UNAVAILABLE.
 *
 * Logs carry the company id, the HTTP status and Google's reason code: never
 * a recipient, a token or Google's message text.
 */
const nodemailer = require('nodemailer');
const { forgetGmailAccessToken, gmailAccessToken } = require('./gmailAccess');
const { markGmailNeedsReconnect, noteGmailReconnectNeeded } = require('./gmailStatus');
const { GmailSendError } = require('./sendErrors');

const SEND_ENDPOINT = 'https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';
const TIMEOUT_MS = 30 * 1000;

const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded']);
const SCOPE_REASONS = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);
const REASON_PATTERN = /^[A-Za-z_]{1,64}$/;
const GMAIL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** The compiled message, read whole: Gmail's simple upload takes it in one request. */
function readMessage(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.once('error', reject);
        stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
}

/** Google's reason codes in an error answer (`errors[].reason`, `details[].reason`). */
function reasonsOf(body) {
    const error = body && typeof body === 'object' ? body.error || {} : {};
    return [error.errors, error.details]
        .flatMap((list) => (Array.isArray(list) ? list : []))
        .map((item) => item?.reason)
        .filter((reason) => typeof reason === 'string' && REASON_PATTERN.test(reason));
}

/** One upload; `{ status, body }`, or GMAIL_UNAVAILABLE when Google does not answer in time. */
async function upload(raw, accessToken, fetchImpl) {
    const send = fetchImpl || globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await send(SEND_ENDPOINT, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'message/rfc822' },
            body: raw,
            signal: controller.signal,
        });
        let body = null;
        try {
            body = await response.json();
        } catch {
            if (controller.signal.aborted) throw new GmailSendError('GMAIL_UNAVAILABLE');
        }
        return { status: response.status, body };
    } catch {
        // Not the error itself: a failed request can echo what it sent.
        throw new GmailSendError('GMAIL_UNAVAILABLE');
    } finally {
        clearTimeout(timer);
    }
}

/** The failure for an answer Gmail refused, after recording a lost send scope. */
async function refusal({ status, body }, { companyId, settings }) {
    const reasons = reasonsOf(body);
    console.warn(`[gmailTransport] company ${companyId}: Gmail did not send the email (${status}, ${reasons[0] || 'no reason'})`);
    if (status === 429 || (status === 403 && reasons.some((reason) => RATE_LIMIT_REASONS.has(reason)))) {
        return new GmailSendError('GMAIL_RATE_LIMITED');
    }
    if (status === 403 && reasons.some((reason) => SCOPE_REASONS.has(reason))) {
        forgetGmailAccessToken(companyId);
        await markGmailNeedsReconnect(companyId, 'insufficient_scope', settings.tokenFingerprint);
        return new GmailSendError('GMAIL_RECONNECT_NEEDED');
    }
    if (status === 400 || status === 413) return new GmailSendError('GMAIL_REJECTED');
    if (status >= 500) return new GmailSendError('GMAIL_UNAVAILABLE');
    return new GmailSendError('GMAIL_FAILED');
}

/** Sends one compiled Nodemailer message; resolves to Nodemailer's send info. */
async function sendThroughGmail({ companyId, settings, mail, fetchImpl }) {
    if (settings.status === 'needs_reconnect') {
        await noteGmailReconnectNeeded(companyId, settings.tokenFingerprint);
        throw new GmailSendError('GMAIL_RECONNECT_NEEDED');
    }
    mail.message.keepBcc = true;
    const envelope = mail.message.getEnvelope();
    const messageId = mail.message.messageId();
    const raw = await readMessage(mail.message.createReadStream());

    const access = { companyId, settings };
    let answer = await upload(raw, await gmailAccessToken(access, { fetchImpl }), fetchImpl);
    if (answer.status === 401) {
        // The kept access token lapsed or was revoked: one fresh one, one retry.
        answer = await upload(raw, await gmailAccessToken(access, { fresh: true, fetchImpl }), fetchImpl);
    }
    if (answer.status < 200 || answer.status >= 300) throw await refusal(answer, access);

    const gmailId = typeof answer.body?.id === 'string' && GMAIL_ID_PATTERN.test(answer.body.id) ? answer.body.id : null;
    return { envelope, messageId, gmailId };
}

/**
 * A Nodemailer transporter for the company's connected Gmail (`settings` as
 * `readSmtpSettings` returns them, `kind: 'gmail'`). It holds no connection:
 * the access token is kept by `gmailAccess.js`.
 */
function createGmailTransporter({ companyId, settings }, { fetchImpl } = {}) {
    return nodemailer.createTransport({
        name: 'SafeHaulGmail',
        version: '1.0.0',
        send(mail, done) {
            // A message Nodemailer could not build fails with its own error, as over SMTP.
            sendThroughGmail({ companyId, settings, mail, fetchImpl }).then((info) => done(null, info), done);
        },
    });
}

module.exports = { SEND_ENDPOINT, createGmailTransporter };
