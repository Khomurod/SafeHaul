// All credentials below are artificial, non-production test values only.
//
// =====================================================================
// Shared harness for the UserProfilePage suites.
//
// `vi.mock` is hoisted per file, so each suite keeps its own registrations,
// whose factories delegate to the `*Mock()` functions below. This module must
// not import `UserProfilePage` or any module the suites mock — the page
// transitively imports the mocked firebase modules, and loading either here
// fires a mock factory that is itself awaiting this module, which deadlocks
// vitest silently (learned on `CA-3`). Each suite imports the page itself and
// passes it to `makeRenderPage`.
// =====================================================================

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

export const CURRENT_EMAIL = 'current@example.test';
export const CURRENT_PASSWORD = 'artificial-current-pw';
export const NEW_PASSWORD = 'artificial-new-pw';
export const AUTH_PHOTO = 'https://cdn.example.test/user-1/auth.png';
export const FS_PHOTO = 'https://cdn.example.test/user-1/firestore.png';
export const DOWNLOAD_URL = 'https://cdn.example.test/user-1/uploaded.png';

export const dataMock = { value: {} };
export const toastMocks = { showSuccess: vi.fn(), showError: vi.fn() };
export const userServiceMocks = { getPortalUser: vi.fn() };
export const authFns = {
    updateProfile: vi.fn(),
    updatePassword: vi.fn(),
    updateEmail: vi.fn(),
    reauthenticateWithCredential: vi.fn(),
    credential: vi.fn((email, password) => ({ email, password })),
};
export const fsMocks = { updateDoc: vi.fn(), getDocs: vi.fn() };
export const storageMocks = { uploadBytes: vi.fn(), getDownloadURL: vi.fn() };
export const firebaseMock = {
    auth: { currentUser: { uid: 'user-1' } },
    storage: {},
    db: {},
};

// --- vi.mock factory bodies, verbatim from the original registrations ------

export const dataContextMock = () => ({ useData: () => dataMock.value });
export const toastProviderMock = () => ({ useToast: () => toastMocks });
export const userServiceMock = () => ({
    getPortalUser: userServiceMocks.getPortalUser,
});
export const libFirebaseMock = () => firebaseMock;
export const firebaseAuthMock = () => ({
    updateProfile: authFns.updateProfile,
    updatePassword: authFns.updatePassword,
    updateEmail: authFns.updateEmail,
    reauthenticateWithCredential: authFns.reauthenticateWithCredential,
    EmailAuthProvider: { credential: authFns.credential },
});
export const firebaseFirestoreMock = () => ({
    doc: vi.fn((_db, ...segments) => segments.join('/')),
    updateDoc: fsMocks.updateDoc,
    collection: vi.fn((_db, name) => ({ collection: name })),
    query: vi.fn((ref, ...constraints) => ({ ref, constraints })),
    where: vi.fn((field, op, value) => ({ field, op, value })),
    getDocs: fsMocks.getDocs,
});
export const firebaseStorageMock = () => ({
    ref: vi.fn((_storage, path) => path),
    uploadBytes: storageMocks.uploadBytes,
    getDownloadURL: storageMocks.getDownloadURL,
});

// --- fixtures and helpers, verbatim ----------------------------------------

export const currentUser = {
    uid: 'user-1',
    email: CURRENT_EMAIL,
    displayName: 'Old Name',
    photoURL: AUTH_PHOTO,
};

export function snapshot(ids = ['user-1']) {
    return { docs: ids.map((id) => ({ id })) };
}


/**
 * The original `renderPage`, verbatim, except the page arrives as an
 * argument: each suite imports it after its own hoisted mocks.
 */
export const makeRenderPage = (UserProfilePage) => () => render(<UserProfilePage />);

/**
 * Waits until the async Firestore profile load has flushed into the form.
 *
 * The Display Name textbox mounts before `getPortalUser` resolves, so waiting on
 * the control alone let a Save click fire against pre-hydration state — a race
 * that only surfaced under CI load. Every test that acts on loaded values waits
 * on the values themselves.
 */
export async function hydrated() {
    const name = await screen.findByRole('textbox', { name: 'Display Name' });
    await waitFor(() => {
        expect(name).toHaveValue('Firestore Name');
        expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('fsuser');
    });
    return name;
}

export async function fillPassword({ current = CURRENT_PASSWORD, next = NEW_PASSWORD, confirm = NEW_PASSWORD } = {}) {
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: current } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: confirm } });
}

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
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
}
