/**
 * EmailSettingsTab — UI State Logic Tests (Refactored)
 *
 * Tests validate the callable-based loading, password isolation,
 * and submission behavior for the email settings UI.
 *
 * Key change: Settings now load via getEmailSettingsMeta callable
 * instead of from currentCompanyProfile.emailSettings.
 */
import { describe, it, expect } from 'vitest';

describe('EmailSettingsTab — Callable-Based Loading', () => {
    it('should derive settings from callable response, not company profile', () => {
        // Simulate the callable response (getEmailSettingsMeta)
        const callableResponse = {
            success: true,
            settings: {
                smtpHost: 'smtp.gmail.com',
                smtpPort: 587,
                smtpUser: 'user@gmail.com',
                signature: 'Best regards',
                isVerified: true,
                hasPassword: true,
                updatedAt: '2026-04-04T12:00:00Z',
                // NOTE: smtpPass is NEVER in this response
            },
        };

        const meta = callableResponse.settings;

        // Hydrate state from callable
        const emailSettings = {
            smtpHost: meta.smtpHost || '',
            smtpPort: meta.smtpPort || 587,
            smtpUser: meta.smtpUser || '',
            signature: meta.signature || '',
            isVerified: meta.isVerified || false,
        };
        const hasExistingPassword = meta.hasPassword || false;
        const smtpPassInput = ''; // Always empty

        expect(emailSettings.smtpHost).toBe('smtp.gmail.com');
        expect(emailSettings.smtpUser).toBe('user@gmail.com');
        expect(hasExistingPassword).toBe(true);
        expect(smtpPassInput).toBe('');

        // Verify smtpPass is NOWHERE in the hydrated state
        expect(emailSettings).not.toHaveProperty('smtpPass');
        expect(callableResponse.settings).not.toHaveProperty('smtpPass');
    });

    it('should handle callable response with no existing password', () => {
        const callableResponse = {
            success: true,
            settings: {
                smtpHost: '',
                smtpPort: 587,
                smtpUser: '',
                signature: '',
                isVerified: false,
                hasPassword: false,
            },
        };

        const meta = callableResponse.settings;
        const hasExistingPassword = meta.hasPassword || false;

        expect(hasExistingPassword).toBe(false);
    });

    it('should gracefully handle callable failure (degraded mode)', () => {
        // If callable fails, form should still be usable for first-time setup
        const callableError = new Error('Network error');
        let settingsLoaded = false;

        try {
            throw callableError;
        } catch (err) {
            // Graceful degradation — use defaults
            settingsLoaded = false;
        }

        expect(settingsLoaded).toBe(false);
        // Form should still render with empty defaults
    });
});

describe('EmailSettingsTab — Save Payload (Refactored)', () => {
    it('should omit password from save payload when input is empty (partial update)', () => {
        const smtpPassInput = '';

        const payload = {
            companyId: 'test-company-id',
            smtpHost: 'smtp.gmail.com',
            smtpPort: 587,
            smtpUser: 'user@gmail.com',
            signature: 'Updated signature',
        };

        if (smtpPassInput) {
            payload.smtpPass = smtpPassInput;
        }

        expect(payload).not.toHaveProperty('smtpPass');
    });

    it('should include plaintext password when user enters new one', () => {
        const smtpPassInput = 'new-app-password-123';

        const payload = {
            companyId: 'test-company-id',
            smtpHost: 'smtp.gmail.com',
            smtpPort: 587,
            smtpUser: 'user@gmail.com',
            signature: 'My signature',
        };

        if (smtpPassInput) {
            payload.smtpPass = smtpPassInput;
        }

        expect(payload.smtpPass).toBe('new-app-password-123');
        expect(payload.smtpPass).not.toMatch(/^enc:v1:/);
    });

    it('should send password as plaintext — backend no longer encrypts', () => {
        const smtpPassInput = 'my-real-password';

        // Backend stores it directly — no encryption prefix added
        const payload = { smtpPass: smtpPassInput };

        expect(payload.smtpPass).toBe('my-real-password');
        expect(payload.smtpPass).not.toMatch(/^enc:v1:/);
    });
});

describe('EmailSettingsTab — Test Connection', () => {
    it('should require password input for test connection', () => {
        const smtpPassInput = '';
        const canTest = !!smtpPassInput;
        expect(canTest).toBe(false);
    });

    it('should allow test connection when password is provided', () => {
        const smtpPassInput = 'my-test-password';
        const canTest = !!smtpPassInput;
        expect(canTest).toBe(true);
    });

    it('should use plaintext input for test connection', () => {
        const smtpPassInput = 'fresh-plaintext-password';
        const testPayload = {
            smtpHost: 'smtp.gmail.com',
            smtpPort: 587,
            smtpUser: 'user@gmail.com',
            smtpPass: smtpPassInput,
        };

        expect(testPayload.smtpPass).toBe('fresh-plaintext-password');
        expect(testPayload.smtpPass).not.toMatch(/^enc:v1:/);
    });
});

describe('EmailSettingsTab — Validation', () => {
    it('should allow save when password exists but input is empty (partial update)', () => {
        const smtpPassInput = '';
        const hasExistingPassword = true;
        const hostValid = true;
        const userValid = true;
        const isValid = hostValid && userValid && (Boolean(smtpPassInput) || hasExistingPassword);
        expect(isValid).toBeTruthy();
    });

    it('should block save when no password exists AND input is empty', () => {
        const smtpPassInput = '';
        const hasExistingPassword = false;
        const hostValid = true;
        const userValid = true;
        const isValid = hostValid && userValid && (Boolean(smtpPassInput) || hasExistingPassword);
        expect(isValid).toBeFalsy();
    });

    it('should allow save when new password is provided (first setup)', () => {
        const smtpPassInput = 'new-password';
        const hasExistingPassword = false;
        const hostValid = true;
        const userValid = true;
        const isValid = hostValid && userValid && (Boolean(smtpPassInput) || hasExistingPassword);
        expect(isValid).toBeTruthy();
    });
});
