// UserProfilePage contract, part 1 of 2: the initial load and hydration
// order, the personal link, the avatar upload path, and the profile save.
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
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/auth', async () => (await import('./UserProfilePage.support')).firebaseAuthMock());
vi.mock('firebase/firestore', async () => (await import('./UserProfilePage.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./UserProfilePage.support')).firebaseStorageMock());
// The card has its own suite (`PersonalLinkCard.test.jsx`); here, what it is given.
vi.mock('@features/company-admin/components/profile/PersonalLinkCard', () => ({
    PersonalLinkCard: ({ currentUser, currentCompanyProfile }) => (
        <section aria-label="Your personal link">
            {`Link for ${currentUser?.uid} at ${currentCompanyProfile?.id}`}
        </section>
    ),
}));

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
    dataMock,
    currentUser,
    CURRENT_EMAIL,
    AUTH_PHOTO,
    FS_PHOTO,
    DOWNLOAD_URL,
} from './UserProfilePage.support';

const renderPage = makeRenderPage(UserProfilePage);

beforeEach(resetHarness);

describe('UserProfilePage — initial load', () => {
    it('prefers Firestore name/photo and initializes the email edit value', async () => {
        renderPage();

        // Wait for the async getPortalUser state update to flush before asserting
        // the loaded value (findByRole alone can resolve on the initial empty render).
        await waitFor(() => {
            expect(screen.getByRole('textbox', { name: 'Display Name' })).toHaveValue('Firestore Name');
        });
        // No Username field: nothing read it. A stored one is neither shown nor written.
        expect(screen.queryByRole('textbox', { name: 'Username' })).toBeNull();
        expect(screen.queryByDisplayValue('fsuser')).toBeNull();
        expect(screen.getByRole('img', { name: 'Profile photo' })).toHaveAttribute('src', FS_PHOTO);
        expect(screen.getByText(CURRENT_EMAIL)).toBeInTheDocument();
        expect(screen.getByText('Acme Freight')).toBeInTheDocument();
        // The form edits the profile, so it reads it fresh rather than take the
        // copy the top bar keeps for the session.
        expect(userServiceMocks.getPortalUser).toHaveBeenCalledWith('user-1', { fresh: true });
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

describe('UserProfilePage — personal link', () => {
    it("shows every staff member's personal link for the company in use", async () => {
        const company = { id: 'company-1', companyName: 'Acme Freight', appSlug: 'acme' };
        dataMock.value = {
            currentUser,
            currentCompanyProfile: company,
            // A recruiter: the page is the same for every role.
            currentUserClaims: { roles: { 'company-1': 'recruiter' } },
        };
        renderPage();
        await hydrated();

        expect(screen.getByRole('region', { name: 'Your personal link' }))
            .toHaveTextContent('Link for user-1 at company-1');
    });

    it('offers no link while no company is chosen', async () => {
        renderPage();
        await hydrated();

        expect(screen.queryByRole('region', { name: 'Your personal link' })).toBeNull();
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
        // The session's copy of the profile is forgotten once the write lands.
        expect(userServiceMocks.forgetPortalUser).toHaveBeenCalledWith('user-1');
        expect(fsMocks.updateDoc.mock.invocationCallOrder[0])
            .toBeLessThan(userServiceMocks.forgetPortalUser.mock.invocationCallOrder[0]);

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

    it('saves only the name, the field every screen reads, and forgets the kept copy', async () => {
        renderPage();
        await hydrated();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => {
            expect(toastMocks.showSuccess).toHaveBeenCalledWith('Profile updated successfully!');
        });
        // Exactly `users/{uid}.name`, as Settings → My profile wrote it; a stored
        // `username` is left as it is.
        expect(fsMocks.updateDoc).toHaveBeenCalledTimes(1);
        expect(fsMocks.updateDoc).toHaveBeenCalledWith('users/user-1', { name: 'Firestore Name' });
        // Display name changed from Auth "Old Name", so Auth is updated.
        expect(authFns.updateProfile).toHaveBeenCalledWith(firebaseMock.auth.currentUser, {
            displayName: 'Firestore Name',
        });
        // The next screen to show the name (the top bar after a reload, the
        // dashboard greeting) reads it again, once the write has landed.
        expect(userServiceMocks.forgetPortalUser).toHaveBeenCalledWith('user-1');
        expect(fsMocks.updateDoc.mock.invocationCallOrder[0])
            .toBeLessThan(userServiceMocks.forgetPortalUser.mock.invocationCallOrder[0]);
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


describe('UserProfilePage unsaved name', () => {
    it('asks before leaving with a changed name, and stops asking once it is saved', async () => {
        const { renderWithLeaveGuard, browserWouldAsk } = await import('@features/settings/components/leaveGuard.support');
        const { leave } = renderWithLeaveGuard(<UserProfilePage />);
        await hydrated();
        expect(browserWouldAsk()).toBe(false);

        fireEvent.change(screen.getByRole('textbox', { name: 'Display Name' }), { target: { value: 'Typed Name' } });
        expect(browserWouldAsk()).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Leave this page' }));
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        expect(leave).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /keep editing/i }));

        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Profile updated successfully!'));
        expect(browserWouldAsk()).toBe(false);
    });
});
