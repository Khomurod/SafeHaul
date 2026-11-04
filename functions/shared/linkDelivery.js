/**
 * linkDelivery.js — the server emails a driver their own link, so no team
 * member's screen holds it.
 *
 * Two links a recruiter used to copy by hand can be emailed instead, by passing
 * `deliver: 'email'`: the application link or continuation link
 * (`mintApplicationInvite`, `companyApplications/inviteDelivery.js`) and the
 * "approve changes" review link (`createChangeReview`). Both keep these rules:
 *
 *  - the address is the record's own (a draft's `contactEmail`, an application's
 *    `email`) and a real one: never a placeholder (`deliverableEmail`);
 *  - the caller is told the address masked, and never the token or the link;
 *  - the link is built on the app's own site, from an allowlist, so a caller
 *    cannot point a driver's link at another one (`appOriginFor`);
 *  - nothing is minted when it cannot be sent: no address, no company email,
 *    a limit reached (`assertEmailAllowed`), or an email claimed less than
 *    `DELIVERY_COOLDOWN_MS` ago;
 *  - one press is one email: the send is claimed on the record in the
 *    transaction that mints the link (`deliveryClaim`), and a failed send
 *    releases the claim (`sendClaimedEmail`);
 *  - nothing here logs the link, the token or the address.
 *
 * The email goes through the company's own SMTP settings (`emailService.js`),
 * whose password is decrypted in the calling function, so each callable that
 * delivers binds SMS_ENCRYPTION_KEY (`smsSecretBindings.test.js`). Being the
 * company's own account, its mailbox may keep the sent email, link included,
 * as it does for every signing email.
 */
const { trustedAppBaseUrl } = require('./appOrigin');
const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { db } = require('../firebaseAdmin');
const { sendDynamicEmail } = require('../emailService');
const { readSmtpSettings } = require('./smtpSettings');
const { checkRateLimit } = require('./rateLimiter');
const { isValidEmail } = require('./isValidEmail');
const { isPlaceholderEmail } = require('./placeholderDomains');
const { escapeHtml } = require('./plainText');

/** An email claimed this recently, being sent or sent, refuses another for the same record. */
const DELIVERY_COOLDOWN_MS = 60 * 1000;

/** Emails to drivers: per team member across records, and per record. */
const EMAIL_LIMITS = Object.freeze({
    perUser: Object.freeze({ limit: 30, windowSeconds: 3600 }),
    perRecord: Object.freeze({ limit: 5, windowSeconds: 3600 }),
});

/**
 * The origin the emailed link uses: the caller's, when it is one of the app's
 * sites (Testing and Production share this backend, so the press says which one
 * the driver should open), else the configured base (`shared/appOrigin.js`, the
 * one list of the app's sites the server keeps).
 */
function appOriginFor(candidate) {
    return trustedAppBaseUrl(candidate);
}

/** The address to email, or '' when the record has none we may use. */
function deliverableEmail(value) {
    const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return isValidEmail(email) && !isPlaceholderEmail(email) ? email : '';
}

/** `dana@example.test` → `d***@example.test`: enough to tell which inbox, no more. */
function maskEmail(email) {
    const at = String(email || '').lastIndexOf('@');
    return at < 1 ? '***' : `${email[0]}***${email.slice(at)}`;
}

/** What a caller asked for: null for no delivery, or 'email', the one channel offered. */
function readDeliver(data) {
    const deliver = data?.deliver;
    if (deliver === undefined || deliver === null) return null;
    if (deliver === 'email') return 'email';
    throw new HttpsError('invalid-argument', 'deliver must be "email".');
}

const REFUSALS = Object.freeze({
    'no-email': ['failed-precondition',
        'This driver has no email address we can send to, so nothing was sent. Copy the link and send it another way.'],
    'email-not-configured': ['failed-precondition',
        'Email is not set up for your company, so nothing was sent. A Company Admin can set it up in '
        + 'Company Settings → Email. Until then, copy the link.'],
    'just-sent': ['failed-precondition',
        'A link was emailed to this driver less than a minute ago. Wait a minute before sending another.'],
    'rate-limited': ['resource-exhausted',
        'Too many emails in a row. Wait a while and try again, or copy the link.'],
    'email-failed': ['unavailable',
        'The email could not be sent: your company\'s email server did not accept it. Nobody received '
        + 'the new link. Try again, or copy a link instead.'],
});

/** The refusal a caller is shown, with `details.reason` so a screen can tell them apart. */
function refusal(reason) {
    const [code, message] = REFUSALS[reason];
    return new HttpsError(code, message, { reason });
}

/**
 * The company's name, when it has email set up; null when it does not, or its
 * settings cannot be read. Asked before anything is minted, so a company without
 * email does not retire the driver's live link for an email it cannot send.
 */
async function emailSenderFor(companyId) {
    try {
        const { settings, companyName } = await readSmtpSettings(companyId);
        return settings?.user ? { companyName: companyName || 'SafeHaul' } : null;
    } catch {
        console.warn(`[linkDelivery] company ${companyId}: its email settings could not be read`);
        return null;
    }
}

/** Refuses once this team member, or this record, has had its emails for the hour. */
async function assertEmailAllowed({ companyId, uid, recordKey }) {
    const { perUser, perRecord } = EMAIL_LIMITS;
    const allowed = await checkRateLimit(`link_email_${companyId}_${uid}`, perUser.limit, perUser.windowSeconds, 'closed')
        && await checkRateLimit(`link_email_${recordKey}`, perRecord.limit, perRecord.windowSeconds, 'closed');
    if (!allowed) throw refusal('rate-limited');
}

/**
 * The claim written on the record with the link. Every key is written, so a
 * merge over an earlier claim leaves none of its outcome behind.
 */
function deliveryClaim({ uid, to, now }) {
    return {
        channel: 'email',
        status: 'sending',
        to: maskEmail(to),
        claimId: crypto.randomUUID(),
        claimedAt: new Date(now),
        by: uid,
        sentAt: null,
        failedAt: null,
    };
}

function millisOf(value) {
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return null;
}

/** An email being sent, or sent, less than the cooldown ago: another press is refused. */
function deliveryCoolingDown(record, now) {
    if (!record || (record.status !== 'sending' && record.status !== 'sent')) return false;
    const at = millisOf(record.claimedAt);
    return at !== null && now - at < DELIVERY_COOLDOWN_MS;
}

/** The claim's outcome, on the record, unless the record is gone or a newer press owns it. */
async function settleClaim(ref, field, claim, patch, label) {
    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const current = snap.exists ? (snap.data() || {})[field] : null;
            if (!current || current.claimId !== claim.claimId) return;
            tx.update(ref, { [field]: { ...current, ...patch } });
        });
    } catch (error) {
        // The code only: a Firestore message names the document, and a review's id is its token.
        console.warn(`[${label}] the email's outcome was not recorded (${error?.code || 'error'})`);
    }
}

/**
 * Sends the claimed email and records how it went on `ref` under `field`.
 * Resolves to the masked address; a failed send releases the claim, so the next
 * press may send at once, and throws `email-failed`.
 */
async function sendClaimedEmail({ companyId, ref, field, claim, to, subject, html, label }) {
    try {
        await sendDynamicEmail(companyId, to, subject, html);
    } catch {
        // Not the error's text: an SMTP server's reply is not ours to vouch for.
        console.error(`[${label}] company ${companyId}: the email was not sent`);
        await settleClaim(ref, field, claim, { status: 'failed', failedAt: new Date() }, label);
        throw refusal('email-failed');
    }
    await settleClaim(ref, field, claim, { status: 'sent', sentAt: new Date() }, label);
    return claim.to;
}

/** One email to a driver: a heading, a greeting, a few paragraphs, the button, a footnote. Everything escaped. */
function linkEmailHtml({ heading, greeting, paragraphs = [], buttonLabel, url, footnote }) {
    const text = (value) => `<p style="color: #374151; font-size: 16px; line-height: 1.5;">${escapeHtml(value)}</p>`;
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 24px;">
            <div style="background: #ffffff; border-radius: 8px; padding: 32px;">
                <h1 style="margin: 0 0 24px; font-size: 20px; color: #111827;">${escapeHtml(heading)}</h1>
                ${text(greeting)}
                ${paragraphs.map(text).join('\n')}
                <div style="text-align: center; margin: 32px 0;">
                    <a href="${escapeHtml(url)}"
                       style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none;
                              padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: bold;">
                        ${escapeHtml(buttonLabel)}
                    </a>
                </div>
                <p style="color: #6b7280; font-size: 13px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
                    ${escapeHtml(footnote)}
                </p>
            </div>
        </div>`;
}

module.exports = {
    DELIVERY_COOLDOWN_MS,
    EMAIL_LIMITS,
    appOriginFor,
    assertEmailAllowed,
    deliverableEmail,
    deliveryClaim,
    deliveryCoolingDown,
    emailSenderFor,
    linkEmailHtml,
    maskEmail,
    readDeliver,
    refusal,
    sendClaimedEmail,
};
