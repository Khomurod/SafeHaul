import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserWouldAsk, renderWithLeaveGuard } from './leaveGuard.support';

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

const companyMocks = vi.hoisted(() => ({ saveCompanySettings: vi.fn(), getDoc: vi.fn() }));

vi.mock('firebase/functions', () => ({
    // Dispatch by callable name so tests can assert the exact callable used.
    httpsCallable: (_functions, name) => callableMocks[name],
}));
vi.mock('@lib/firebase', () => ({ functions: {}, db: {} }));
// The verification copies are read from the company document when the page opens.
vi.mock('firebase/firestore', () => ({ doc: (_db, ...parts) => parts.join('/'), getDoc: (...args) => companyMocks.getDoc(...args) }));
vi.mock('@features/companies', () => ({ saveCompanySettings: companyMocks.saveCompanySettings }));
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

/** A callable failure as the web SDK reports it: `functions/<code>` and the server's message. */
const callableFailure = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });

const host = () => screen.getByRole('textbox', { name: /SMTP Host/i });
const user = () => screen.getByRole('textbox', { name: /SMTP Username/i });
const port = () => screen.getByRole('spinbutton', { name: /SMTP Port/i });
const password = () => screen.getByLabelText(/SMTP Password/i);
const signature = () => screen.getByRole('textbox', { name: /Default Signature/i });
const copies = () => screen.getByRole('textbox', { name: /CC addresses/i });
const testButton = () => screen.getByRole('button', { name: 'Test Connection' });
const saveBar = () => screen.queryByRole('region', { name: 'Unsaved changes' });
const barButton = (name) => within(saveBar()).getByRole('button', { name });

async function renderLoaded(props = {}) {
    const result = render(<EmailSettingsTab currentCompanyProfile={COMPANY} {...props} />);
    await screen.findByRole('textbox', { name: /SMTP Host/i });
    return result;
}

beforeEach(() => {
    // Every test starts from the same defaults, with no queued answer left over.
    vi.resetAllMocks();
    callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse());
    callableMocks.saveEmailSettings.mockResolvedValue({ data: { success: true } });
    companyMocks.getDoc.mockResolvedValue({ exists: () => false });
    companyMocks.saveCompanySettings.mockResolvedValue({});
});

describe('EmailSettingsTab — metadata load', () => {
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
        // Nothing is changed yet, so there is nothing to save.
        expect(saveBar()).toBeNull();
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
        expect(password()).not.toBeRequired();
    });

    it('reflects hasPassword=false as a required first-time password', async () => {
        await renderLoaded();
        expect(password()).toHaveAccessibleDescription(/App Password/i);
        expect(password()).toBeRequired();
    });

    it('shows the verified connection banner only when verified with a user', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ isVerified: true }));
        await renderLoaded();
        expect(screen.getByText('Successfully Linked')).toBeInTheDocument();
        expect(screen.getByText('ops@acme.com')).toBeInTheDocument();
        // The names it sends are bold text, not Markdown asterisks.
        const uses = screen.getByText(/is automatically being used to safely send/);
        expect(uses).toHaveTextContent('send E-Docs and Previous Employment Verification (PEV) forms.');
        expect(uses.querySelectorAll('strong')).toHaveLength(2);
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

describe('EmailSettingsTab — one save bar', () => {
    it('shows no save bar until something changes, then names what changed', async () => {
        await renderLoaded();
        expect(saveBar()).toBeNull();
        // The page's old buttons are gone: the bar is its one way to save.
        expect(screen.queryByRole('button', { name: /save/i })).toBeNull();

        fireEvent.change(host(), { target: { value: 'smtp.office365.com' } });
        expect(saveBar()).toHaveTextContent('1 change · SMTP Host');

        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        fireEvent.change(copies(), { target: { value: 'safety@acme.com' } });
        expect(saveBar()).toHaveTextContent('3 changes · SMTP Host, SMTP Password, Verification copies');
        // The bar names the password field, never what was typed into it.
        expect(saveBar()).not.toHaveTextContent(FAKE_PASSWORD);
        expect(screen.getAllByRole('button', { name: /save/i })).toHaveLength(1);

        // Typed back to what is saved: only what still differs is named.
        fireEvent.change(host(), { target: { value: 'smtp.gmail.com' } });
        expect(saveBar()).toHaveTextContent('2 changes · SMTP Password, Verification copies');
    });

    it('treats an emptied port as the 587 it shows', async () => {
        await renderLoaded();
        fireEvent.change(port(), { target: { value: '' } });
        expect(port()).toHaveValue(587);
        expect(saveBar()).toBeNull();
    });

    it('refuses to save without SMTP Host and Username, and says so', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        await renderLoaded();
        fireEvent.change(host(), { target: { value: '' } });

        fireEvent.click(barButton('Save'));

        expect(within(saveBar()).getByRole('alert')).toHaveTextContent('Please fill in SMTP Host and Username.');
        fireEvent.change(host(), { target: { value: 'smtp.gmail.com' } });
        fireEvent.change(user(), { target: { value: '' } });
        fireEvent.click(barButton('Save'));
        expect(within(saveBar()).getByRole('alert')).toHaveTextContent('Please fill in SMTP Host and Username.');
        expect(callableMocks.saveEmailSettings).not.toHaveBeenCalled();
    });

    it('requires a password for first-time setup', async () => {
        await renderLoaded();
        fireEvent.change(signature(), { target: { value: 'Thanks' } });

        fireEvent.click(barButton('Save'));
        expect(within(saveBar()).getByRole('alert')).toHaveTextContent('Please enter your SMTP password.');
        expect(callableMocks.saveEmailSettings).not.toHaveBeenCalled();

        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        fireEvent.click(barButton('Save'));
        await waitFor(() => expect(saveBar()).toBeNull());
        expect(callableMocks.saveEmailSettings.mock.calls[0][0].smtpPass).toBe(FAKE_PASSWORD);
    });

    it('saves without sending smtpPass when a password already exists', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        await renderLoaded();
        fireEvent.change(signature(), { target: { value: 'Thanks, Ops' } });

        fireEvent.click(barButton('Save'));

        await waitFor(() => expect(saveBar()).toBeNull());
        expect(callableMocks.saveEmailSettings).toHaveBeenCalledOnce();
        const payload = callableMocks.saveEmailSettings.mock.calls[0][0];
        expect(payload).toEqual({
            companyId: 'company-1',
            smtpHost: 'smtp.gmail.com',
            smtpPort: 587,
            smtpUser: 'ops@acme.com',
            signature: 'Thanks, Ops',
        });
        expect(payload).not.toHaveProperty('smtpPass');
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('Email settings saved securely!');
        // Only the server settings changed, so the company document is not written.
        expect(companyMocks.saveCompanySettings).not.toHaveBeenCalled();
    });

    it('includes smtpPass only when the user enters a new password, then empties the field', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        await renderLoaded();

        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        fireEvent.click(barButton('Save'));

        await waitFor(() => expect(saveBar()).toBeNull());
        const payload = callableMocks.saveEmailSettings.mock.calls[0][0];
        expect(payload.smtpPass).toBe(FAKE_PASSWORD);
        expect(payload).toMatchObject({
            companyId: 'company-1',
            smtpHost: 'smtp.gmail.com',
            smtpPort: 587,
            smtpUser: 'ops@acme.com',
            signature: 'Best regards',
        });
        // Saved: the field goes back to saying a password is kept, and holds nothing.
        expect(password()).toHaveValue('');
        expect(password()).toHaveAttribute('placeholder', 'Password is saved but hidden. Enter new to rotate.');
    });

    it('keeps the edits and the bar, with a plain message, when saving fails', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        // A server that never answered: the web SDK reports only the code.
        const failure = callableFailure('internal', 'internal');
        callableMocks.saveEmailSettings.mockRejectedValueOnce(failure);
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();
        fireEvent.change(host(), { target: { value: 'smtp.office365.com' } });

        fireEvent.click(barButton('Save'));

        const alert = await within(saveBar()).findByRole('alert');
        expect(alert).toHaveTextContent('Could not save the email settings. Try again.');
        expect(alert).not.toHaveTextContent(/internal/i);
        expect(err).toHaveBeenCalledWith(expect.any(String), failure);
        expect(host()).toHaveValue('smtp.office365.com');
        expect(barButton('Save')).toBeEnabled();
        expect(toastMocks.showSuccess).not.toHaveBeenCalled();
        err.mockRestore();
    });

    it("passes on the server's own sentence when it refused the save", async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        callableMocks.saveEmailSettings.mockRejectedValueOnce(
            callableFailure('resource-exhausted', 'Too many save requests. Please wait a moment.'),
        );
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();
        fireEvent.change(signature(), { target: { value: 'Thanks' } });

        fireEvent.click(barButton('Save'));

        expect(await within(saveBar()).findByRole('alert')).toHaveTextContent('Too many save requests. Please wait a moment.');
        err.mockRestore();
    });

    it('never logs the password, whatever fails', async () => {
        const logged = [
            vi.spyOn(console, 'error').mockImplementation(() => {}),
            vi.spyOn(console, 'warn').mockImplementation(() => {}),
            vi.spyOn(console, 'log').mockImplementation(() => {}),
        ];
        callableMocks.saveEmailSettings.mockRejectedValue(callableFailure('internal', 'internal'));
        callableMocks.testEmailConnection.mockRejectedValueOnce(callableFailure('internal', 'internal'));
        await renderLoaded();
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });

        fireEvent.click(barButton('Save'));
        await within(saveBar()).findByRole('alert');
        fireEvent.click(testButton());
        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalled());

        const everything = logged.flatMap((spy) => spy.mock.calls.flat()).map((value) => (
            value instanceof Error ? `${value.message} ${JSON.stringify(value)}` : JSON.stringify(value)
        )).join('\n');
        expect(everything).not.toContain(FAKE_PASSWORD);
        logged.forEach((spy) => spy.mockRestore());
    });

    // The server checks the connection on every save, and "Successfully Linked" follows its answer.
    it('shows Successfully Linked after a save only when the server connected', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        callableMocks.saveEmailSettings.mockResolvedValue({ data: { success: true, verified: true } });
        await renderLoaded();
        expect(screen.queryByText('Successfully Linked')).not.toBeInTheDocument();
        fireEvent.change(signature(), { target: { value: 'Thanks' } });

        fireEvent.click(barButton('Save'));

        expect(await screen.findByText('Successfully Linked')).toBeInTheDocument();
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('Email settings saved securely!');
    });

    it('says the save could not connect, and why, instead of Successfully Linked', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true, isVerified: true }));
        callableMocks.saveEmailSettings.mockResolvedValue({
            data: { success: true, verified: false, verificationError: 'Authentication failed. Please check your email and password.' },
        });
        await renderLoaded();
        expect(screen.getByText('Successfully Linked')).toBeInTheDocument();
        fireEvent.change(signature(), { target: { value: 'Thanks' } });

        fireEvent.click(barButton('Save'));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Settings saved, but the server could not connect with them: Authentication failed. Please check your email and password.',
        );
        // The settings were saved, so nothing is left to save.
        expect(saveBar()).toBeNull();
        expect(screen.queryByText('Successfully Linked')).not.toBeInTheDocument();
        expect(toastMocks.showSuccess).not.toHaveBeenCalled();
        expect(toastMocks.showError).toHaveBeenCalledWith('Settings saved, but the connection could not be verified.');
    });

    it('shows Save busy and holds Discard while saving', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        let resolveSave;
        callableMocks.saveEmailSettings.mockImplementation(() => new Promise((resolve) => {
            resolveSave = resolve;
        }));
        await renderLoaded();
        fireEvent.change(signature(), { target: { value: 'Thanks' } });

        fireEvent.click(barButton('Save'));

        await waitFor(() => expect(barButton('Save')).toHaveAttribute('aria-busy', 'true'));
        expect(barButton('Save')).toBeDisabled();
        expect(barButton('Discard')).toBeDisabled();
        await act(async () => resolveSave({ data: { success: true } }));
        await waitFor(() => expect(saveBar()).toBeNull());
    });

    it('puts every field back on Discard, the password emptied', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true, isVerified: true }));
        companyMocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ pevCcEmails: ['safety@acme.com'] }) });
        await renderLoaded();
        await waitFor(() => expect(copies()).toHaveValue('safety@acme.com'));

        fireEvent.change(host(), { target: { value: 'smtp.office365.com' } });
        fireEvent.change(port(), { target: { value: '465' } });
        fireEvent.change(user(), { target: { value: 'ops@acme.net' } });
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        fireEvent.change(signature(), { target: { value: 'Thanks' } });
        fireEvent.change(copies(), { target: { value: 'hr@acme.com' } });
        // A changed connection is not the one the server connected with.
        expect(screen.getByText('Not Connected / Unverified')).toBeInTheDocument();
        expect(saveBar()).toHaveTextContent('6 changes');

        fireEvent.click(barButton('Discard'));

        expect(saveBar()).toBeNull();
        expect(host()).toHaveValue('smtp.gmail.com');
        expect(port()).toHaveValue(587);
        expect(user()).toHaveValue('ops@acme.com');
        expect(password()).toHaveValue('');
        expect(signature()).toHaveValue('Best regards');
        expect(copies()).toHaveValue('safety@acme.com');
        expect(screen.getByText('Successfully Linked')).toBeInTheDocument();
        expect(callableMocks.saveEmailSettings).not.toHaveBeenCalled();
        expect(companyMocks.saveCompanySettings).not.toHaveBeenCalled();
    });

    it('asks before a move leaves unsaved settings, and lets a clean page go', async () => {
        const { leave } = renderWithLeaveGuard(<EmailSettingsTab currentCompanyProfile={COMPANY} />);
        await screen.findByRole('textbox', { name: /SMTP Host/i });

        expect(browserWouldAsk()).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Leave this page' }));
        expect(leave).toHaveBeenCalledTimes(1);

        fireEvent.change(copies(), { target: { value: 'safety@acme.com' } });
        expect(browserWouldAsk()).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Leave this page' }));
        const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(leave).toHaveBeenCalledTimes(1);
        expect(copies()).toHaveValue('safety@acme.com');

        fireEvent.click(screen.getByRole('button', { name: 'Leave this page' }));
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Leave without saving?' }))
            .getByRole('button', { name: 'Discard changes' }));
        expect(leave).toHaveBeenCalledTimes(2);
    });
});

describe('EmailSettingsTab — verification copies in the one Save', () => {
    it('saves only the copies when only they changed', async () => {
        await renderLoaded();
        fireEvent.change(copies(), { target: { value: 'Safety@Acme.com; hr@acme.com' } });

        fireEvent.click(barButton('Save'));

        await waitFor(() => expect(saveBar()).toBeNull());
        expect(companyMocks.saveCompanySettings).toHaveBeenCalledWith('company-1', {
            pevCcEmails: ['safety@acme.com', 'hr@acme.com'],
        });
        // The server settings were not changed, so they are not saved (or re-checked).
        expect(callableMocks.saveEmailSettings).not.toHaveBeenCalled();
        expect(copies()).toHaveValue('safety@acme.com, hr@acme.com');
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('Verification copies saved.');
    });

    it('saves the server settings and the copies with the same Save', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        await renderLoaded();
        fireEvent.change(signature(), { target: { value: 'Thanks' } });
        fireEvent.change(copies(), { target: { value: 'safety@acme.com' } });

        fireEvent.click(barButton('Save'));

        await waitFor(() => expect(saveBar()).toBeNull());
        expect(callableMocks.saveEmailSettings).toHaveBeenCalledOnce();
        expect(companyMocks.saveCompanySettings).toHaveBeenCalledWith('company-1', { pevCcEmails: ['safety@acme.com'] });
    });

    it('saves nothing while a CC address is not one, and says which', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        await renderLoaded();
        fireEvent.change(signature(), { target: { value: 'Thanks' } });
        fireEvent.change(copies(), { target: { value: 'ops@acme.com, nope' } });

        fireEvent.click(barButton('Save'));

        expect(copies()).toHaveAccessibleDescription(expect.stringContaining('"nope" is not a valid email address.'));
        expect(within(saveBar()).getByRole('alert')).toHaveTextContent('Check the CC addresses, then save again.');
        expect(callableMocks.saveEmailSettings).not.toHaveBeenCalled();
        expect(companyMocks.saveCompanySettings).not.toHaveBeenCalled();
    });

    it('keeps only the part that failed in the bar, with a plain message', async () => {
        callableMocks.getEmailSettingsMeta.mockResolvedValue(metaResponse({ hasPassword: true }));
        const failure = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        companyMocks.saveCompanySettings.mockRejectedValueOnce(failure);
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();
        fireEvent.change(signature(), { target: { value: 'Thanks' } });
        fireEvent.change(copies(), { target: { value: 'safety@acme.com' } });

        fireEvent.click(barButton('Save'));

        await waitFor(() => expect(saveBar()).toHaveTextContent('1 change · Verification copies'));
        const alert = within(saveBar()).getByRole('alert');
        expect(alert).toHaveTextContent('Could not save the verification copies. Try again.');
        expect(alert).not.toHaveTextContent(/permission/i);
        expect(err).toHaveBeenCalledWith(expect.any(String), failure);
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('Email settings saved securely!');
        expect(copies()).toHaveValue('safety@acme.com');
        err.mockRestore();
    });
});

describe('EmailSettingsTab — test connection', () => {
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

    it('auto-saves with the plaintext password on a successful test, marks verified and clears the bar', async () => {
        callableMocks.testEmailConnection.mockResolvedValue({ data: { success: true } });
        await renderLoaded();
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        expect(saveBar()).toHaveTextContent('1 change · SMTP Password');
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
        // Verified banner + saved-password indicator update; the test's save left nothing unsaved.
        expect(screen.getByText('Successfully Linked')).toBeInTheDocument();
        expect(password()).toHaveValue('');
        expect(password()).toHaveAttribute(
            'placeholder',
            'Password is saved but hidden. Enter new to rotate.',
        );
        expect(saveBar()).toBeNull();
    });

    // Test Connection checks what is typed, so it works with unsaved changes;
    // its save covers the server settings, and other edits wait for Save.
    it('tests what is typed while other unsaved edits wait in the bar', async () => {
        callableMocks.testEmailConnection.mockResolvedValue({ data: { success: true } });
        await renderLoaded();
        fireEvent.change(copies(), { target: { value: 'safety@acme.com' } });
        fireEvent.change(host(), { target: { value: 'smtp.office365.com' } });
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });

        fireEvent.click(testButton());

        await waitFor(() => expect(saveBar()).toHaveTextContent('1 change · Verification copies'));
        expect(callableMocks.testEmailConnection.mock.calls[0][0].smtpHost).toBe('smtp.office365.com');
        expect(companyMocks.saveCompanySettings).not.toHaveBeenCalled();
    });

    it('holds Test Connection while Save is writing the same settings', async () => {
        let resolveSave;
        callableMocks.saveEmailSettings.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
        await renderLoaded();
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        expect(testButton()).toBeEnabled();

        fireEvent.click(barButton('Save'));

        await waitFor(() => expect(testButton()).toBeDisabled());
        await act(async () => resolveSave({ data: { success: true } }));
        await waitFor(() => expect(saveBar()).toBeNull());
        expect(callableMocks.testEmailConnection).not.toHaveBeenCalled();
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
        // Nothing was saved, so the typed password still waits in the bar.
        expect(saveBar()).toHaveTextContent('1 change · SMTP Password');
    });

    it('handles a thrown test-callable exception with a plain message', async () => {
        const failure = callableFailure('internal', 'internal');
        callableMocks.testEmailConnection.mockRejectedValueOnce(failure);
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        fireEvent.click(testButton());

        await waitFor(() => {
            expect(toastMocks.showError)
                .toHaveBeenCalledWith('Connection test failed. Please check your credentials.');
        });
        expect(screen.getByRole('alert')).toHaveTextContent('The connection could not be tested. Try again.');
        expect(err).toHaveBeenCalledWith(expect.any(String), failure);
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
        // Not saved: the banner does not claim a link, and the change still waits in the bar.
        expect(screen.queryByText('Successfully Linked')).not.toBeInTheDocument();
        expect(saveBar()).toBeInTheDocument();
        err.mockRestore();
    });
});

describe('EmailSettingsTab — presentation and accessibility', () => {
    it("gives Test Connection and the bar's Save distinct accessible names", async () => {
        await renderLoaded();
        fireEvent.change(password(), { target: { value: FAKE_PASSWORD } });
        expect(testButton()).toBeInTheDocument();
        expect(barButton('Save')).toBeInTheDocument();
        expect(barButton('Discard')).toBeInTheDocument();
    });

    it('exposes the setup guide toggle expanded state and safe external links', async () => {
        await renderLoaded();
        const toggle = screen.getByRole('button', { name: /How to Set Up SMTP/i });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Gmail / Google Workspace')).toBeInTheDocument();

        /*
         * `Link external`, not a hand-written `target="_blank"`. The
         * announcement is the whole reason the primitive exists — target plus rel
         * written by hand gets the new tab and the tabnabbing fix and silently
         * drops the WCAG 3.2.5 announcement — so the assertion requires it rather
         * than just the attributes.
         */
        const link = screen.getByRole('link', { name: /^Google Account/ });
        expect(link).toHaveAccessibleName('Google Account (opens in a new tab)');
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

    it('has no accessibility violations with unsaved edits and a refused save', async () => {
        const { container } = await renderLoaded();
        fireEvent.change(signature(), { target: { value: 'Thanks' } });
        fireEvent.click(barButton('Save'));
        expect(within(saveBar()).getByRole('alert')).toBeInTheDocument();
        expect((await axe(container)).violations).toEqual([]);
    });
});
