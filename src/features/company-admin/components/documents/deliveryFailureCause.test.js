// Why a send failed, in plain words, from the error texts the server's senders
// really record (`functions/emailService.js`, `functions/shared/smtpSettings.js`,
// nodemailer, `functions/integrations/factory.js`, the SMS adapters and
// `functions/notifySignerSMS.js`). Every address, number and id is artificial.
import { describe, expect, it } from 'vitest';
import { deliveryFailureCause, skippedTextNote } from './deliveryFailureCause';

const emailFailed = (emailError, overrides = {}) => ({ status: 'sent', emailStatus: 'failed', emailError, ...overrides });
const textFailed = (smsError, overrides = {}) => ({ status: 'sent', sendSms: true, smsStatus: 'failed', smsError, ...overrides });

describe('deliveryFailureCause', () => {
    it('has nothing to say about a document whose send did not fail', () => {
        expect(deliveryFailureCause({ status: 'sent', emailStatus: 'sent' })).toBeNull();
        expect(deliveryFailureCause(null)).toBeNull();
    });

    it.each([
        [
            'company email not set up',
            'Failed to send email: Missing email configuration for company co-artificial. Please configure SMTP settings in Company Settings > Email tab. Required fields: smtpHost, smtpPort, smtpUser, smtpPass',
            "The company's email is not set up.",
            'Settings → Email',
        ],
        [
            'saved SMTP password unreadable',
            'Failed to send email: Email configuration error: could not decrypt SMTP credentials.',
            "The company's saved email password can no longer be read.",
            'Settings → Email',
        ],
        [
            'SMTP login refused',
            'Failed to send email: Invalid login: 535-5.7.8 Username and Password not accepted (artificial)',
            "The email server did not accept the company's email login.",
            'Settings → Email',
        ],
        [
            'SMTP server unreachable',
            'Failed to send email: connect ECONNREFUSED 192.0.2.10:587',
            "SafeHaul could not reach the company's email server.",
            'Settings → Email',
        ],
        [
            'SMTP server name unknown',
            'Failed to send email: getaddrinfo ENOTFOUND smtp.example.test',
            "SafeHaul could not reach the company's email server.",
            'Settings → Email',
        ],
        [
            'address refused',
            "Failed to send email: Can't send mail - all recipients were rejected: 550 5.1.1 <pat@example.test>: Recipient address rejected: User unknown",
            'The email address was refused.',
            'Fix recipient and resend',
        ],
        [
            'mailbox unavailable',
            'Mailbox unavailable',
            'The email address was refused.',
            'Fix recipient and resend',
        ],
        [
            // Nodemailer's words for a refused MAIL FROM: the company's address, not the signer's.
            'the sending address refused',
            'Failed to send email: Mail command failed: 553 5.7.1 <hr@carrier.example.test>: Sender address rejected: not owned by user',
            "The email server refused the company's sending address.",
            'Settings → Email',
        ],
        [
            "the sending address refused, in a server's own words",
            'Failed to send email: 550 5.7.1 Sender address rejected: Access denied',
            "The email server refused the company's sending address.",
            'Settings → Email',
        ],
    ])('explains an email that failed because of %s', (_label, error, cause, pointer) => {
        const explained = deliveryFailureCause(emailFailed(error));
        expect(explained).toMatchObject({ channel: 'Email', cause, raw: error });
        expect(explained.fix).toContain(pointer);
    });

    it.each([
        [
            'no SMS provider',
            'No SMS provider configured for company: co-artificial',
            "The company's text messaging is not set up.",
            'Settings → Text messages (SMS)',
        ],
        [
            'SMS switched off',
            'SMS integration is disabled for this company.',
            "The company's text messaging is not set up.",
            'Settings → Text messages (SMS)',
        ],
        [
            'no line',
            'No authentication key found for +15550100000. Please contact your Super Admin to provision this line.',
            "The company's text messaging is not set up.",
            'Settings → Text messages (SMS)',
        ],
        [
            'a line not allowed to text',
            "Invalid 'From' number. The assigned line is not authorized for this account. (Fallback failed)",
            "The company's texting line is not allowed to send text messages.",
            'Settings → Text messages (SMS)',
        ],
        [
            'a refused SMS login',
            'Authentication with RingCentral failed. Please verify your JWT token and credentials.',
            "The text message service did not accept the company's login.",
            'Settings → Text messages (SMS)',
        ],
        [
            'an invalid number',
            'RingCentral Error [InvalidParameter]: Parameter [to.phoneNumber] value is invalid',
            'The phone number was refused.',
            'Fix recipient and resend',
        ],
        [
            'a provider that did not answer',
            'RingCentral Error [Timeout]: RingCentral did not answer within 30 seconds. Nothing was sent; try again later.',
            'The text message service did not answer in time.',
            'Resend',
        ],
    ])('explains a text that failed because of %s', (_label, error, cause, pointer) => {
        const explained = deliveryFailureCause(textFailed(error));
        expect(explained).toMatchObject({ channel: 'SMS', cause, raw: error });
        expect(explained.fix).toContain(pointer);
    });

    it('says an opted-out number is the only way the document went, and how to reach the signer instead', () => {
        const explained = deliveryFailureCause(textFailed('Not texted: this number opted out of texts.'));
        expect(explained.cause).toBe('This number opted out of text messages, so it was not texted.');
        expect(explained.fix).toContain('Add an email address');
        expect(explained.fix).toContain('Fix recipient and resend');
    });

    it('does not ask for an email address when the email went', () => {
        const explained = deliveryFailureCause(textFailed('Not texted: this number opted out of texts.', { emailStatus: 'sent' }));
        expect(explained.cause).toBe('This number opted out of text messages, so it was not texted.');
        expect(explained.fix).toBe('The email went, so the signer has the link.');
    });

    it('falls back to a plain sentence for an error it does not know, keeping the raw text', () => {
        expect(deliveryFailureCause(emailFailed('Something odd (artificial)'))).toMatchObject({
            channel: 'Email',
            cause: 'The email could not be sent, and SafeHaul does not recognise the reason.',
            raw: 'Something odd (artificial)',
        });
        expect(deliveryFailureCause(textFailed('8x8 Error: something odd (artificial)'))).toMatchObject({
            channel: 'SMS',
            cause: 'The text message could not be sent, and SafeHaul does not recognise the reason.',
        });
    });

    it('explains a failure that recorded no error at all, with the generic sentence', () => {
        expect(deliveryFailureCause(emailFailed(undefined))).toMatchObject({
            cause: 'The email could not be sent, and SafeHaul does not recognise the reason.',
            raw: '',
        });
    });
});

describe('skippedTextNote', () => {
    it('reads why the text was skipped from smsNote, where the sender records it', () => {
        expect(skippedTextNote({ smsStatus: 'skipped', smsNote: 'Not texted: this number opted out of texts.' }))
            .toBe('Not sent: this number opted out of text messages.');
    });

    it('says only that it was not sent when no reason was recorded', () => {
        expect(skippedTextNote({ smsStatus: 'skipped' })).toBe('Not sent.');
    });

    it('has nothing to say about a text that was not skipped', () => {
        expect(skippedTextNote({ smsStatus: 'failed', smsError: 'Not texted: this number opted out of texts.' })).toBeNull();
    });
});
