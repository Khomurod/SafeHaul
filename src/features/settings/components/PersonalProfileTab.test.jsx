import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserWouldAsk, renderWithLeaveGuard } from './leaveGuard.support';

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
    doc: (_db, ...segments) => segments.join('/'),
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

const saveBar = () => screen.queryByRole('region', { name: 'Unsaved changes' });
const barButton = (name) => within(saveBar()).getByRole('button', { name });

describe('PersonalProfileTab compatibility slice', () => {
    beforeEach(() => {
        // Every test starts from the same defaults, with no queued answer left over.
        vi.resetAllMocks();
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
        fireEvent.click(barButton('Save'));

        await waitFor(() => expect(saveBar()).toBeNull());
        expect(firestoreMocks.updateDoc).toHaveBeenCalledWith(
            'users/user-1',
            { name: 'Updated Admin' },
        );
        expect(toastMocks.showSuccess)
            .toHaveBeenCalledWith('Personal profile updated successfully.');
        // The top bar's copy of the profile is forgotten, so the new name shows.
        expect(forgetPortalUser).toHaveBeenCalledWith('user-1');
        expect(name).toHaveValue('Updated Admin');
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

    it('offers no link to copy, and no spinner, when no one is signed in', async () => {
        render(<PersonalProfileTab currentUser={null} currentCompanyProfile={currentCompanyProfile} />);

        expect(await screen.findByText('Sign in again to see your link.')).toBeInTheDocument();
        expect(screen.queryByText('Generating unique code...')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
        expect(screen.queryByText(/recruiter=/)).toBeNull();
        expect(firestoreMocks.getDoc).not.toHaveBeenCalled();
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

});

describe('PersonalProfileTab save bar', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        firestoreMocks.getDoc.mockResolvedValue(existingUser());
        firestoreMocks.links = { 'recruiter_links/ABC123': { userId: 'user-1', companyId: 'company-1' } };
        firestoreMocks.setDoc.mockResolvedValue();
        firestoreMocks.updateDoc.mockResolvedValue();
    });

    const renderTab = () => render(
        <PersonalProfileTab currentUser={currentUser} currentCompanyProfile={currentCompanyProfile} />,
    );

    it('shows no save bar until the name changes, then names it', async () => {
        renderTab();
        const name = await screen.findByRole('textbox', { name: 'Full Name' });
        expect(saveBar()).toBeNull();
        // No Save of its own: the bar is the page's one way to save.
        expect(screen.queryByRole('button', { name: /update profile|save/i })).toBeNull();

        fireEvent.change(name, { target: { value: 'Updated Admin' } });
        expect(saveBar()).toHaveTextContent('1 change · Full Name');

        // Typed back to what is saved: nothing left to save.
        fireEvent.change(name, { target: { value: 'Admin User' } });
        expect(saveBar()).toBeNull();
    });

    it('puts the saved name back on Discard', async () => {
        renderTab();
        const name = await screen.findByRole('textbox', { name: 'Full Name' });
        fireEvent.change(name, { target: { value: 'Typo Admin' } });

        fireEvent.click(barButton('Discard'));

        expect(saveBar()).toBeNull();
        expect(name).toHaveValue('Admin User');
        expect(firestoreMocks.updateDoc).not.toHaveBeenCalledWith('users/user-1', expect.objectContaining({ name: expect.anything() }));
    });

    it('shows Save busy and holds Discard while saving', async () => {
        let resolveSave;
        firestoreMocks.updateDoc.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
        renderTab();
        fireEvent.change(await screen.findByRole('textbox', { name: 'Full Name' }), { target: { value: 'Updated Admin' } });

        fireEvent.click(barButton('Save'));

        await waitFor(() => expect(barButton('Save')).toHaveAttribute('aria-busy', 'true'));
        expect(barButton('Discard')).toBeDisabled();
        await act(async () => resolveSave());
        await waitFor(() => expect(saveBar()).toBeNull());
    });

    it('keeps the edit and the bar, with a plain message, when saving fails', async () => {
        const failure = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        firestoreMocks.updateDoc.mockRejectedValueOnce(failure);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderTab();
        const name = await screen.findByRole('textbox', { name: 'Full Name' });
        fireEvent.change(name, { target: { value: 'Updated Admin' } });

        fireEvent.click(barButton('Save'));

        const alert = await within(saveBar()).findByRole('alert');
        expect(alert).toHaveTextContent('Your profile could not be saved.');
        // The database's own words stay in the console, for whoever investigates.
        expect(alert).not.toHaveTextContent(/insufficient permissions/i);
        expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
        expect(name).toHaveValue('Updated Admin');
        expect(barButton('Save')).toBeEnabled();
        expect(forgetPortalUser).not.toHaveBeenCalled();
        expect(toastMocks.showSuccess).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it('asks before a move leaves an unsaved name, and lets a clean page go', async () => {
        const { leave } = renderWithLeaveGuard(
            <PersonalProfileTab currentUser={currentUser} currentCompanyProfile={currentCompanyProfile} />,
        );
        const name = await screen.findByRole('textbox', { name: 'Full Name' });

        expect(browserWouldAsk()).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Leave this page' }));
        expect(leave).toHaveBeenCalledTimes(1);

        fireEvent.change(name, { target: { value: 'Unsaved Admin' } });
        expect(browserWouldAsk()).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Leave this page' }));
        const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(leave).toHaveBeenCalledTimes(1);
        expect(name).toHaveValue('Unsaved Admin');

        fireEvent.click(screen.getByRole('button', { name: 'Leave this page' }));
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Leave without saving?' }))
            .getByRole('button', { name: 'Discard changes' }));
        expect(leave).toHaveBeenCalledTimes(2);
    });

    it('has no accessibility violations with an unsaved name', async () => {
        const { container } = renderTab();
        fireEvent.change(await screen.findByRole('textbox', { name: 'Full Name' }), { target: { value: 'Unsaved Admin' } });
        // The link is still being made: let it settle before the scan.
        await screen.findByRole('button', { name: 'Copy' });
        expect((await axe(container)).violations).toEqual([]);
    });
});
