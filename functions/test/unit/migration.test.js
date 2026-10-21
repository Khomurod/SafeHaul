/**
 * A company's SMTP password as it is stored (`shared/smtpSettings.js`):
 * encrypted and `enc:v1:`-marked by `sealPassword`, opened by `plainPassword`;
 * one stored before encryption is plain text and read as it is.
 */

const VALID_KEY = '12345678901234567890123456789012'; // 32 chars for AES-256

describe('the stored SMTP password', () => {
    let sealPassword;
    let plainPassword;

    beforeEach(() => {
        process.env.SMS_ENCRYPTION_KEY = VALID_KEY;
        require('../../integrations/encryption')._resetEncryptionKeyForTesting();
        ({ sealPassword, plainPassword } = require('../../shared/smtpSettings'));
    });

    afterEach(() => {
        delete process.env.SMS_ENCRYPTION_KEY;
    });

    it('is stored encrypted and marked, and opens to what was typed', () => {
        const sealed = sealPassword('my-gmail-app-password');

        expect(sealed).toMatch(/^enc:v1:/);
        expect(sealed).not.toContain('my-gmail-app-password');
        expect(plainPassword(sealed)).toBe('my-gmail-app-password');
    });

    it('reads a password stored before encryption as it is', () => {
        expect(plainPassword('old-plain-password')).toBe('old-plain-password');
    });

    it('keeps a password with dots whole (not a real provider API key)', () => {
        // Avoid "SG." prefixes in-repo — secret scanners treat them as SendGrid keys.
        const apiKey = 'unit-test-smtp-password.with.dots-not-sendgrid';
        expect(plainPassword(sealPassword(apiKey))).toBe(apiKey);
    });
});
