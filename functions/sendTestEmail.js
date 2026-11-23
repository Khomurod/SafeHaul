/**
 * "Send test email": a company admin checks that the company's email works,
 * with what it sends every other email with (`emailService.sendDynamicEmail`):
 * the connected Gmail, else the SMTP settings.
 *
 * The email goes only to the caller's own sign-in address, with fixed text,
 * at most five an hour per company. A failure answers a plain message by its
 * code; the log names the company and the code, never an address.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { assertCompanyAdminStrict } = require('./shared/companyAccess');
const { checkRateLimit } = require('./shared/rateLimiter');
const { isValidEmail } = require('./shared/isValidEmail');
const { sendDynamicEmail } = require('./emailService');
const { GMAIL_SEND_FAILURES } = require('./shared/gmail/sendErrors');

const TESTS_PER_HOUR = 5;
const SUBJECT = 'SafeHaul test email';
const HTML = '<p>This is a test email from SafeHaul.</p>'
    + "<p>It was sent with your company's email settings. If you can read it, SafeHaul can send your company's emails.</p>";

const NOT_SENT = 'The test email was not sent: your mail server did not accept it. Check the settings in Settings → Email.';

/** By the failure's code: the callable's error code and the plain message. */
const REFUSALS = Object.freeze({
    'not-configured': ['failed-precondition', 'Email is not set up for your company. A company admin can set it up in Settings → Email.'],
    'GMAIL_RECONNECT_NEEDED': ['failed-precondition', GMAIL_SEND_FAILURES.GMAIL_RECONNECT_NEEDED],
    'GMAIL_RATE_LIMITED': ['resource-exhausted', GMAIL_SEND_FAILURES.GMAIL_RATE_LIMITED],
    'GMAIL_NOT_CONFIGURED': ['failed-precondition', GMAIL_SEND_FAILURES.GMAIL_NOT_CONFIGURED],
    'GMAIL_UNAVAILABLE': ['unavailable', GMAIL_SEND_FAILURES.GMAIL_UNAVAILABLE],
    'GMAIL_REJECTED': ['failed-precondition', GMAIL_SEND_FAILURES.GMAIL_REJECTED],
    'GMAIL_FAILED': ['unavailable', GMAIL_SEND_FAILURES.GMAIL_FAILED],
});

function companyIdOf(data) {
    const companyId = data?.companyId;
    if (typeof companyId !== 'string' || !companyId || companyId.includes('/')) {
        throw new HttpsError('invalid-argument', 'companyId is required.');
    }
    return companyId;
}

// The secret opens the stored SMTP password or Gmail token (emailService.js).
exports.sendTestEmail = onCall({ cors: true, secrets: ['SMS_ENCRYPTION_KEY'] }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Login required.');
    const companyId = companyIdOf(request.data);
    await assertCompanyAdminStrict(uid, companyId);
    // After the admin check, so nobody else can use up the company's tests.
    if (!(await checkRateLimit(`send_test_email_${companyId}`, TESTS_PER_HOUR, 3600, 'closed'))) {
        throw new HttpsError('resource-exhausted', 'Five test emails were sent in the last hour. Try again later.');
    }

    const to = typeof request.auth.token?.email === 'string' ? request.auth.token.email.trim() : '';
    if (!isValidEmail(to)) {
        throw new HttpsError('failed-precondition', 'Your sign-in has no email address to send the test to.');
    }

    let sent;
    try {
        sent = await sendDynamicEmail(companyId, to, SUBJECT, HTML);
    } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : 'error';
        console.warn(`[sendTestEmail] company ${companyId}: the test email was not sent (${code})`);
        const [status, message] = REFUSALS[code] || ['unavailable', NOT_SENT];
        throw new HttpsError(status, message);
    }
    console.log(`[sendTestEmail] company ${companyId}: a test email was sent for ${uid}`);
    return { sent: true, to, from: sent?.from || null };
});
