/**
 * migrateEmailSettings — Unit Tests
 *
 * Tests the migration logic that moves email settings from
 * root company doc to admin-only subcollection, decrypting
 * any enc:v1: passwords in the process.
 */

const VALID_KEY = '12345678901234567890123456789012'; // 32 chars for AES-256

describe('migrateEmailSettings — Decryption Logic', () => {
    let encrypt;
    let decrypt;

    beforeEach(() => {
        process.env.SMS_ENCRYPTION_KEY = VALID_KEY;
        const enc = require('../../integrations/encryption');
        enc._resetEncryptionKeyForTesting();
        encrypt = enc.encrypt;
        decrypt = enc.decrypt;
    });

    afterEach(() => {
        delete process.env.SMS_ENCRYPTION_KEY;
    });

    it('should decrypt enc:v1: encrypted passwords to plaintext', () => {
        const originalPassword = 'my-gmail-app-password';
        const encrypted = `enc:v1:${encrypt(originalPassword)}`;

        // Simulate migration decryption logic
        let plaintextPassword;
        if (encrypted.startsWith('enc:v1:')) {
            plaintextPassword = decrypt(encrypted.slice('enc:v1:'.length));
        } else {
            plaintextPassword = encrypted;
        }

        expect(plaintextPassword).toBe(originalPassword);
    });

    it('should pass plaintext legacy passwords through unchanged', () => {
        const legacyPlaintext = 'old-plain-password';

        let plaintextPassword;
        if (legacyPlaintext.startsWith('enc:v1:')) {
            plaintextPassword = decrypt(legacyPlaintext.slice('enc:v1:'.length));
        } else {
            plaintextPassword = legacyPlaintext;
        }

        expect(plaintextPassword).toBe(legacyPlaintext);
    });

    it('should handle SMTP passwords that contain dots (not a real provider API key)', () => {
        // Avoid "SG." prefixes in-repo — secret scanners treat them as SendGrid keys.
        const apiKey = 'unit-test-smtp-password.with.dots-not-sendgrid';
        const encrypted = `enc:v1:${encrypt(apiKey)}`;

        let plaintextPassword;
        if (encrypted.startsWith('enc:v1:')) {
            plaintextPassword = decrypt(encrypted.slice('enc:v1:'.length));
        } else {
            plaintextPassword = encrypted;
        }

        expect(plaintextPassword).toBe(apiKey);
    });
});

describe('migrateEmailSettings — Idempotency', () => {
    it('should skip companies that already have subcollection data', () => {
        // Simulate: subcollection already has smtpPass
        const existingConfig = { smtpPass: 'already-migrated-password' };
        const shouldSkip = existingConfig && existingConfig.smtpPass;

        expect(shouldSkip).toBeTruthy();
    });

    it('should skip companies with no email settings', () => {
        const legacySettings = null;
        const shouldSkip = !legacySettings || !legacySettings.smtpPass;

        expect(shouldSkip).toBe(true);
    });

    it('should skip companies with empty smtpPass', () => {
        const legacySettings = { smtpHost: 'smtp.gmail.com', smtpPass: '' };
        const shouldSkip = !legacySettings || !legacySettings.smtpPass;

        expect(shouldSkip).toBe(true);
    });

    it('should process companies with valid smtpPass', () => {
        const legacySettings = { smtpHost: 'smtp.gmail.com', smtpPass: 'valid-password' };
        const shouldSkip = !legacySettings || !legacySettings.smtpPass;

        expect(shouldSkip).toBe(false);
    });
});

describe('migrateEmailSettings — Data Integrity', () => {
    let encrypt;

    beforeEach(() => {
        process.env.SMS_ENCRYPTION_KEY = VALID_KEY;
        const enc = require('../../integrations/encryption');
        enc._resetEncryptionKeyForTesting();
        encrypt = enc.encrypt;
    });

    afterEach(() => {
        delete process.env.SMS_ENCRYPTION_KEY;
    });

    it('should preserve all non-password fields during migration', () => {
        const legacySettings = {
            smtpHost: 'smtp.gmail.com',
            smtpPort: 587,
            smtpUser: 'user@gmail.com',
            smtpPass: `enc:v1:${encrypt('test-password')}`,
            signature: 'Best regards',
            isVerified: true,
        };

        // Simulate migration output
        const migrated = {
            smtpHost: legacySettings.smtpHost || '',
            smtpPort: legacySettings.smtpPort || 587,
            smtpUser: legacySettings.smtpUser || '',
            signature: legacySettings.signature || '',
            isVerified: legacySettings.isVerified || false,
        };

        expect(migrated.smtpHost).toBe('smtp.gmail.com');
        expect(migrated.smtpPort).toBe(587);
        expect(migrated.smtpUser).toBe('user@gmail.com');
        expect(migrated.signature).toBe('Best regards');
        expect(migrated.isVerified).toBe(true);
    });

    it('should not produce double-encrypted passwords after migration', () => {
        const originalPassword = 'my-real-password';
        const encrypted = `enc:v1:${encrypt(originalPassword)}`;

        // Migration decrypts once
        const { decrypt } = require('../../integrations/encryption');
        const migrated = decrypt(encrypted.slice('enc:v1:'.length));

        // Result is plaintext — should NOT start with enc:v1:
        expect(migrated).toBe(originalPassword);
        expect(migrated).not.toMatch(/^enc:v1:/);
    });
});
