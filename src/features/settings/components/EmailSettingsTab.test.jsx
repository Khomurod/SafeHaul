import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Obviously-artificial credential used only to exercise the payload contract.
// It is not a real secret and must never be treated as one.
const FAKE_PASSWORD = 'NOT_A_REAL_PASSWORD_test_value';

const callableMocks = vi.hoisted(() => ({
    getEmailSettingsMeta: vi.fn(),
    testEmailConnection: vi.fn(),
    saveEmailSettings: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
    // Dispatch by callable name so tests can assert the exact callable used.
    httpsCallable: (_functions, name) => callableMocks[name],
}));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => toastMocks,
}));

import { EmailSettingsTab } from './EmailSettingsTab';

const COMPANY = { id: 'company-1' };

function metaResponse(overrides = {}) {
    return {
        data: {
            success: true,
            settings: {
                smtpHost: 'smtp.gmail.com',
                smtpPort: 587,
                smtpUser: 'ops@acme.com',
                signature: 'Best regards',
                isVerified: false,
                hasPassword: false,
                ...overrides,
            },
        },
    };
}

const host = () => screen.getByRole('textbox', { name: /SMTP Host/i });
const user = () => screen.getByRole('textbox', { name: /SMTP Username/i });
const port = () => screen.getByRole('spinbutton', { name: /SMTP Port/i });
const password = () => screen.getByLabelText(/SMTP Password/i);
const signature = () => screen.getByRole('textbox', { name: /Default Signature/i });
const saveButton = () => screen.getByRole('button', { name: 'Save Settings' });
const testButton = () => screen.getByRole('button', { name: 'Test Connection' });

async function renderLoaded(props = {}) {
    const result = render(<EmailSettingsTab currentCompanyProfile={COMPANY} {...props} />);
    await screen.findByRole('textbox', { name: /SMTP Host/i });
    return result;
}

describe('EmailSettingsTab — metadata load', () => {
    beforeEach(() => {
        callableMocks.getEmailSettingsMeta.mockReset();
        callableMocks.testEmailConnection.mockReset();
        callableMocks.saveEmailSettings.mockReset();
        toastMocks.showError.mockReset();
        toastMocks.showSuccess.mockReset();
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse());
        callableMocks.saveEmailSettings.mockResolvedValue({ data: { success: true } });
    });

    it('loads via getEmailSettingsMeta with the exact company id request', async () => {
        await renderLoaded();
        expect(callableMocks.getEmailSettingsMeta).toHaveBeenCalledWith({ companyId: 'company-1' });
    });

    it('hydrates sanitized fields and leaves the password input empty', async () => {
        await renderLoaded();
        expect(host()).toHaveValue('smtp.gmail.com');
        expect(port()).toHaveValue(587);
        expect(user()).toHaveValue('ops@acme.com');
        expect(signature()).toHaveValue('Best regards');
        // Password is never hydrated from the callable response.
        expect(password()).toHaveValue('');
    });

    it('reflects hasPassword=true as a saved-password state without a required marker', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        await renderLoaded();

        expect(password()).toHaveValue('');
        expect(password()).toHaveAttribute(
            'placeholder',
            'Password is saved but hidden. Enter new to rotate.',
        );
        expect(password()).toHaveAccessibleDescription(/already saved/i);
        // With a saved password, save is allowed even with an empty input.
        expect(saveButton()).toBeEnabled();
    });

    it('reflects hasPassword=false as a required first-time password', async () => {
        await renderLoaded();
        expect(password()).toHaveAccessibleDescription(/App Password/i);
        // No saved password and empty input blocks saving.
        expect(saveButton()).toBeDisabled();
    });

    it('shows the verified connection banner only when verified with a user', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ isVerified: true }));
        await renderLoaded();
        expect(screen.getByText('Successfully Linked')).toBeInTheDocument();
        expect(screen.getByText('ops@acme.com')).toBeInTheDocument();
    });

    it('degrades gracefully when the metadata callable fails', async () => {
        callableMocks.getEmailSettingsMeta.mockRejectedValueOnce(new Error('network'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await renderLoaded();
        // Form is still usable for first-time setup; no crash, no error toast.
        expect(host()).toHaveValue('');
        expect(toastMocks.showError).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('does not call the metadata callable when there is no company id', async () => {
        render(<EmailSettingsTab currentCompanyProfile={{}} />);
        await screen.findByRole('textbox', { name: /SMTP Host/i });
        expect(callableMocks.getEmailSettingsMeta).not.toHaveBeenCalled();
    });
});

describe('EmailSettingsTab — manual save', () => {
    beforeEach(() => {
        callableMocks.getEmailSettingsMeta.mockReset();
        callableMocks.testEmailConnection.mockReset();
        callableMocks.saveEmailSettings.mockReset();
        toastMocks.showError.mockReset();
        toastMocks.showSuccess.mockReset();
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse());
        callableMocks.saveEmailSettings.mockResolvedValue({ data: { success: true } });
    });

    it('blocks saving when the host is empty', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        await renderLoaded();
        fireEvent.change(host(), { target: { value: '' } });
        expect(saveButton()).toBeDisabled();
    });

    it('blocks saving when the username is empty', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        await renderLoaded();
        fireEvent.change(user(), { target: { value: '' } });
        expect(saveButton()).toBeDisabled();
    });

    it('requires a password for first-time setup', async () => {
        await renderLoaded();
        expect(saveButton()).toBeDisabled();
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        expect(saveButton()).toBeEnabled();
    });

    it('saves without sending smtpPass when a password already exists', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        await renderLoaded();

        fireEvent.click(saveButton());

        await waitFor(() => expect(callableMocks.saveEmailSettings).toHaveBeenCalledOnce());
        const payload = callableMocks.saveEmailSettings.mock.calls[0][0];
        expect(payload).toEqual({
            companyId: 'company-1',
            smtpHost: 'smtp.gmail.com',
            smtpPort: 587,
            smtpUser: 'ops@acme.com',
            signature: 'Best regards',
        });
        expect(payload).not.toHaveProperty('smtpPass');
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('Email settings saved securely!');
    });

    it('includes smtpPass only when the user enters a new password', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        await renderLoaded();

        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        fireEvent.click(saveButton());

        await waitFor(() => expect(callableMocks.saveEmailSettings).toHaveBeenCalledOnce());
        const payload = callableMocks.saveEmailSettings.mock.calls[0][0];
        expect(payload.smtpPass).toBe(FAKE_PASSWORD);
        expect(payload).toMatchObject({
            companyId: 'company-1',
            smtpHost: 'smtp.gmail.com',
            smtpPort: 587,
            smtpUser: 'ops@acme.com',
            signature: 'Best regards',
        });
    });

    it('surfaces the save-error message and re-enables the action', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        callableMocks.saveEmailSettings.mockRejectedValueOnce(new Error('offline'));
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();

        fireEvent.click(saveButton());

        await waitFor(() => {
            expect(toastMocks.showError).toHaveBeenCalledWith('Failed to save email settings.');
        });
        expect(saveButton()).toBeEnabled();
        err.mockRestore();
    });

    it('disables the save button with aria-busy while saving', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        let resolveSave;
        callableMocks.saveEmailSettings.mockImplementation(() => new Promise((resolve) => {
            resolveSave = resolve;
        }));
        await renderLoaded();

        fireEvent.click(saveButton());

        await waitFor(() => expect(saveButton()).toBeDisabled());
        expect(saveButton()).toHaveAttribute('aria-busy', 'true');
        resolveSave({ data: { success: true } });
        await waitFor(() => expect(saveButton()).toBeEnabled());
    });
});

describe('EmailSettingsTab — test connection', () => {
    beforeEach(() => {
        callableMocks.getEmailSettingsMeta.mockReset();
        callableMocks.testEmailConnection.mockReset();
        callableMocks.saveEmailSettings.mockReset();
        toastMocks.showError.mockReset();
        toastMocks.showSuccess.mockReset();
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse());
        callableMocks.saveEmailSettings.mockResolvedValue({ data: { success: true } });
    });

    it('disables Test Connection until a password is entered', async () => {
        await renderLoaded();
        expect(testButton()).toBeDisabled();
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        expect(testButton()).toBeEnabled();
    });

    it('tests with the exact callable name and payload including the new password', async () => {
        callableMocks.testEmailConnection.mockResolvedValue({ data: { success: false, error: 'x' } });
        await renderLoaded();
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        fireEvent.click(testButton());

        await waitFor(() => expect(callableMocks.testEmailConnection).toHaveBeenCalledOnce());
        expect(callableMocks.testEmailConnection.mock.calls[0][0]).toEqual({
            smtpHost: 'smtp.gmail.com',
            smtpPort: 587,
            smtpUser: 'ops@acme.com',
            smtpPass: FAKE_PASSWORD,
        });
    });

    it('auto-saves with the plaintext password on a successful test and marks verified', async () => {
        callableMocks.testEmailConnection.mockResolvedValue({ data: { success: true } });
        await renderLoaded();
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        fireEvent.click(testButton());

        await waitFor(() => expect(callableMocks.saveEmailSettings).toHaveBeenCalledOnce());
        expect(callableMocks.saveEmailSettings.mock.calls[0][0]).toEqual({
            companyId: 'company-1',
            smtpHost: 'smtp.gmail.com',
            smtpPort: 587,
            smtpUser: 'ops@acme.com',
            smtpPass: FAKE_PASSWORD,
            signature: 'Best regards',
        });
        expect(await screen.findByRole('status')).toHaveTextContent('Connection Connected & Saved!');
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('✅ Connection successful and settings saved!');
        // Verified banner + saved-password indicator update.
        expect(screen.getByText('Successfully Linked')).toBeInTheDocument();
        expect(password()).toHaveAttribute(
            'placeholder',
            'Password is saved but hidden. Enter new to rotate.',
        );
    });

    it('shows a failure alert when the test reports failure and does not auto-save', async () => {
        callableMocks.testEmailConnection.mockResolvedValue({ data: { success: false, error: 'Auth failed' } });
        await renderLoaded();
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        fireEvent.click(testButton());

        await waitFor(() => {
            expect(toastMocks.showError).toHaveBeenCalledWith('Connection failed: Auth failed');
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Connection Failed');
        expect(callableMocks.saveEmailSettings).not.toHaveBeenCalled();
    });

    it('handles a thrown test-callable exception', async () => {
        callableMocks.testEmailConnection.mockRejectedValueOnce(new Error('boom'));
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        fireEvent.click(testButton());

        await waitFor(() => {
            expect(toastMocks.showError)
                .toHaveBeenCalledWith('Connection test failed. Please check your credentials.');
        });
        expect(screen.getByRole('alert')).toBeInTheDocument();
        err.mockRestore();
    });

    it('reports a verified-but-unsaved failure when the auto-save fails', async () => {
        callableMocks.testEmailConnection.mockResolvedValue({ data: { success: true } });
        callableMocks.saveEmailSettings.mockRejectedValueOnce(new Error('save failed'));
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        fireEvent.click(testButton());

        await waitFor(() => {
            expect(toastMocks.showError).toHaveBeenCalledWith('Verified but failed to save.');
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Verified but failed to save to database.');
        err.mockRestore();
    });
});

describe('EmailSettingsTab — presentation and accessibility', () => {
    beforeEach(() => {
        callableMocks.getEmailSettingsMeta.mockReset();
        callableMocks.testEmailConnection.mockReset();
        callableMocks.saveEmailSettings.mockReset();
        toastMocks.showError.mockReset();
        toastMocks.showSuccess.mockReset();
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse());
        callableMocks.saveEmailSettings.mockResolvedValue({ data: { success: true } });
    });

    it('gives Test and Save distinct accessible names', async () => {
        await renderLoaded();
        expect(testButton()).toBeInTheDocument();
        expect(saveButton()).toBeInTheDocument();
    });

    it('exposes the setup guide toggle expanded state and safe external links', async () => {
        await renderLoaded();
        const toggle = screen.getByRole('button', { name: /How to Set Up SMTP/i });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Gmail / Google Workspace')).toBeInTheDocument();

        const link = screen.getByRole('link', { name: 'Google Account' });
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('associates the password helper text with the password input', async () => {
        await renderLoaded();
        expect(password()).toHaveAccessibleDescription(/App Password/i);
    });

    it('has no structural accessibility violations with the guide expanded', async () => {
        const { container } = await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: /How to Set Up SMTP/i }));
        expect((await axe(container)).violations).toEqual([]);
    });
});
