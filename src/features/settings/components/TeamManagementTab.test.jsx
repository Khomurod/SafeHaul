import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Artificial names, emails, ids and links only.
const fs = vi.hoisted(() => ({
    goals: {},
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
    createFn: vi.fn(),
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
        const goal = /^companies\/company-1\/team\/(.+)$/.exec(ref);
        const g = goal && fs.goals[goal[1]];
        return g ? { exists: () => true, data: () => g } : { exists: () => false };
    },
    onSnapshot: (_q, cb, onError) => {
        fs.snapshotHandlers.push({ cb, onError });
        cb({ docs: [] });
        return fs.unsubscribe;
    },
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => ({
        listCompanyTeam: fn.listTeamFn, deletePortalUser: fn.deleteFn, createPortalUser: fn.createFn,
    })[name],
}));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => ({ showSuccess: fn.showSuccess, showError: fn.showError }) }));

import { TeamManagementTab } from './TeamManagementTab';

const company = { id: 'company-1', appSlug: 'artificial-co' };

function renderTab({ isCompanyAdmin = true, profile = company, currentUserId = 'me' } = {}) {
    return render(<TeamManagementTab currentCompanyProfile={profile} currentUserId={currentUserId} isCompanyAdmin={isCompanyAdmin} />);
}

/** Waits for a member's own row control, which exists only once the roster has loaded. */
const findRow = async (name) => (await screen.findByRole('button', { name: `Daily goals for ${name}` })).closest('tr');

async function renderLoaded(opts) {
    const utils = renderTab(opts);
    await findRow('Artificial One');
    return utils;
}

/** A resolved member row exactly as `listCompanyTeam` returns it. */
const member = (over = {}) => ({
    id: 'u1', name: 'Artificial One', email: 'one@example.test', role: 'hr_user',
    status: 'active', profileMissing: false, repaired: false,
    duplicateMembershipCount: 0, membershipIds: ['m1'], ...over,
});

const respondWith = (members, invalidMemberships = []) => {
    fn.listTeamFn.mockResolvedValue({ data: { companyId: 'company-1', members, invalidMemberships, repairedCount: 0 } });
};

beforeEach(() => {
    fs.goals = { u1: { callGoal: 200, contactGoal: 80 } };
    fs.snapshotHandlers = [];
    fs.setDoc.mockReset().mockResolvedValue();
    fs.unsubscribe.mockReset();
    fs.where.mockClear();
    fs.collection.mockClear();
    fn.deleteFn.mockReset().mockResolvedValue({ data: { success: true } });
    fn.createFn.mockReset().mockResolvedValue({ data: { success: true } });
    fn.listTeamFn.mockReset();
    respondWith([
        member(),
        member({ id: 'u2', name: 'Artificial Two', email: 'two@example.test', role: 'company_admin', membershipIds: ['m2'] }),
    ]);
    fn.showSuccess.mockReset();
    fn.showError.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue() },
    });
});
afterEach(() => {
    vi.unstubAllEnvs();
});

describe('TeamManagementTab — the page', () => {
    it('denies non-admins without loading the team', () => {
        renderTab({ isCompanyAdmin: false });
        expect(screen.getByText('Access Denied. Only Admins can manage the team.')).toBeInTheDocument();
        expect(fn.listTeamFn).not.toHaveBeenCalled();
    });

    it('names the page Team, with the head count once loaded', async () => {
        await renderLoaded();
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Team');
        // The number shows; its word is read with it.
        expect(screen.getAllByRole('status').find((el) => el.textContent === '2 people')).toBeTruthy();
    });

    it('lists members from listCompanyTeam for the company, watching its memberships', async () => {
        await renderLoaded();
        expect(fn.listTeamFn).toHaveBeenCalledWith({ companyId: 'company-1' });
        expect(fs.collection).toHaveBeenCalledWith(expect.anything(), 'memberships');
        expect(fs.where).toHaveBeenCalledWith('companyId', '==', 'company-1');
        const table = screen.getByRole('table', { name: 'Team' });
        expect(within(table).getByRole('rowheader', { name: /^Artificial One/ })).toHaveTextContent('one@example.test');
        expect(within(await findRow('Artificial Two')).getByText('Company admin')).toBeInTheDocument();
        expect(within(await findRow('Artificial One')).getByText('Recruiter')).toBeInTheDocument();
    });

    it('shows stored goals, and the defaults where none are stored', async () => {
        await renderLoaded();
        expect(await findRow('Artificial One')).toHaveTextContent('Goals: 200 dials, 80 contacts');
        expect(await findRow('Artificial Two')).toHaveTextContent('Goals: 150 dials, 50 contacts');
    });

    it('marks the signed-in admin and offers no Remove on their own row', async () => {
        await renderLoaded({ currentUserId: 'u2' });
        expect(screen.getByText('Artificial Two (you)')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove Artificial Two from the team' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Remove Artificial One from the team' })).toBeInTheDocument();
    });

    it('re-resolves the roster when memberships change', async () => {
        await renderLoaded();
        expect(fn.listTeamFn).toHaveBeenCalledTimes(1);

        respondWith([member({ id: 'u3', name: 'Artificial Three', email: 'three@example.test' })]);
        fs.snapshotHandlers[0].cb({ docs: [] });

        await findRow('Artificial Three');
        expect(screen.queryByText('Artificial One')).toBeNull();
    });

    it('still shows the team when the membership listener is denied', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();
        fs.snapshotHandlers[0].onError(new Error('permission-denied'));
        expect(screen.queryByRole('alert')).toBeNull();
        expect(await findRow('Artificial One')).toBeInTheDocument();
        consoleError.mockRestore();
    });

    it('unsubscribes from the membership snapshot on unmount', async () => {
        const { unmount } = await renderLoaded();
        unmount();
        expect(fs.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('offers Add person from the empty table when there is nobody', async () => {
        respondWith([]);
        renderTab();
        expect(await screen.findByText('No members found.')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Add person' })).toHaveLength(2);
    });

    it('opens Add person in a dialog and reloads the team after adding', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
        const dialog = screen.getByRole('dialog', { name: 'Add person' });
        fireEvent.change(within(dialog).getByRole('textbox', { name: /Full Name/i }), { target: { value: 'Artificial Three' } });
        fireEvent.change(within(dialog).getByRole('textbox', { name: /Email/i }), { target: { value: 'three@example.test' } });
        fireEvent.change(within(dialog).getByLabelText(/Password/i), { target: { value: 'NOT_A_REAL_PASSWORD_1' } });
        fireEvent.click(within(dialog).getByRole('button', { name: /^Add person/ }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(fn.listTeamFn).toHaveBeenCalledTimes(2);
    });
});

describe('TeamManagementTab — never invents an Unknown member', () => {
    it('shows the real name and email of a member whose profile had to be recovered', async () => {
        respondWith([member({ id: 'u9', name: 'Recovered Person', email: 'recovered@example.test', profileMissing: true, repaired: true })]);
        renderTab();
        const row = await findRow('Recovered Person');
        expect(row).toHaveTextContent('recovered@example.test');
        expect(within(row).getByText('Active')).toBeInTheDocument();
        expect(screen.queryByText('Unknown')).toBeNull();
    });

    it('labels a member who has an email but no name with the email, not repeated under itself', async () => {
        respondWith([member({ id: 'u9', name: null, email: 'noname@example.test' })]);
        renderTab();
        const row = await findRow('noname@example.test');
        expect(within(row).getAllByText('noname@example.test')).toHaveLength(1);
        expect(screen.queryByText('No email on file')).toBeNull();
    });

    it('marks a membership whose sign-in account is gone, and keeps it removable', async () => {
        respondWith([member({ id: 'ghost', name: 'Gone Gray', email: 'gone@example.test', status: 'auth_missing' })]);
        renderTab();
        const row = await findRow('Gone Gray');
        expect(within(row).getByText('No sign-in account')).toBeInTheDocument();
        expect(within(row).getByText(/points to an account that no longer exists/i)).toBeInTheDocument();
        expect(within(row).getByRole('button', { name: 'Remove Gone Gray from the team' })).toBeEnabled();
    });

    it('states plainly when a record has no identity anywhere', async () => {
        respondWith([member({ id: 'u9', name: null, email: null, status: 'unidentified' })]);
        renderTab();
        const row = await findRow('Unnamed member');
        expect(row).toHaveTextContent('No email on file');
        expect(within(row).getByText('No name or email')).toBeInTheDocument();
    });

    it('flags an unreadable profile distinctly from a missing account', async () => {
        respondWith([member({ id: 'u9', name: 'Locked Lee', status: 'unreadable' })]);
        renderTab();
        const row = await findRow('Locked Lee');
        expect(within(row).getByText('Profile unreadable')).toBeInTheDocument();
        expect(within(row).queryByText('No sign-in account')).toBeNull();
    });

    it('flags duplicated membership documents on the single collapsed row', async () => {
        respondWith([member({ duplicateMembershipCount: 1, membershipIds: ['m1', 'm1b'] })]);
        renderTab();
        const row = await findRow('Artificial One');
        expect(within(row).getByText('Duplicate membership')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /^Daily goals for/ })).toHaveLength(1);
    });

    it('reports membership records that have no user attached, singular and plural', async () => {
        respondWith([member()], [{ membershipId: 'm-broken', role: 'recruiter' }]);
        const { unmount } = renderTab();
        expect(await screen.findByText(/1 membership record has no user attached/i)).toBeInTheDocument();
        unmount();

        respondWith([], [{ membershipId: 'm-a', role: null }, { membershipId: 'm-b', role: null }]);
        renderTab();
        expect(await screen.findByText(/2 membership records have no user attached/i)).toBeInTheDocument();
    });

    it('shows an error with a retry instead of a fabricated roster when the lookup fails', async () => {
        fn.listTeamFn.mockRejectedValue(new Error('permission-denied'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderTab();

        expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load your team. Try again.");
        expect(screen.queryByText('No members found.')).toBeNull();
        expect(screen.queryAllByRole('status').some((el) => /people/.test(el.textContent))).toBe(false);

        respondWith([member()]);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await findRow('Artificial One');
        consoleError.mockRestore();
    });
});

describe('TeamManagementTab — row actions', () => {
    it('copies the exact recruiting link (env base, trailing slash trimmed) and toasts', async () => {
        vi.stubEnv('VITE_DRIVER_APP_URL', 'https://drive.example.test/');
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Copy recruiting link for Artificial One' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://drive.example.test/apply/artificial-co?recruiter=u1');
        expect(fn.showSuccess).toHaveBeenCalledWith('Custom recruiter link copied!');
    });

    it('falls back to window origin and the company id when there is no slug', async () => {
        vi.stubEnv('VITE_DRIVER_APP_URL', '');
        await renderLoaded({ profile: { id: 'company-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy recruiting link for Artificial One' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/apply/company-1?recruiter=u1`);
    });

    it('still toasts success even when the clipboard write rejects', async () => {
        navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Copy recruiting link for Artificial One' }));
        expect(fn.showSuccess).toHaveBeenCalledWith('Custom recruiter link copied!');
    });

    it('saves daily goals with the exact path, numeric payload and merge, and shows them', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Daily goals for Artificial One' }));
        const dialog = screen.getByRole('dialog', { name: 'Daily goals · Artificial One' });
        expect(within(dialog).getByRole('spinbutton', { name: /Dials/ })).toHaveValue(200);
        fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Dials/ }), { target: { value: '250' } });
        fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Contacts/ }), { target: { value: '80' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(fs.setDoc).toHaveBeenCalledWith(
            'companies/company-1/team/u1',
            { callGoal: 250, contactGoal: 80, updatedAt: expect.any(Date) },
            { merge: true },
        );
        expect(await findRow('Artificial One')).toHaveTextContent('Goals: 250 dials, 80 contacts');
    });

    it('keeps the goals dialog open with the exact message when saving fails', async () => {
        fs.setDoc.mockRejectedValue(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Daily goals for Artificial One' }));
        const dialog = screen.getByRole('dialog', { name: 'Daily goals · Artificial One' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        expect(await within(dialog).findByText('Error saving goal')).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Daily goals · Artificial One' })).toBeInTheDocument();
        consoleError.mockRestore();
    });

    it('confirms before removing with the exact question, and Cancel removes nobody', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Artificial One from the team' }));
        const confirm = screen.getByRole('dialog', { name: 'Remove team member' });
        expect(confirm).toHaveTextContent('Are you sure you want to remove Artificial One from the team?');
        fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(fn.deleteFn).not.toHaveBeenCalled();
    });

    it('removes a member with the exact deletePortalUser request and toasts', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Artificial One from the team' }));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove team member' })).getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(fn.showSuccess).toHaveBeenCalledWith('Artificial One has been removed from the team.'));
        expect(fn.deleteFn).toHaveBeenCalledWith({ userId: 'u1', companyId: 'company-1' });
    });

    it('surfaces a remove failure and keeps other rows operable', async () => {
        fn.deleteFn.mockRejectedValue(new Error('claims sync failed'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Artificial One from the team' }));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove team member' })).getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(fn.showError).toHaveBeenCalledWith('Failed to remove user: claims sync failed'));
        expect(screen.getByRole('button', { name: 'Remove Artificial Two from the team' })).toBeEnabled();
        consoleError.mockRestore();
    });

    it('shows row-specific remove loading', async () => {
        let resolveDelete;
        fn.deleteFn.mockImplementation(() => new Promise((resolve) => { resolveDelete = resolve; }));
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Artificial One from the team' }));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove team member' })).getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Artificial One from the team' })).toBeDisabled());
        expect(screen.getByRole('button', { name: 'Remove Artificial Two from the team' })).toBeEnabled();
        resolveDelete({ data: {} });
        await waitFor(() => expect(fn.showSuccess).toHaveBeenCalled());
    });
});

describe('TeamManagementTab — accessibility', () => {
    it('has no violations on the loaded page', async () => {
        const { container } = await renderLoaded();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('becomes one card per member on a phone, every value labelled', async () => {
        await renderLoaded();
        const table = screen.getByRole('table', { name: 'Team' });
        expect(table.closest('[data-mobile-presentation]')).toHaveAttribute('data-mobile-presentation', 'cards');
        const cells = within(await findRow('Artificial One')).getAllByRole('cell');
        expect(cells.map((cell) => cell.getAttribute('data-label') ?? '')).toEqual(['Role', 'Status', '']);
    });
});
