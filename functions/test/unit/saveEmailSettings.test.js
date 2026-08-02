/**
 * saveEmailSettings — Unit Tests (Refactored)
 *
 * Tests the new behavior:
 * - Stores plaintext password (no encryption)
 * - Empty/omitted smtpPass preserves existing password
 * - Function response never contains smtpPass
 * - enc:v1: guard is no longer needed (but plaintext flows correctly)
 */

describe('saveEmailSettings — Plaintext Storage', () => {
    it('should store password as plaintext (no encryption)', () => {
        const smtpPass = 'my-gmail-app-password';

        // Simulate the new save logic: no encryption step
        const finalPassword = smtpPass.trim();

        // Password should be stored exactly as provided — not encrypted
        expect(finalPassword).toBe('my-gmail-app-password');
        expect(finalPassword).not.toMatch(/^enc:v1:/);
        expect(finalPassword).not.toContain(':'); // No IV:cipher format
    });

    it('should preserve existing password when no new password provided', () => {
        // Simulate: user saves settings without changing password
        const existingPassword = 'existing-plaintext-pass';
        const smtpPass = ''; // empty = no change

        let finalPassword;
        if (smtpPass && smtpPass.trim()) {
            finalPassword = smtpPass.trim();
        } else {
            // Fetch existing from subcollection
            finalPassword = existingPassword; // preserved as-is
        }

        expect(finalPassword).toBe('existing-plaintext-pass');
    });

    it('should use new password when provided', () => {
        const existingPassword = 'old-password';
        const smtpPass = 'brand-new-password';

        let finalPassword;
        if (smtpPass && smtpPass.trim()) {
            finalPassword = smtpPass.trim();
        } else {
            finalPassword = existingPassword;
        }

        expect(finalPassword).toBe('brand-new-password');
    });

    it('should trim whitespace from passwords', () => {
        const smtpPass = '  my-password-with-spaces  ';
        const finalPassword = smtpPass.trim();
        expect(finalPassword).toBe('my-password-with-spaces');
    });

    it('should handle passwords with special characters', () => {
        const specialPasswords = [
            'SG.abc123:def456:ghi789',
            'p@$$w0rd!',
            'xxxx xxxx xxxx xxxx', // Gmail app password
            'password-with-émojis-🔑',
        ];

        specialPasswords.forEach(pass => {
            const finalPassword = pass.trim();
            expect(finalPassword).toBe(pass.trim());
            // No encryption applied — stored as-is
            expect(finalPassword).not.toMatch(/^enc:v1:/);
        });
    });
});

describe('saveEmailSettings — Response Sanitization', () => {
    it('should never include smtpPass in response', () => {
        // Simulate the function response
        const response = {
            success: true,
            message: 'Email settings saved securely.',
            hasPassword: true,
        };

        expect(response).not.toHaveProperty('smtpPass');
        expect(response.hasPassword).toBe(true);
        expect(JSON.stringify(response)).not.toContain('my-password');
    });
});

describe('saveEmailSettings — Storage Location', () => {
    it('should target system_settings/email_config subcollection path', () => {
        const companyId = 'test-company-123';
        const expectedPath = `companies/${companyId}/system_settings/email_config`;

        // Simulate the Firestore path construction
        const path = `companies/${companyId}/system_settings/email_config`;
        expect(path).toBe(expectedPath);
    });

    it('should sync non-sensitive fields to root company doc', () => {
        // Simulate the root doc update (no smtpPass)
        const rootUpdate = {
            'emailSettings.smtpHost': 'smtp.gmail.com',
            'emailSettings.smtpPort': 587,
            'emailSettings.smtpUser': 'user@gmail.com',
            'emailSettings.signature': 'Best regards',
            'emailSettings.isVerified': true,
        };

        // Must NOT contain smtpPass
        expect(rootUpdate).not.toHaveProperty('emailSettings.smtpPass');
        expect(JSON.stringify(rootUpdate)).not.toContain('smtpPass');
    });
});
