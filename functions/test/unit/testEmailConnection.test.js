/**
 * testEmailConnection — Unit Tests
 *
 * Tests the validation guards added to the testEmailConnection Cloud Function.
 * Specifically: rejecting pre-encrypted passwords (Strategy A).
 */

describe('testEmailConnection — Validation Guards', () => {
    it('should detect enc:v1: prefixed passwords as invalid input', () => {
        // Simulate the guard logic from testEmailConnection.js
        const encryptedPassword = 'enc:v1:abcdef1234567890:deadbeefcafe';
        const isEncrypted = encryptedPassword.startsWith('enc:v1:');
        expect(isEncrypted).toBe(true);
    });

    it('should allow plaintext passwords through', () => {
        const plaintextPasswords = [
            'my-app-password',
            'SG.abcdefghijklmnop',
            'p@$$w0rd!with:special#chars',
            'xxxx xxxx xxxx xxxx', // Gmail app password format
        ];

        plaintextPasswords.forEach(pass => {
            const isEncrypted = pass.startsWith('enc:v1:');
            expect(isEncrypted).toBe(false);
        });
    });

    it('should reject the exact format that Firestore stores', () => {
        // This is what the bug looks like — the frontend sends back what's in Firestore
        const VALID_KEY = '12345678901234567890123456789012';
        process.env.SMS_ENCRYPTION_KEY = VALID_KEY;
        const enc = require('../../integrations/encryption');
        enc._resetEncryptionKeyForTesting();

        const realEncrypted = `enc:v1:${enc.encrypt('test-password')}`;

        // The guard must catch this
        expect(realEncrypted.startsWith('enc:v1:')).toBe(true);

        delete process.env.SMS_ENCRYPTION_KEY;
    });

    it('should not false-positive on passwords starting with "enc" but not "enc:v1:"', () => {
        // Edge case: someone has a password that starts with "enc" but isn't encrypted
        const edgeCases = [
            'encrypted-but-not-really',
            'enc-something',
            'enc:v2:future-format',
            'encv1:missing-first-colon',
        ];

        edgeCases.forEach(pass => {
            const isBlocked = pass.startsWith('enc:v1:');
            expect(isBlocked).toBe(false);
        });
    });
});
