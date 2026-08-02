import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// All credentials below are artificial, non-production test values only.
const CURRENT_EMAIL = 'current@example.test';
const CURRENT_PASSWORD = 'artificial-current-pw';
const NEW_PASSWORD = 'artificial-new-pw';
const AUTH_PHOTO = 'https://cdn.example.test/user-1/auth.png';
const FS_PHOTO = 'https://cdn.example.test/user-1/firestore.png';
const DOWNLOAD_URL = 'https://cdn.example.test/user-1/uploaded.png';

const dataMock = vi.hoisted(() => ({ value: {} }));
const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const userServiceMocks = vi.hoisted(() => ({ getPortalUser: vi.fn() }));
const authFns = vi.hoisted(() => ({
    updateProfile: vi.fn(),
    updatePassword: vi.fn(),
    updateEmail: vi.fn(),
    reauthenticateWithCredential: vi.fn(),
    credential: vi.fn((email, password) => ({ email, password })),
}));
const fsMocks = vi.hoisted(() => ({ updateDoc: vi.fn(), getDocs: vi.fn() }));
const storageMocks = vi.hoisted(() => ({ uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
const firebaseMock = vi.hoisted(() => ({
    auth: { currentUser: { uid: 'user-1' } },
    storage: {},
    db: {},
}));

vi.mock('@/context/DataContext', () => ({ useData: () => dataMock.value }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@features/auth/services/userService', () => ({
    getPortalUser: userServiceMocks.getPortalUser,
}));
vi.mock('@lib/firebase', () => firebaseMock);
vi.mock('firebase/auth', () => ({
    updateProfile: authFns.updateProfile,
    updatePassword: authFns.updatePassword,
    updateEmail: authFns.updateEmail,
    reauthenticateWithCredential: authFns.reauthenticateWithCredential,
    EmailAuthProvider: { credential: authFns.credential },
}));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, ...segments) => segments.join('/')),
    updateDoc: fsMocks.updateDoc,
    collection: vi.fn((_db, name) => ({ collection: name })),
    query: vi.fn((ref, ...constraints) => ({ ref, constraints })),
    where: vi.fn((field, op, value) => ({ field, op, value })),
    getDocs: fsMocks.getDocs,
}));
vi.mock('firebase/storage', () => ({
    ref: vi.fn((_storage, path) => path),
    uploadBytes: storageMocks.uploadBytes,
    getDownloadURL: storageMocks.getDownloadURL,
}));

import { UserProfilePage } from './UserProfilePage';

const currentUser = {
    uid: 'user-1',
    email: CURRENT_EMAIL,
    displayName: 'Old Name',
    photoURL: AUTH_PHOTO,
};

function snapshot(ids = ['user-1']) {
    return { docs: ids.map((id) => ({ id })) };
}

function renderPage() {
    return render(<UserProfilePage />);
}

/**
 * Waits until the async Firestore profile load has flushed into the form.
 *
 * The Display Name textbox mounts before `getPortalUser` resolves, so waiting on
 * the control alone let a Save click fire against pre-hydration state — a race
 * that only surfaced under CI load. Every test that acts on loaded values waits
 * on the values themselves.
 */
async function hydrated() {
    const name = await screen.findByRole('textbox', { name: 'Display Name' });
    await waitFor(() => {
        expect(name).toHaveValue('Firestore Name');
        expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('fsuser');
    });
    return name;
}

async function fillPassword({ current = CURRENT_PASSWORD, next = NEW_PASSWORD, confirm = NEW_PASSWORD } = {}) {
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: current } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: confirm } });
}

beforeEach(() => {
    // mockReset (not clearAllMocks) so any queued *Once implementation from a
    // prior test cannot leak forward, then re-establish default resolutions.
    firebaseMock.auth.currentUser = { uid: 'user-1' };
    dataMock.value = {
        currentUser,
        currentCompanyProfile: { companyName: 'Acme Freight' },
    };
    toastMocks.showSuccess.mockReset();
    toastMocks.showError.mockReset();
    userServiceMocks.getPortalUser.mockReset().mockResolvedValue({
        name: 'Firestore Name',
        username: 'fsuser',
        photoURL: FS_PHOTO,
    });
    fsMocks.updateDoc.mockReset().mockResolvedValue();
    fsMocks.getDocs.mockReset().mockResolvedValue(snapshot(['user-1']));
    storageMocks.uploadBytes.mockReset().mockResolvedValue();
    storageMocks.getDownloadURL.mockReset().mockResolvedValue(DOWNLOAD_URL);
    authFns.updateProfile.mockReset().mockResolvedValue();
    authFns.updateEmail.mockReset().mockResolvedValue();
    authFns.updatePassword.mockReset().mockResolvedValue();
    authFns.reauthenticateWithCredential.mockReset().mockResolvedValue();
    authFns.credential.mockReset().mockImplementation((email, password) => ({ email, password }));
});

describe('UserProfilePage — initial load', () => {
    it('prefers Firestore name/photo/username and initializes the email edit value', async () => {
        renderPage();

        // Wait for the async getPortalUser state update to flush before asserting
        // the loaded value (findByRole alone can resolve on the initial empty render).
        await waitFor(() => {
            expect(screen.getByRole('textbox', { name: 'Display Name' })).toHaveValue('Firestore Name');
        });
        expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('fsuser');
        expect(screen.getByRole('img', { name: 'Profile photo' })).toHaveAttribute('src', FS_PHOTO);
        expect(screen.getByText(CURRENT_EMAIL)).toBeInTheDocument();
        expect(screen.getByText('Acme Freight')).toBeInTheDocument();
    });

    it('falls back to Auth values when the Firestore document is missing', async () => {
        userServiceMocks.getPortalUser.mockResolvedValue(null);
        renderPage();

        await waitFor(() => {
            expect(screen.getByRole('textbox', { name: 'Display Name' })).toHaveValue('Old Name');
        });
        expect(screen.getByRole('img', { name: 'Profile photo' })).toHaveAttribute('src', AUTH_PHOTO);
    });

    it('prefers Firestore displayName when name is absent and keeps Auth photo', async () => {
        userServiceMocks.getPortalUser.mockResolvedValue({ displayName: 'FS Display', username: '' });
        renderPage();

        await waitFor(() => {
            expect(screen.getByRole('textbox', { name: 'Display Name' })).toHaveValue('FS Display');
        });
        expect(screen.getByRole('img', { name: 'Profile photo' })).toHaveAttribute('src', AUTH_PHOTO);
    });

    it('renders (does not crash) for a photo-backed account with a whitespace-only name', async () => {
        // Regression: initials are computed eagerly as a prop, so a blank name
        // must not throw even though the image branch is what actually renders.
        userServiceMocks.getPortalUser.mockResolvedValue({
            name: '   ',
            username: '',
            photoURL: FS_PHOTO,
        });
        renderPage();

        expect(await screen.findByRole('img', { name: 'Profile photo' })).toHaveAttribute('src', FS_PHOTO);
    });
});

describe('UserProfilePage — avatar upload', () => {
    function selectFile(file) {
        const input = document.querySelector('input[type="file"]');
        fireEvent.change(input, { target: { files: [file] } });
    }

    it('rejects files 2 MB or larger before touching Storage', async () => {
        renderPage();
        await hydrated();

        const big = new File(['x'], 'big.png', { type: 'image/png' });
        Object.defineProperty(big, 'size', { value: 2 * 1024 * 1024 + 1 });
        selectFile(big);

        expect(toastMocks.showError).toHaveBeenCalledWith('Image size must be less than 2MB.');
        expect(storageMocks.uploadBytes).not.toHaveBeenCalled();
    });

    it('rejects non-image files', async () => {
        renderPage();
        await hydrated();

        const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
        selectFile(pdf);

        expect(toastMocks.showError).toHaveBeenCalledWith('File must be an image.');
        expect(storageMocks.uploadBytes).not.toHaveBeenCalled();
    });

    it('uploads to avatars/{uid}/{file.name} and updates Auth then Firestore', async () => {
        const { ref } = await import('firebase/storage');
        renderPage();
        await hydrated();

        const file = new File(['x'], 'me.png', { type: 'image/png' });
        selectFile(file);

        await waitFor(() => {
            expect(toastMocks.showSuccess).toHaveBeenCalledWith('Avatar updated successfully!');
        });

        expect(ref).toHaveBeenCalledWith(firebaseMock.storage, 'avatars/user-1/me.png');
        expect(storageMocks.uploadBytes).toHaveBeenCalledWith('avatars/user-1/me.png', file);
        expect(storageMocks.getDownloadURL).toHaveBeenCalledWith('avatars/user-1/me.png');
        expect(authFns.updateProfile).toHaveBeenCalledWith(firebaseMock.auth.currentUser, { photoURL: DOWNLOAD_URL });
        expect(fsMocks.updateDoc).toHaveBeenCalledWith('users/user-1', { photoURL: DOWNLOAD_URL });

        // Sequence: upload -> download URL -> Auth -> Firestore.
        expect(storageMocks.uploadBytes.mock.invocationCallOrder[0])
            .toBeLessThan(storageMocks.getDownloadURL.mock.invocationCallOrder[0]);
        expect(storageMocks.getDownloadURL.mock.invocationCallOrder[0])
            .toBeLessThan(authFns.updateProfile.mock.invocationCallOrder[0]);
        expect(authFns.updateProfile.mock.invocationCallOrder[0])
            .toBeLessThan(fsMocks.updateDoc.mock.invocationCallOrder[0]);
    });

    it('reports the failure message when upload fails', async () => {
        storageMocks.uploadBytes.mockRejectedValueOnce(new Error('network'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderPage();
        await hydrated();

        selectFile(new File(['x'], 'me.png', { type: 'image/png' }));

        await waitFor(() => {
            expect(toastMocks.showError).toHaveBeenCalledWith('Failed to upload avatar.');
        });
        consoleError.mockRestore();
    });
});

describe('UserProfilePage — profile save', () => {
    it('blocks an empty display name', async () => {
        renderPage();
        const name = await hydrated();
        fireEvent.change(name, { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(toastMocks.showError).toHaveBeenCalledWith('Display name cannot be empty.');
        expect(fsMocks.updateDoc).not.toHaveBeenCalled();
    });

    it('runs the username uniqueness query and saves the exact payload', async () => {
        const { where } = await import('firebase/firestore');
        renderPage();
        await hydrated();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => {
            expect(fsMocks.updateDoc).toHaveBeenCalledWith('users/user-1', {
                name: 'Firestore Name',
                username: 'fsuser',
            });
        });
        expect(where).toHaveBeenCalledWith('username', '==', 'fsuser');
        // Display name changed from Auth "Old Name", so Auth is updated.
        expect(authFns.updateProfile).toHaveBeenCalledWith(firebaseMock.auth.currentUser, {
            displayName: 'Firestore Name',
        });
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('Profile updated successfully!');
    });

    it('rejects a username already used by another account', async () => {
        fsMocks.getDocs.mockResolvedValue(snapshot(['someone-else']));
        renderPage();
        await hydrated();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => {
            expect(toastMocks.showError).toHaveBeenCalledWith(
                'This username is already taken. Please choose a different one.',
            );
        });
        expect(fsMocks.updateDoc).not.toHaveBeenCalled();
    });

    it('skips a permission-denied uniqueness check and still saves', async () => {
        fsMocks.getDocs.mockRejectedValueOnce(new Error('permission-denied'));
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        renderPage();
        await hydrated();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => {
            expect(fsMocks.updateDoc).toHaveBeenCalledWith('users/user-1', {
                name: 'Firestore Name',
                username: 'fsuser',
            });
        });
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('Profile updated successfully!');
        consoleWarn.mockRestore();
    });

    it('does not update Auth display name when it is unchanged', async () => {
        userServiceMocks.getPortalUser.mockResolvedValue({ name: 'Old Name', username: '' });
        renderPage();
        await waitFor(() =>
            expect(screen.getByRole('textbox', { name: 'Display Name' })).toHaveValue('Old Name'),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => {
            expect(fsMocks.updateDoc).toHaveBeenCalledWith('users/user-1', {
                name: 'Old Name',
                username: '',
            });
        });
        expect(authFns.updateProfile).not.toHaveBeenCalled();
    });

    it('reports the save failure message', async () => {
        fsMocks.updateDoc.mockRejectedValueOnce(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderPage();
        await hydrated();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => {
            expect(toastMocks.showError).toHaveBeenCalledWith('Failed to update profile.');
        });
        consoleError.mockRestore();
    });
});

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
