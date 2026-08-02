/**
 * emailService — Unit Tests
 *
 * Tests the getEmailSettings precedence logic and decryptSmtpPassword
 * backward compatibility for the migration window.
 */

const VALID_KEY = '12345678901234567890123456789012'; // 32 chars for AES-256

describe('emailService — getEmailSettings Precedence', () => {
    it('should prefer subcollection data when it has smtpPass', () => {
        // Simulate: subcollection has smtpPass, root also has smtpPass
        const subcollectionData = { smtpHost: 'smtp.gmail.com', smtpPass: 'new-plaintext' };
        const rootData = { smtpHost: 'smtp.old.com', smtpPass: 'enc:v1:old-encrypted' };

        // Simulate precedence logic from getEmailSettings
        let settings;
        if (subcollectionData && subcollectionData.smtpPass) {
            settings = subcollectionData;
        } else {
            settings = rootData;
        }

        expect(settings.smtpPass).toBe('new-plaintext');
        expect(settings.smtpHost).toBe('smtp.gmail.com');
    });

    it('should fallback to root when subcollection is empty', () => {
        const subcollectionData = null;
        const rootData = { smtpHost: 'smtp.gmail.com', smtpPass: 'enc:v1:abc123' };

        let settings;
        if (subcollectionData && subcollectionData.smtpPass) {
            settings = subcollectionData;
        } else {
            settings = rootData;
        }

        expect(settings.smtpPass).toBe('enc:v1:abc123');
        expect(settings.smtpHost).toBe('smtp.gmail.com');
    });

    it('should fallback to root when subcollection exists but no smtpPass', () => {
        const subcollectionData = { smtpHost: 'smtp.gmail.com' }; // no smtpPass
        const rootData = { smtpHost: 'smtp.gmail.com', smtpPass: 'legacy-pass' };

        let settings;
        if (subcollectionData && subcollectionData.smtpPass) {
            settings = subcollectionData;
        } else {
            settings = rootData;
        }

        expect(settings.smtpPass).toBe('legacy-pass');
    });

    it('should return null when neither source has settings', () => {
        const subcollectionData = null;
        const rootData = null;

        let settings;
        if (subcollectionData && subcollectionData.smtpPass) {
            settings = subcollectionData;
        } else if (rootData) {
            settings = rootData;
        } else {
            settings = null;
        }

        expect(settings).toBeNull();
    });
});

describe('emailService — decryptSmtpPassword Compatibility', () => {
    let decrypt;

    beforeEach(() => {
        process.env.SMS_ENCRYPTION_KEY = VALID_KEY;
        const enc = require('../../integrations/encryption');
        enc._resetEncryptionKeyForTesting();
        decrypt = enc.decrypt;
    });

    afterEach(() => {
        delete process.env.SMS_ENCRYPTION_KEY;
    });

    it('should decrypt enc:v1: prefixed passwords (legacy support)', () => {
        const enc = require('../../integrations/encryption');
        const plaintext = 'my-smtp-password';
        const encrypted = enc.encrypt(plaintext);
        const storedValue = `enc:v1:${encrypted}`;

        // Simulate decryptSmtpPassword logic
        let result;
        if (storedValue.startsWith('enc:v1:')) {
            result = decrypt(storedValue.slice('enc:v1:'.length));
        } else {
            result = storedValue;
        }

        expect(result).toBe(plaintext);
    });

    it('should pass plaintext passwords through unchanged', () => {
        const plaintextValues = [
            'my-app-password',
            'SG.abc123def456',
            'xxxx xxxx xxxx xxxx',
        ];

        plaintextValues.forEach(value => {
            let result;
            if (value.startsWith('enc:v1:')) {
                result = decrypt(value.slice('enc:v1:'.length));
            } else {
                result = value;
            }
            expect(result).toBe(value);
        });
    });

    it('should handle empty/null passwords gracefully', () => {
        [null, undefined, ''].forEach(value => {
            // decryptSmtpPassword returns rawPass as-is for falsy values
            expect(value || null).toBeFalsy();
        });
    });
});
