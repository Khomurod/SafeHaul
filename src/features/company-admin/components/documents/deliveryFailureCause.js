/**
 * Why a document's send failed, in plain words, for its details dialog.
 *
 * The server records the sender's own error on the request (`emailError`,
 * `smsError`), which is written for a developer: it can carry the company's
 * internal id or a provider's code. This matches the texts the senders really
 * write and says what happened (`cause`) and what to do (`fix`); the dialog
 * shows the raw text beside it (`raw`). The texts come from:
 *
 *   - email: `functions/emailService.js` (every error as "Failed to send email:
 *     …", and a missing SMTP setup by name), `functions/shared/smtpSettings.js`
 *     (a password it cannot decrypt) and nodemailer's own (Invalid login,
 *     ECONNREFUSED, a refused recipient);
 *   - text: `functions/integrations/factory.js` (no provider, SMS switched off,
 *     a line with no key), the SMS adapters (a refused login, a line not allowed
 *     to text, a timeout, a refused number) and `functions/notifySignerSMS.js`
 *     (an opted-out number).
 *
 * The first pattern that matches wins; an error none matches gets a generic
 * sentence. Which send counts as failed is `deliveryFailure`'s to decide.
 */
import { deliveryFailure } from '@features/company-admin/utils/documentsWorkspace';

const EMAIL_SETTINGS = 'Settings → Email';
const SMS_SETTINGS = 'Settings → Text messages (SMS)';
const FIX_RECIPIENT = 'Fix recipient and resend';

const EMAIL_CAUSES = [
    {
        pattern: /Missing email configuration|configure SMTP settings/i,
        cause: "The company's email is not set up.",
        fix: `A company admin can set it up in ${EMAIL_SETTINGS}, then press Resend.`,
    },
    {
        pattern: /could not decrypt SMTP credentials/i,
        cause: "The company's saved email password can no longer be read.",
        fix: `A company admin can enter it again in ${EMAIL_SETTINGS}, then press Resend.`,
    },
    {
        pattern: /Invalid login|EAUTH|authentication (failed|unsuccessful|required)|Username and Password not accepted|\b535\b/i,
        cause: "The email server did not accept the company's email login.",
        fix: `A company admin can check the address and password in ${EMAIL_SETTINGS}, then press Resend.`,
    },
    {
        pattern: /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ESOCKET|ECONNECTION|getaddrinfo|Connection (timeout|closed)|Greeting never received|certificate|wrong version number|socket hang up/i,
        cause: "SafeHaul could not reach the company's email server.",
        fix: `A company admin can check the server and port in ${EMAIL_SETTINGS}, then press Resend.`,
    },
    {
        pattern: /No recipients defined|recipients were rejected|address rejected|mailbox unavailable|user unknown|no such user|does not exist|invalid (recipient|address|mailbox)|EENVELOPE/i,
        cause: 'The email address was refused.',
        fix: `Check it, then use ${FIX_RECIPIENT}.`,
    },
];

const SMS_CAUSES = [
    {
        pattern: /No SMS provider configured|SMS integration is disabled|No authentication key found|Keychain entry|Configuration encryption error|Missing 8x8|provision this line/i,
        cause: "The company's text messaging is not set up.",
        fix: `A company admin can set it up in ${SMS_SETTINGS}, then press Resend.`,
    },
    {
        pattern: /Invalid 'From' number|\[from\]|not authorized for this account|SMS feature is not available/i,
        cause: "The company's texting line is not allowed to send text messages.",
        fix: `A company admin can check the line in ${SMS_SETTINGS}, then press Resend.`,
    },
    {
        pattern: /Authentication with RingCentral failed|API Key is invalid|InvalidAuthentication|unauthori[sz]ed/i,
        cause: "The text message service did not accept the company's login.",
        fix: `A company admin can connect it again in ${SMS_SETTINGS}, then press Resend.`,
    },
    {
        pattern: /did not answer within|Timeout|Rate Limit/i,
        cause: 'The text message service did not answer in time.',
        fix: 'Wait a few minutes, then press Resend.',
    },
    {
        pattern: /to\.phoneNumber|\[to\]|invalid.*(phone|number)|(phone|number).*(invalid|not valid)/i,
        cause: 'The phone number was refused.',
        fix: `Check it, then use ${FIX_RECIPIENT}.`,
    },
];

const GENERIC = {
    Email: {
        cause: 'The email could not be sent, and SafeHaul does not recognise the reason.',
        fix: `Press Resend to try again, or use ${FIX_RECIPIENT} if the address may be wrong.`,
    },
    SMS: {
        cause: 'The text message could not be sent, and SafeHaul does not recognise the reason.',
        fix: `Press Resend to try again, or use ${FIX_RECIPIENT} if the number may be wrong.`,
    },
};

const OPTED_OUT = /opted out/i;

/**
 * A number on the opt-out list is never texted. Whether that leaves the signer
 * without the link depends on the email, so the advice reads the document.
 */
function optedOut(document) {
    return {
        cause: 'This number opted out of text messages, so it was not texted.',
        fix: document?.emailStatus === 'sent'
            ? 'The email went, so the signer has the link.'
            : `Add an email address and choose Email with ${FIX_RECIPIENT}.`,
    };
}

/**
 * `{ channel, cause, fix, raw }` for a document whose send failed
 * (`deliveryFailure`), or null. `channel` is `Email` or `SMS`.
 */
export function deliveryFailureCause(document) {
    const failure = deliveryFailure(document);
    if (!failure) return null;
    const raw = typeof failure.error === 'string' ? failure.error : '';
    let explained;
    if (failure.channel === 'SMS' && OPTED_OUT.test(raw)) {
        explained = optedOut(document);
    } else {
        const causes = failure.channel === 'SMS' ? SMS_CAUSES : EMAIL_CAUSES;
        explained = causes.find(({ pattern }) => pattern.test(raw)) || GENERIC[failure.channel];
    }
    return { channel: failure.channel, cause: explained.cause, fix: explained.fix, raw };
}

/**
 * The note for a text deliberately not sent (`smsStatus: 'skipped'`), which is
 * not a failure: today only an opted-out number when the email went.
 */
export function skippedTextNote(document) {
    if (document?.smsStatus !== 'skipped') return null;
    return OPTED_OUT.test(String(document.smsError || ''))
        ? 'Not sent: this number opted out of text messages.'
        : 'Not sent.';
}
