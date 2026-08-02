import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Artificial names, emails, ids and links only.
const fs = vi.hoisted(() => ({
    memberships: [],
    users: {},
    goals: {},
    company: { appSlug: 'artificial-co' },
    setDoc: vi.fn(),
    unsubscribe: vi.fn(),
    where: vi.fn((...a) => ({ __where: a })),
    collection: vi.fn((_db, name) => name),
}));
const fn = vi.hoisted(() => ({ deleteFn: vi.fn(), showSuccess: vi.fn(), showError: vi.fn() }));

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
        const user = /^users\/(.+)$/.exec(ref);
        if (user) {
            const u = fs.users[user[1]];
            return u ? { exists: () => true, data: () => u } : { exists: () => false };
        }
        const goal = /^companies\/company-1\/team\/(.+)$/.exec(ref);
        if (goal) {
            const g = fs.goals[goal[1]];
            return g ? { exists: () => true, data: () => g } : { exists: () => false };
        }
        return { exists: () => false };
    },
    onSnapshot: (_q, cb) => {
        cb({ docs: fs.memberships.map((m) => ({ data: () => m })) });
        return fs.unsubscribe;
    },
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => fn.deleteFn }));
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

beforeEach(() => {
    fs.memberships = [
        { userId: 'u1', role: 'hr_user' },
        { userId: 'u2', role: 'company_admin' },
    ];
    fs.users = {
        u1: { name: 'Artificial One', email: 'one@example.test' },
        u2: { name: 'Artificial Two', email: 'two@example.test' },
    };
    fs.goals = { u1: { callGoal: 200, contactGoal: 80 } };
    fs.company = { appSlug: 'artificial-co' };
    fs.setDoc.mockReset().mockResolvedValue();
    fs.unsubscribe.mockReset();
    fs.where.mockClear();
    fs.collection.mockClear();
    fn.deleteFn.mockReset().mockResolvedValue({ data: { success: true } });
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

    it('applies user and goal fallbacks (Unknown / defaults)', async () => {
        fs.memberships = [{ userId: 'u3', role: 'hr_user' }];
        fs.users = {};
        fs.goals = {};
        await renderModalUnknown();

        function renderModalUnknown() {
            renderModal();
            return screen.findByText('Unknown');
        }
        expect(screen.getByText('No Email')).toBeInTheDocument();
        expect(screen.getByRole('spinbutton', { name: /Daily dial goal for Unknown/i })).toHaveValue(150);
        expect(screen.getByRole('spinbutton', { name: /Daily contact goal for Unknown/i })).toHaveValue(50);
    });

    it('shows stored goal values with member-specific labels', async () => {
        await renderLoaded();
        expect(screen.getByRole('spinbutton', { name: 'Daily dial goal for Artificial One' })).toHaveValue(200);
        expect(screen.getByRole('spinbutton', { name: 'Daily contact goal for Artificial One' })).toHaveValue(80);
    });

    it('renders the empty state when there are no memberships', async () => {
        fs.memberships = [];
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
