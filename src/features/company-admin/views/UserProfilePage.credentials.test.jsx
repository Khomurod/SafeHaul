// UserProfilePage contract, part 2 of 2: the email change, the password
// change, and the sensitive-data / accessibility proofs.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `UserProfilePage.support.jsx`; the registrations below delegate to it. All
// credentials are artificial, non-production test values only.
import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/context/DataContext', async () => (await import('./UserProfilePage.support')).dataContextMock());
vi.mock('@shared/components/feedback/ToastProvider', async () => (await import('./UserProfilePage.support')).toastProviderMock());
vi.mock('@features/auth/services/userService', async () => (await import('./UserProfilePage.support')).userServiceMock());
vi.mock('@lib/firebase', async () => (await import('./UserProfilePage.support')).libFirebaseMock());
vi.mock('firebase/auth', async () => (await import('./UserProfilePage.support')).firebaseAuthMock());
vi.mock('firebase/firestore', async () => (await import('./UserProfilePage.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./UserProfilePage.support')).firebaseStorageMock());

import { UserProfilePage } from './UserProfilePage';
import {
    makeRenderPage,
    resetHarness,
    hydrated,
    fillPassword,
    toastMocks,
    authFns,
    firebaseMock,
    fsMocks,
    storageMocks,
    CURRENT_EMAIL,
    CURRENT_PASSWORD,
    NEW_PASSWORD,
} from './UserProfilePage.support';

const renderPage = makeRenderPage(UserProfilePage);

beforeEach(resetHarness);

describe('UserProfilePage — email change', () => {
    async function openEmailEditor() {
        renderPage();
        await hydrated();
        fireEvent.click(screen.getByRole('button', { name: 'Change Email' }));
        return screen.getByRole('group', { name: 'Change email address' });
    }

    it('requires both a new email and the current password', async () => {
        const editor = await openEmailEditor();
        fireEvent.change(within(editor).getByLabelText('New Email'), { target: { value: '' } });
        fireEvent.click(within(editor).getByRole('button', { name: 'Update Email' }));

        expect(toastMocks.showError).toHaveBeenCalledWith('Please provide new email and current password.');
        expect(authFns.reauthenticateWithCredential).not.toHaveBeenCalled();
    });

    it('cancels silently when the new email equals the current email', async () => {
        const editor = await openEmailEditor();
        fireEvent.change(within(editor).getByLabelText('Current Password'), { target: { value: CURRENT_PASSWORD } });
        // New email field already initialized to the current email.
        fireEvent.click(within(editor).getByRole('button', { name: 'Update Email' }));

        await waitFor(() =>
            expect(screen.queryByRole('group', { name: 'Change email address' })).not.toBeInTheDocument(),
        );
        expect(authFns.reauthenticateWithCredential).not.toHaveBeenCalled();
    });

    it('reauthenticates and updates Auth and Firestore in order', async () => {
        const editor = await openEmailEditor();
        fireEvent.change(within(editor).getByLabelText('New Email'), { target: { value: 'new@example.test' } });
        fireEvent.change(within(editor).getByLabelText('Current Password'), { target: { value: CURRENT_PASSWORD } });
        fireEvent.click(within(editor).getByRole('button', { name: 'Update Email' }));

        await waitFor(() => {
            expect(toastMocks.showSuccess).toHaveBeenCalledWith('Email updated! You may need to sign in again.');
        });
        expect(authFns.credential).toHaveBeenCalledWith(CURRENT_EMAIL, CURRENT_PASSWORD);
        expect(authFns.reauthenticateWithCredential).toHaveBeenCalledWith(
            firebaseMock.auth.currentUser,
            { email: CURRENT_EMAIL, password: CURRENT_PASSWORD },
        );
        expect(authFns.updateEmail).toHaveBeenCalledWith(firebaseMock.auth.currentUser, 'new@example.test');
        expect(fsMocks.updateDoc).toHaveBeenCalledWith('users/user-1', { email: 'new@example.test' });
        expect(authFns.reauthenticateWithCredential.mock.invocationCallOrder[0])
            .toBeLessThan(authFns.updateEmail.mock.invocationCallOrder[0]);
    });

    it.each([
        ['auth/wrong-password', 'Incorrect password.'],
        ['auth/email-already-in-use', 'Email is already in use.'],
        ['auth/requires-recent-login', 'Please sign out and sign in again to change email.'],
        ['auth/other', 'Failed to update email.'],
    ])('maps %s to its message', async (code, message) => {
        const error = new Error('x');
        error.code = code;
        authFns.reauthenticateWithCredential.mockRejectedValueOnce(error);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const editor = await openEmailEditor();
        fireEvent.change(within(editor).getByLabelText('New Email'), { target: { value: 'new@example.test' } });
        fireEvent.change(within(editor).getByLabelText('Current Password'), { target: { value: CURRENT_PASSWORD } });
        fireEvent.click(within(editor).getByRole('button', { name: 'Update Email' }));

        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith(message));
        consoleError.mockRestore();
    });

    it('resets the editor to the current email on cancel', async () => {
        const editor = await openEmailEditor();
        fireEvent.change(within(editor).getByLabelText('New Email'), { target: { value: 'typed@example.test' } });
        fireEvent.change(within(editor).getByLabelText('Current Password'), { target: { value: 'typed-pw' } });
        fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('group', { name: 'Change email address' })).not.toBeInTheDocument();

        // Reopen: the new email is reset to the current email and password cleared.
        fireEvent.click(screen.getByRole('button', { name: 'Change Email' }));
        const reopened = screen.getByRole('group', { name: 'Change email address' });
        expect(within(reopened).getByLabelText('New Email')).toHaveValue(CURRENT_EMAIL);
        expect(within(reopened).getByLabelText('Current Password')).toHaveValue('');
    });
});

describe('UserProfilePage — password change', () => {
    it('requires both current and new password', async () => {
        renderPage();
        await hydrated();
        fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

        expect(toastMocks.showError).toHaveBeenCalledWith(
            'Please fill in both current and new password fields.',
        );
    });

    it('requires the confirmation to match', async () => {
        renderPage();
        await hydrated();
        await fillPassword({ confirm: 'different' });
        fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

        expect(toastMocks.showError).toHaveBeenCalledWith('New passwords do not match.');
    });

    it('requires at least six characters', async () => {
        renderPage();
        await hydrated();
        await fillPassword({ next: 'a1b2', confirm: 'a1b2' });
        fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

        expect(toastMocks.showError).toHaveBeenCalledWith('New password must be at least 6 characters.');
    });

    it('reauthenticates, updates the password, and resets the fields', async () => {
        renderPage();
        await hydrated();
        await fillPassword();
        fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

        await waitFor(() => {
            expect(toastMocks.showSuccess).toHaveBeenCalledWith('Password changed successfully!');
        });
        expect(authFns.credential).toHaveBeenCalledWith(CURRENT_EMAIL, CURRENT_PASSWORD);
        expect(authFns.reauthenticateWithCredential).toHaveBeenCalledWith(
            firebaseMock.auth.currentUser,
            { email: CURRENT_EMAIL, password: CURRENT_PASSWORD },
        );
        expect(authFns.updatePassword).toHaveBeenCalledWith(firebaseMock.auth.currentUser, NEW_PASSWORD);
        expect(authFns.reauthenticateWithCredential.mock.invocationCallOrder[0])
            .toBeLessThan(authFns.updatePassword.mock.invocationCallOrder[0]);

        expect(screen.getByLabelText('Current Password')).toHaveValue('');
        expect(screen.getByLabelText('New Password')).toHaveValue('');
        expect(screen.getByLabelText('Confirm New Password')).toHaveValue('');
    });

    it('maps a wrong current password and a generic failure', async () => {
        const wrong = new Error('x');
        wrong.code = 'auth/wrong-password';
        authFns.reauthenticateWithCredential.mockRejectedValueOnce(wrong);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderPage();
        await hydrated();
        await fillPassword();
        fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
        await waitFor(() =>
            expect(toastMocks.showError).toHaveBeenCalledWith('Current password is incorrect.'),
        );

        toastMocks.showError.mockClear();
        authFns.reauthenticateWithCredential.mockRejectedValueOnce(new Error('offline'));
        await fillPassword();
        fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
        await waitFor(() =>
            expect(toastMocks.showError).toHaveBeenCalledWith('Failed to change password. Please try again.'),
        );
        consoleError.mockRestore();
    });
});

describe('UserProfilePage — sensitive data and accessibility', () => {
    it('never writes passwords to logs, Storage, or Firestore', async () => {
        const consoleSpies = [
            vi.spyOn(console, 'log').mockImplementation(() => {}),
            vi.spyOn(console, 'warn').mockImplementation(() => {}),
            vi.spyOn(console, 'error').mockImplementation(() => {}),
        ];
        renderPage();
        await hydrated();
        await fillPassword();
        fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
        await waitFor(() =>
            expect(toastMocks.showSuccess).toHaveBeenCalledWith('Password changed successfully!'),
        );

        const serializedLogs = consoleSpies
            .flatMap((spy) => spy.mock.calls)
            .map((args) => JSON.stringify(args))
            .join(' ');
        expect(serializedLogs).not.toContain(CURRENT_PASSWORD);
        expect(serializedLogs).not.toContain(NEW_PASSWORD);

        const serializedWrites = JSON.stringify([
            ...fsMocks.updateDoc.mock.calls,
            ...storageMocks.uploadBytes.mock.calls,
        ]);
        expect(serializedWrites).not.toContain(CURRENT_PASSWORD);
        expect(serializedWrites).not.toContain(NEW_PASSWORD);
        consoleSpies.forEach((spy) => spy.mockRestore());
    });

    it('applies correct autocomplete attributes to sensitive fields', async () => {
        renderPage();
        await hydrated();

        expect(screen.getByLabelText('Current Password')).toHaveAttribute('autocomplete', 'current-password');
        expect(screen.getByLabelText('New Password')).toHaveAttribute('autocomplete', 'new-password');
        expect(screen.getByLabelText('Confirm New Password')).toHaveAttribute('autocomplete', 'new-password');

        fireEvent.click(screen.getByRole('button', { name: 'Change Email' }));
        expect(screen.getByLabelText('New Email')).toHaveAttribute('autocomplete', 'email');
        // The email editor's current-password field.
        const editor = screen.getByRole('group', { name: 'Change email address' });
        expect(editor.querySelector('input[type="password"]')).toHaveAttribute('autocomplete', 'current-password');
    });

    it('has no accessibility violations', async () => {
        const { container } = renderPage();
        await hydrated();
        expect((await axe(container)).violations).toEqual([]);
    });
});
