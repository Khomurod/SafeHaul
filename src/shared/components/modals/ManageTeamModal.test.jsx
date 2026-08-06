import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Artificial names, emails, ids and links only.
const fs = vi.hoisted(() => ({
    memberships: [],
    goals: {},
    company: { appSlug: 'artificial-co' },
    setDoc: vi.fn(),
    unsubscribe: vi.fn(),
    where: vi.fn((...a) => ({ __where: a })),
    collection: vi.fn((_db, name) => name),
    /** Captured onSnapshot callbacks so tests can push a later membership change. */
    snapshotHandlers: [],
}));
const fn = vi.hoisted(() => ({
    deleteFn: vi.fn(),
    listTeamFn: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    doc: (_db, ...segs) => segs.join('/'),
    collection: (...a) => fs.collection(...a),
    query: (...a) => ({ __query: a }),
    where: (...a) => fs.where(...a),
    setDoc: (...a) => fs.setDoc(...a),
    getDoc: async (ref) => {
        if (ref === 'companies/company-1') {
            return fs.company ? { exists: () => true, data: () => fs.company } : { exists: () => false };
        }
        const goal = /^companies\/company-1\/team\/(.+)$/.exec(ref);
        if (goal) {
            const g = fs.goals[goal[1]];
            return g ? { exists: () => true, data: () => g } : { exists: () => false };
        }
        return { exists: () => false };
    },
    onSnapshot: (_q, cb, onError) => {
        fs.snapshotHandlers.push({ cb, onError });
        cb({ docs: fs.memberships.map((m) => ({ data: () => m })) });
        return fs.unsubscribe;
    },
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (name === 'listCompanyTeam' ? fn.listTeamFn : fn.deleteFn),
}));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => ({ showSuccess: fn.showSuccess, showError: fn.showError }) }));

import { ManageTeamModal } from './ManageTeamModal';

function renderModal({ onClose = vi.fn() } = {}) {
    return { onClose, ...render(<ManageTeamModal companyId="company-1" onClose={onClose} />) };
}

async function renderLoaded(opts) {
    const utils = renderModal(opts);
    await screen.findByText('Artificial One');
    return utils;
}

/** A resolved member row exactly as `listCompanyTeam` returns it. */
const member = (over = {}) => ({
    id: 'u1', name: 'Artificial One', email: 'one@example.test', role: 'hr_user',
    status: 'active', profileMissing: false, repaired: false,
    duplicateMembershipCount: 0, membershipIds: ['m1'], ...over,
});

/** Make the roster callable return these members (and invalid membership records). */
const respondWith = (members, invalidMemberships = []) => {
    fn.listTeamFn.mockResolvedValue({
        data: { companyId: 'company-1', members, invalidMemberships, repairedCount: 0 },
    });
};

beforeEach(() => {
    fs.memberships = [
        { userId: 'u1', role: 'hr_user' },
        { userId: 'u2', role: 'company_admin' },
    ];
    fs.goals = { u1: { callGoal: 200, contactGoal: 80 } };
    fs.company = { appSlug: 'artificial-co' };
    fs.snapshotHandlers = [];
    fs.setDoc.mockReset().mockResolvedValue();
    fs.unsubscribe.mockReset();
    fs.where.mockClear();
    fs.collection.mockClear();
    fn.deleteFn.mockReset().mockResolvedValue({ data: { success: true } });
    fn.listTeamFn.mockReset();
    respondWith([
        member(),
        member({ id: 'u2', name: 'Artificial Two', email: 'two@example.test', role: 'company_admin', membershipIds: ['m2'] }),
    ]);
    fn.showSuccess.mockReset();
    fn.showError.mockReset();
    // happy-dom does not implement these — provide mockable defaults.
    window.confirm = vi.fn(() => true);
    window.alert = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue() },
    });
});
afterEach(() => {
    vi.unstubAllEnvs();
});

describe('ManageTeamModal', () => {
    it('shows a loading status, queries memberships, and lists members', async () => {
        renderModal();
        expect(screen.getByRole('status')).toHaveTextContent('Loading team');
        await screen.findByText('Artificial One');
        expect(fs.collection).toHaveBeenCalledWith(expect.anything(), 'memberships');
        expect(fs.where).toHaveBeenCalledWith('companyId', '==', 'company-1');
        expect(screen.getByText('Artificial Two')).toBeInTheDocument();
        expect(screen.getByText('one@example.test')).toBeInTheDocument();
    });

    it('resolves identities through listCompanyTeam for the requested company', async () => {
        await renderLoaded();
        expect(fn.listTeamFn).toHaveBeenCalledWith({ companyId: 'company-1' });
    });

    // THE REGRESSION: identity used to be read per-row in the browser, and any
    // failure — missing profile, denied read, a name stored under a different
    // field — was rendered as a normal member called "Unknown / No Email".
    describe('never invents an Unknown member', () => {
        it('shows the real name and email of a member whose profile had to be recovered', async () => {
            respondWith([member({
                id: 'u9', name: 'Recovered Person', email: 'recovered@example.test',
                profileMissing: true, repaired: true,
            })]);
            renderModal();

            expect(await screen.findByText('Recovered Person')).toBeInTheDocument();
            expect(screen.getByText('recovered@example.test')).toBeInTheDocument();
            // A recovered member is a normal member: no scary badge, no placeholder.
            expect(screen.queryByText('Unknown')).toBeNull();
            expect(screen.queryByText('No Email')).toBeNull();
            expect(screen.queryByText('No sign-in account')).toBeNull();
        });

        it('labels a member who has an email but no name with the email, not "Unknown"', async () => {
            respondWith([member({ id: 'u9', name: null, email: 'noname@example.test' })]);
            renderModal();

            // The email becomes the title, and is not repeated underneath itself.
            expect(await screen.findByText('noname@example.test')).toBeInTheDocument();
            expect(screen.queryByText('Unknown')).toBeNull();
            expect(screen.queryByText('No email on file')).toBeNull();
            expect(screen.getByRole('spinbutton', { name: 'Daily dial goal for noname@example.test' }))
                .toHaveValue(150);
        });

        it('marks a membership whose sign-in account is gone instead of showing a person', async () => {
            respondWith([member({
                id: 'ghost', name: 'Gone Gray', email: 'gone@example.test', status: 'auth_missing',
            })]);
            renderModal();

            expect(await screen.findByText('No sign-in account')).toBeInTheDocument();
            expect(screen.getByText(/points to an account that no longer exists/i)).toBeInTheDocument();
            // Still removable — that is the action an admin needs for a stale record.
            expect(screen.getByRole('button', { name: 'Remove Gone Gray from the team' })).toBeEnabled();
        });

        it('states plainly when a record has no identity anywhere', async () => {
            respondWith([member({ id: 'u9', name: null, email: null, status: 'unidentified' })]);
            renderModal();

            expect(await screen.findByText('Unnamed member')).toBeInTheDocument();
            expect(screen.getByText('No email on file')).toBeInTheDocument();
            expect(screen.getByText('No name or email')).toBeInTheDocument();
        });

        it('flags an unreadable profile distinctly from a missing account', async () => {
            respondWith([member({ id: 'u9', name: 'Locked Lee', status: 'unreadable' })]);
            renderModal();

            expect(await screen.findByText('Profile unreadable')).toBeInTheDocument();
            expect(screen.queryByText('No sign-in account')).toBeNull();
        });

        it('flags duplicated membership documents on the single collapsed row', async () => {
            respondWith([member({ duplicateMembershipCount: 1, membershipIds: ['m1', 'm1b'] })]);
            renderModal();

            await screen.findByText('Artificial One');
            expect(screen.getByText('Duplicate membership')).toBeInTheDocument();
            expect(screen.getAllByText('Artificial One')).toHaveLength(1);
        });

        it('reports membership records that have no user attached', async () => {
            respondWith([member()], [{ membershipId: 'm-broken', role: 'recruiter' }]);
            renderModal();

            await screen.findByText('Artificial One');
            expect(screen.getByText(/1 membership record has no user attached/i)).toBeInTheDocument();
        });

        it('pluralises the unattached-membership report', async () => {
            respondWith([], [
                { membershipId: 'm-a', role: null },
                { membershipId: 'm-b', role: null },
            ]);
            renderModal();

            expect(await screen.findByText(/2 membership records have no user attached/i)).toBeInTheDocument();
            // Not "No members found." — there IS data, it is just unusable.
            expect(screen.queryByText('No members found.')).toBeNull();
        });

        it('shows an error instead of a fabricated roster when the lookup fails', async () => {
            fn.listTeamFn.mockRejectedValue(new Error('permission-denied'));
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            renderModal();

            expect(await screen.findByRole('alert'))
                .toHaveTextContent("We couldn't load your team. Please close this window and try again.");
            expect(screen.queryByText('Unknown')).toBeNull();
            expect(screen.queryByText('No members found.')).toBeNull();
            consoleError.mockRestore();
        });

        it('shows an error when the membership listener itself is denied', async () => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            renderModal();
            await screen.findByText('Artificial One');

            fs.snapshotHandlers[0].onError(new Error('permission-denied'));
            expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load your team");
            consoleError.mockRestore();
        });
    });

    it('re-resolves the roster when memberships change', async () => {
        await renderLoaded();
        expect(fn.listTeamFn).toHaveBeenCalledTimes(1);

        respondWith([member({ id: 'u3', name: 'Artificial Three', email: 'three@example.test' })]);
        fs.snapshotHandlers[0].cb({ docs: [{ data: () => ({ userId: 'u3', role: 'recruiter' }) }] });

        expect(await screen.findByText('Artificial Three')).toBeInTheDocument();
        expect(screen.queryByText('Artificial One')).toBeNull();
    });

    it('applies default goals when no goal document exists', async () => {
        fs.goals = {};
        await renderLoaded();
        expect(screen.getByRole('spinbutton', { name: 'Daily dial goal for Artificial One' })).toHaveValue(150);
        expect(screen.getByRole('spinbutton', { name: 'Daily contact goal for Artificial One' })).toHaveValue(50);
    });

    it('shows stored goal values with member-specific labels', async () => {
        await renderLoaded();
        expect(screen.getByRole('spinbutton', { name: 'Daily dial goal for Artificial One' })).toHaveValue(200);
        expect(screen.getByRole('spinbutton', { name: 'Daily contact goal for Artificial One' })).toHaveValue(80);
    });

    it('renders the empty state when there are no memberships', async () => {
        fs.memberships = [];
        respondWith([]);
        renderModal();
        await waitFor(() => expect(screen.getByText('No members found.')).toBeInTheDocument());
    });

    it('unsubscribes from the membership snapshot on unmount', async () => {
        const { unmount } = await renderLoaded();
        unmount();
        expect(fs.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('saves a goal on blur with the exact path, numeric payload, and merge', async () => {
        await renderLoaded();
        const dial = screen.getByRole('spinbutton', { name: 'Daily dial goal for Artificial One' });
        fireEvent.change(dial, { target: { value: '250' } });
        fireEvent.blur(dial);

        await waitFor(() => expect(fs.setDoc).toHaveBeenCalledTimes(1));
        const [ref, payload, opts] = fs.setDoc.mock.calls[0];
        expect(ref).toBe('companies/company-1/team/u1');
        expect(payload.callGoal).toBe(250);
        expect(payload.updatedAt).toBeInstanceOf(Date);
        expect(opts).toEqual({ merge: true });
    });

    it('shows the exact goal-save-failure message inline instead of a blocking alert', async () => {
        fs.setDoc.mockRejectedValueOnce(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();
        const contact = screen.getByRole('spinbutton', { name: 'Daily contact goal for Artificial One' });
        fireEvent.blur(contact);

        expect(await screen.findByRole('alert')).toHaveTextContent('Error saving goal');
        expect(window.alert).not.toHaveBeenCalled();
        expect(contact).toHaveAttribute('aria-invalid', 'true');
        consoleError.mockRestore();
    });

    it('clears the goal-save-failure message once a save succeeds', async () => {
        fs.setDoc.mockRejectedValueOnce(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();
        const contact = screen.getByRole('spinbutton', { name: 'Daily contact goal for Artificial One' });
        fireEvent.blur(contact);
        await screen.findByRole('alert');

        fireEvent.blur(contact);
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
        consoleError.mockRestore();
    });

    it('copies the exact tracking link (env base, trailing slash trimmed) and toasts', async () => {
        vi.stubEnv('VITE_DRIVER_APP_URL', 'https://drive.example.test/');
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Copy tracking link for Artificial One' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://drive.example.test/apply/artificial-co?recruiter=u1');
        expect(fn.showSuccess).toHaveBeenCalledWith('Custom recruiter link copied!');
    });

    it('falls back to window origin and the company id slug when unset', async () => {
        vi.stubEnv('VITE_DRIVER_APP_URL', '');
        fs.company = {};
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Copy tracking link for Artificial One' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            `${window.location.origin}/apply/company-1?recruiter=u1`,
        );
    });

    it('still toasts success even when the clipboard write rejects', async () => {
        navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Copy tracking link for Artificial One' }));
        expect(fn.showSuccess).toHaveBeenCalledWith('Custom recruiter link copied!');
    });

    it('confirms before removing in an accessible dialog with the exact frozen question, not window.confirm', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Artificial One from the team' }));

        expect(window.confirm).not.toHaveBeenCalled();
        const confirmDialog = screen.getByRole('dialog', { name: 'Remove team member' });
        expect(confirmDialog).toHaveTextContent(
            'Are you sure you want to remove Artificial One from the team?',
        );
        expect(fn.deleteFn).not.toHaveBeenCalled();

        fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog', { name: 'Remove team member' })).toBeNull();
        expect(fn.deleteFn).not.toHaveBeenCalled();
    });

    it('closes the confirmation dialog on Escape without deleting', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Artificial One from the team' }));
        const confirmDialog = screen.getByRole('dialog', { name: 'Remove team member' });

        fireEvent.keyDown(confirmDialog, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Remove team member' })).toBeNull();
        expect(fn.deleteFn).not.toHaveBeenCalled();
    });

    it('nests the confirmation dialog inside the team modal, moving focus in and restoring it on close', async () => {
        await renderLoaded();
        const teamDialog = screen.getByRole('dialog', { name: 'Manage Team & Links' });
        const trigger = screen.getByRole('button', { name: 'Remove Artificial One from the team' });
        trigger.focus();

        fireEvent.click(trigger);
        const confirmDialog = screen.getByRole('dialog', { name: 'Remove team member' });

        // Nested: both dialogs are simultaneously present in the DOM.
        expect(teamDialog).toBeInTheDocument();
        expect(teamDialog).toContainElement(confirmDialog);
        // Focus moved into the nested dialog, not left on the trigger behind it.
        expect(confirmDialog.contains(document.activeElement)).toBe(true);

        fireEvent.keyDown(confirmDialog, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Remove team member' })).toBeNull();
        // The outer team dialog survives the nested one closing...
        expect(screen.getByRole('dialog', { name: 'Manage Team & Links' })).toBeInTheDocument();
        // ...and focus returns to the exact control that opened the nested dialog.
        expect(trigger).toHaveFocus();
    });

    it('removes a user with the exact deletePortalUser request and toasts after confirming', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Artificial One from the team' }));
        const confirmDialog = screen.getByRole('dialog', { name: 'Remove team member' });
        fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(fn.deleteFn).toHaveBeenCalledWith({ userId: 'u1', companyId: 'company-1' }));
        expect(fn.showSuccess).toHaveBeenCalledWith('Artificial One has been removed from the team.');
    });

    it('surfaces a delete failure toast and keeps other rows operable', async () => {
        fn.deleteFn.mockRejectedValue(new Error('claims sync failed'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Artificial One from the team' }));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove team member' }))
            .getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(fn.showError).toHaveBeenCalledWith('Failed to remove user: claims sync failed'));
        expect(screen.getByRole('button', { name: 'Remove Artificial Two from the team' })).toBeEnabled();
        consoleError.mockRestore();
    });

    it('shows row-specific delete loading', async () => {
        let resolveDelete;
        fn.deleteFn.mockImplementation(() => new Promise((resolve) => { resolveDelete = resolve; }));
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Artificial One from the team' }));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove team member' }))
            .getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Artificial One from the team' })).toBeDisabled());
        expect(screen.getByRole('button', { name: 'Remove Artificial Two from the team' })).toBeEnabled();
        resolveDelete({ data: {} });
        await waitFor(() => expect(fn.showSuccess).toHaveBeenCalled());
    });

    it('is an accessible dialog named and described by its header, closable by button/Escape/backdrop', async () => {
        const { onClose } = await renderLoaded();
        const dialog = screen.getByRole('dialog', { name: 'Manage Team & Links' });
        expect(dialog).toHaveAccessibleDescription('Set goals and get tracking links for your recruiters.');

        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);

        fireEvent.mouseDown(dialog.parentElement);
        expect(onClose).toHaveBeenCalledTimes(2);

        fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(3);
    });

    it('has no accessibility violations in the loaded modal', async () => {
        const { container } = await renderLoaded();
        expect((await axe(container)).violations).toEqual([]);
    });
});
