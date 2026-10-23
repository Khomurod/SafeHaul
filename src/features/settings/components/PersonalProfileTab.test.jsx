import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    // recruiter_links/{code} → the link stored there, if any.
    links: {},
}));

const toastMocks = vi.hoisted(() => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
}));

const forgetPortalUser = vi.hoisted(() => vi.fn());

const linkSnapshot = (path) => {
    const link = firestoreMocks.links[path];
    return { exists: () => Boolean(link), data: () => link };
};

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, ...segments) => segments.join('/')),
    getDoc: (path) => (path.startsWith('recruiter_links/') ? Promise.resolve(linkSnapshot(path)) : firestoreMocks.getDoc(path)),
    updateDoc: firestoreMocks.updateDoc,
    // A transaction reads the link store and commits its writes through
    // `setDoc`, so a test sees each link created (or refused) like any write.
    runTransaction: async (_db, run) => {
        const writes = [];
        await run({ get: async (path) => linkSnapshot(path), set: (path, data) => writes.push([path, data]) });
        for (const [path, data] of writes) await firestoreMocks.setDoc(path, data);
    },
}));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('@features/auth/services/userService', () => ({ forgetPortalUser }));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => toastMocks,
}));

import { PersonalProfileTab } from './PersonalProfileTab';

const currentUser = {
    uid: 'user-1',
    email: 'admin@example.com',
};

const currentCompanyProfile = {
    id: 'company-1',
    appSlug: 'safehaul-logistics',
};

function existingUser(data = {}) {
    return {
        exists: () => true,
        data: () => ({
            name: 'Admin User',
            recruitingCode: 'ABC123',
            ...data,
        }),
    };
}

describe('PersonalProfileTab compatibility slice', () => {
    beforeEach(() => {
        firestoreMocks.getDoc.mockReset();
        firestoreMocks.setDoc.mockReset();
        firestoreMocks.updateDoc.mockReset();
        forgetPortalUser.mockReset();
        toastMocks.showError.mockReset();
        toastMocks.showSuccess.mockReset();
        firestoreMocks.getDoc.mockResolvedValue(existingUser());
        firestoreMocks.links = { 'recruiter_links/ABC123': { userId: 'user-1', companyId: 'company-1' } };
        firestoreMocks.setDoc.mockResolvedValue();
        firestoreMocks.updateDoc.mockResolvedValue();

        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn().mockResolvedValue() },
        });
    });

    it('loads existing values and exposes labelled, accessible controls', async () => {
        const { container } = render(
            <PersonalProfileTab
                currentUser={currentUser}
                currentCompanyProfile={currentCompanyProfile}
            />,
        );

        expect(screen.getByRole('status')).toHaveTextContent(
            'Generating unique code...',
        );
        expect(await screen.findByRole('textbox', { name: 'Full Name' }))
            .toHaveValue('Admin User');

        const email = screen.getByRole('textbox', { name: 'Email' });
        expect(email).toHaveValue('admin@example.com');
        expect(email).toHaveAttribute('readonly');
        expect(email).toHaveAccessibleDescription('Email cannot be changed directly.');
        expect(screen.getByRole('region', { name: 'Profile details' }))
            .toBeInTheDocument();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('preserves the existing name-only Firestore save contract and feedback', async () => {
        render(
            <PersonalProfileTab
                currentUser={currentUser}
                currentCompanyProfile={currentCompanyProfile}
            />,
        );

        const name = await screen.findByRole('textbox', { name: 'Full Name' });
        fireEvent.change(name, { target: { value: 'Updated Admin' } });
        fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

        await waitFor(() => {
            expect(firestoreMocks.updateDoc).toHaveBeenCalledWith(
                'users/user-1',
                { name: 'Updated Admin' },
            );
        });
        expect(toastMocks.showSuccess)
            .toHaveBeenCalledWith('Personal profile updated successfully.');
        // The top bar's copy of the profile is forgotten, so the new name shows.
        expect(forgetPortalUser).toHaveBeenCalledWith('user-1');
    });

    it('preserves recruiting-link generation and clipboard behavior', async () => {
        firestoreMocks.getDoc.mockResolvedValue(existingUser({
            recruitingCode: undefined,
        }));

        render(
            <PersonalProfileTab
                currentUser={currentUser}
                currentCompanyProfile={currentCompanyProfile}
            />,
        );

        await waitFor(() => expect(firestoreMocks.setDoc).toHaveBeenCalledOnce());
        const [linkReference, linkPayload] = firestoreMocks.setDoc.mock.calls[0];
        const generatedCode = linkReference.replace('recruiter_links/', '');

        expect(linkPayload).toEqual({
            userId: 'user-1',
            companyId: 'company-1',
            createdAt: expect.any(Date),
        });
        expect(firestoreMocks.updateDoc).toHaveBeenCalledWith(
            'users/user-1',
            { recruitingCode: generatedCode },
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            `${window.location.origin}/apply/safehaul-logistics?r=${generatedCode}`,
        );
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Short link copied!'));
        expect(generatedCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    });

    it('draws another code rather than overwrite a link someone already has', async () => {
        firestoreMocks.getDoc.mockResolvedValue(existingUser({ recruitingCode: undefined }));
        const values = vi.spyOn(crypto, 'getRandomValues')
            .mockImplementationOnce((bytes) => bytes.fill(0))
            .mockImplementationOnce((bytes) => bytes.fill(1));
        firestoreMocks.links = { 'recruiter_links/AAAAAAAA': { userId: 'someone-else', companyId: 'company-9' } };

        render(<PersonalProfileTab currentUser={currentUser} currentCompanyProfile={currentCompanyProfile} />);

        // The link shows once both writes are done.
        expect(await screen.findByText(/\/apply\/safehaul-logistics\?r=BBBBBBBB$/)).toBeInTheDocument();
        expect(firestoreMocks.setDoc).toHaveBeenCalledOnce();
        expect(firestoreMocks.setDoc.mock.calls[0][0]).toBe('recruiter_links/BBBBBBBB');
        expect(firestoreMocks.updateDoc).toHaveBeenCalledWith('users/user-1', { recruitingCode: 'BBBBBBBB' });
        values.mockRestore();
    });

    it("makes the user their own link when the saved code's link names someone else", async () => {
        firestoreMocks.links = { 'recruiter_links/ABC123': { userId: 'someone-else', companyId: 'company-1' } };

        render(<PersonalProfileTab currentUser={currentUser} currentCompanyProfile={currentCompanyProfile} />);

        expect(await screen.findByText(/\/apply\/safehaul-logistics\?r=[A-HJ-NP-Z2-9]{8}$/)).toBeInTheDocument();
        const [linkReference, linkPayload] = firestoreMocks.setDoc.mock.calls[0];
        expect(linkReference).not.toBe('recruiter_links/ABC123');
        expect(linkPayload).toEqual(expect.objectContaining({ userId: 'user-1', companyId: 'company-1' }));
    });

    it('asks again for the link when the company changes while the page is open', async () => {
        firestoreMocks.links = {
            'recruiter_links/ABC123': { userId: 'user-1', companyId: 'company-1' },
        };
        const { rerender } = render(
            <PersonalProfileTab currentUser={currentUser} currentCompanyProfile={currentCompanyProfile} />,
        );
        expect(await screen.findByText(/\/apply\/safehaul-logistics\?r=ABC123$/)).toBeInTheDocument();

        rerender(
            <PersonalProfileTab currentUser={currentUser} currentCompanyProfile={{ id: 'company-2', appSlug: 'blue-line' }} />,
        );

        expect(await screen.findByText(/\/apply\/blue-line\?recruiter=user-1$/)).toBeInTheDocument();
        expect(screen.queryByText(/\?r=ABC123$/)).toBeNull();
    });

    it("offers the team-checked ?recruiter= link when the saved code was made for another company", async () => {
        firestoreMocks.links = { 'recruiter_links/ABC123': { userId: 'user-1', companyId: 'company-other' } };

        render(<PersonalProfileTab currentUser={currentUser} currentCompanyProfile={currentCompanyProfile} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            `${window.location.origin}/apply/safehaul-logistics?recruiter=user-1`,
        ));
        expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
        expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
    });

    it('says so when the link could not be copied', async () => {
        navigator.clipboard.writeText.mockRejectedValueOnce(new Error('denied'));

        render(<PersonalProfileTab currentUser={currentUser} currentCompanyProfile={currentCompanyProfile} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
        await waitFor(() => expect(toastMocks.showError)
            .toHaveBeenCalledWith('Could not copy the link. Select it and copy it yourself.'));
        expect(toastMocks.showSuccess).not.toHaveBeenCalledWith('Short link copied!');
    });

    it('preserves the recruiting-link generation error feedback', async () => {
        firestoreMocks.getDoc.mockResolvedValue(existingUser({
            recruitingCode: undefined,
        }));
        firestoreMocks.setDoc.mockRejectedValueOnce(new Error('permission-denied'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <PersonalProfileTab
                currentUser={currentUser}
                currentCompanyProfile={currentCompanyProfile}
            />,
        );

        await waitFor(() => {
            expect(toastMocks.showError)
                .toHaveBeenCalledWith('Could not generate tracking link.');
        });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        consoleError.mockRestore();
    });

    it('preserves the existing save error path and re-enables the action', async () => {
        firestoreMocks.updateDoc.mockRejectedValueOnce(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <PersonalProfileTab
                currentUser={currentUser}
                currentCompanyProfile={currentCompanyProfile}
            />,
        );

        await screen.findByRole('textbox', { name: 'Full Name' });
        fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

        await waitFor(() => {
            expect(toastMocks.showError).toHaveBeenCalledWith('Failed to update profile.');
        });
        expect(screen.getByRole('button', { name: 'Update Profile' })).toBeEnabled();
        consoleError.mockRestore();
    });
});
