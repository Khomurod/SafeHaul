// UserProfilePage contract, part 1 of 2: the initial load and hydration
// order, the avatar upload path, and the profile save.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `UserProfilePage.support.jsx`; the registrations below delegate to it. All
// credentials are artificial, non-production test values only.
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
    toastMocks,
    userServiceMocks,
    authFns,
    fsMocks,
    storageMocks,
    firebaseMock,
    snapshot,
    CURRENT_EMAIL,
    AUTH_PHOTO,
    FS_PHOTO,
    DOWNLOAD_URL,
} from './UserProfilePage.support';

const renderPage = makeRenderPage(UserProfilePage);

beforeEach(resetHarness);

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

