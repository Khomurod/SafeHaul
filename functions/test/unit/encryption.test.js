// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Reset module cache before each suite to allow key validation testing
let encrypt;
let decrypt;

describe('Encryption Utility', () => {
    const VALID_KEY = '12345678901234567890123456789012'; // Exactly 32 chars

    beforeEach(() => {
        // Reset the module cache so _encryptionKey is cleared between tests
        const enc = require('../../integrations/encryption');
        if (enc._resetEncryptionKeyForTesting) enc._resetEncryptionKeyForTesting();
        process.env.SMS_ENCRYPTION_KEY = VALID_KEY;
        encrypt = enc.encrypt;
        decrypt = enc.decrypt;
    });

    afterEach(() => {
        delete process.env.SMS_ENCRYPTION_KEY;
    });

    it('should encrypt and decrypt a string correctly', () => {
        const original = '123-45-6789'; // SSN format
        const encrypted = encrypt(original);

        expect(encrypted).not.toBe(original);
        expect(encrypted).toContain(':'); // IV:EncryptedData format

        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(original);
    });

    it('should produce different ciphertext for same input (random IV)', () => {
        const original = 'Test-SSN-123';
        const encrypted1 = encrypt(original);
        const encrypted2 = encrypt(original);

        // Same plaintext should yield different ciphertext due to random IV
        expect(encrypted1).not.toBe(encrypted2);

        // But both should decrypt to the same value
        expect(decrypt(encrypted1)).toBe(original);
        expect(decrypt(encrypted2)).toBe(original);
    });

    it('should return null for empty/null input', () => {
        expect(encrypt(null)).toBeNull();
        expect(encrypt(undefined)).toBeNull();
        expect(encrypt('')).toBeNull();
        expect(decrypt(null)).toBeNull();
        expect(decrypt(undefined)).toBeNull();
        expect(decrypt('')).toBeNull();
    });

    it('should throw if encryption key is missing', () => {
        const enc = require('../../integrations/encryption');
        if (enc._resetEncryptionKeyForTesting) enc._resetEncryptionKeyForTesting();
        delete process.env.SMS_ENCRYPTION_KEY;

        expect(() => enc.encrypt('test')).toThrow('SMS_ENCRYPTION_KEY environment variable is not set');
    });

    it('should throw if encryption key is wrong length', () => {
        const enc = require('../../integrations/encryption');
        if (enc._resetEncryptionKeyForTesting) enc._resetEncryptionKeyForTesting();
        process.env.SMS_ENCRYPTION_KEY = 'too-short';

        expect(() => enc.encrypt('test')).toThrow('must be exactly 32 characters');
    });
});
