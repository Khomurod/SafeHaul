/**
 * Contract freeze + a11y proof for the two bodies rendered inside the Super Admin
 * Edit User dialog: `EditUserNameForm` and `UserMembershipsManager`.
 *
 * These were missed by the 2026-07-28 Super Admin dialog pass — `EditUserModal`'s
 * shell was migrated while both bodies stayed fully legacy (blocking
 * `window.confirm`/`alert`, `title`-only icon-button names, an unlabelled per-row
 * role select, a 2.56:1 grey, an unnamed scroll region). Migrated 2026-07-28.
 *
 * Frozen here: every service call and argument shape, the callback ordering, the
 * role option sets and their differing labels, the available-company filter, the
 * `'Unknown Company'` fallback, and every user-facing string.
 *
 * All names, emails and ids below are artificial test fixtures.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateUser = vi.hoisted(() => vi.fn());
const sendPasswordResetEmail = vi.hoisted(() => vi.fn());
const deletePortalUser = vi.hoisted(() => vi.fn());
const getMembershipsForUser = vi.hoisted(() => vi.fn());
const addMembership = vi.hoisted(() => vi.fn());
const updateMembershipRole = vi.hoisted(() => vi.fn());
const deleteMembership = vi.hoisted(() => vi.fn());

vi.mock('@features/auth/services/userService', () => ({
    updateUser: (...a) => updateUser(...a),
    getMembershipsForUser: (...a) => getMembershipsForUser(...a),
    addMembership: (...a) => addMembership(...a),
    updateMembershipRole: (...a) => updateMembershipRole(...a),
    deleteMembership: (...a) => deleteMembership(...a),
}));
vi.mock('@lib/firebase', () => ({ auth: { name: 'auth' }, functions: {} }));
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: (...a) => sendPasswordResetEmail(...a) }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (name === 'deletePortalUser' ? deletePortalUser : vi.fn()),
}));

import { EditUserNameForm } from './EditUserNameForm';
import { UserMembershipsManager } from './UserMembershipsManager';

const ALL_COMPANIES = new Map([
    ['co-1', 'Artificial Freight Co'],
    ['co-2', 'Placeholder Logistics'],
    ['co-3', 'Sample Carriers'],
]);

function renderNameForm(props = {}) {
    const onSave = vi.fn();
    const utils = render(
        <EditUserNameForm
            userId="user-1"
            initialName="Test Recruiter"
            email="rec@example.test"
            companyId="co-1"
            onSave={onSave}
            {...props}
        />,
    );
    return { ...utils, onSave };
}

function renderMemberships(props = {}) {
    const onDataUpdate = vi.fn();
    const utils = render(
        <UserMembershipsManager
            userId="user-1"
            allCompaniesMap={ALL_COMPANIES}
            onDataUpdate={onDataUpdate}
            {...props}
        />,
    );
    return { ...utils, onDataUpdate };
}

beforeEach(() => {
    vi.clearAllMocks();
    updateUser.mockResolvedValue(undefined);
    sendPasswordResetEmail.mockResolvedValue(undefined);
    deletePortalUser.mockResolvedValue({ data: { success: true } });
    updateMembershipRole.mockResolvedValue(undefined);
    deleteMembership.mockResolvedValue(undefined);
    addMembership.mockResolvedValue(undefined);
    getMembershipsForUser.mockResolvedValue({
        docs: [{ id: 'mem-1', data: () => ({ companyId: 'co-1', role: 'hr_user' }) }],
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('EditUserNameForm — profile save contract', () => {
    it('saves with the frozen argument order and announces the frozen messages', async () => {
        const { onSave } = renderNameForm();
        fireEvent.change(screen.getByLabelText(/^Full Name/), { target: { value: 'Renamed Recruiter' } });
        fireEvent.change(screen.getByLabelText(/^Email Address/), { target: { value: 'new@example.test' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => expect(updateUser).toHaveBeenCalledWith(
            'user-1',
            { name: 'Renamed Recruiter', email: 'new@example.test' },
            'co-1',
        ));
        expect(await screen.findByText('Profile saved!')).toBeInTheDocument();
        expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('announces a save failure with the frozen "Error: " prefix', async () => {
        updateUser.mockRejectedValueOnce(new Error('permission denied'));
        renderNameForm();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        expect(await screen.findByText('Error: permission denied')).toBeInTheDocument();
    });

    it('falls back to "Unknown error" when the failure has no message', async () => {
        updateUser.mockRejectedValueOnce(new Error(''));
        renderNameForm();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        expect(await screen.findByText('Error: Unknown error')).toBeInTheDocument();
    });

    it('puts the save outcome in a live region, not colour alone', async () => {
        renderNameForm();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        const status = await screen.findByText('Profile saved!');
        expect(status.closest('[role="status"]')).not.toBeNull();
    });
});

describe('EditUserNameForm — password reset (blocking dialogs replaced)', () => {
    it('confirms in an accessible dialog then sends, announcing the frozen text', async () => {
        const confirmSpy = vi.fn(() => true);
        const alertSpy = vi.fn();
        vi.stubGlobal('confirm', confirmSpy);
        vi.stubGlobal('alert', alertSpy);

        renderNameForm();
        fireEvent.click(screen.getByRole('button', { name: /Send Password Reset/ }));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Send password reset email to rec@example.test?')).toBeInTheDocument();
        expect(confirmSpy).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Send reset email' }));

        await waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledWith({ name: 'auth' }, 'rec@example.test'));
        expect(await screen.findByText('Password reset email sent to rec@example.test')).toBeInTheDocument();
        expect(alertSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('does not send when the confirmation is cancelled', () => {
        renderNameForm();
        fireEvent.click(screen.getByRole('button', { name: /Send Password Reset/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
        expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('announces a reset failure with the frozen prefix', async () => {
        sendPasswordResetEmail.mockRejectedValueOnce(new Error('user-not-found'));
        renderNameForm();
        fireEvent.click(screen.getByRole('button', { name: /Send Password Reset/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send reset email' }));
        expect(await screen.findByText('Failed to send reset email: user-not-found')).toBeInTheDocument();
    });

    it('keeps the no-address no-op', async () => {
        renderNameForm({ email: '' });
        fireEvent.click(screen.getByRole('button', { name: /Send Password Reset/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send reset email' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });
});

describe('EditUserNameForm — delete user (destructive)', () => {
    it('confirms in an accessible dialog with the frozen warning, then deletes', async () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);

        const { onSave } = renderNameForm();
        fireEvent.click(screen.getByRole('button', { name: /Delete User/ }));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText(
            'Are you sure you want to delete this user? This action cannot be undone.',
        )).toBeInTheDocument();
        expect(confirmSpy).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }));

        await waitFor(() => expect(deletePortalUser).toHaveBeenCalledWith({ userId: 'user-1', companyId: 'co-1' }));
        expect(await screen.findByText('User deleted/removed successfully.')).toBeInTheDocument();
        expect(onSave).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it('does not delete when the confirmation is cancelled', () => {
        renderNameForm();
        fireEvent.click(screen.getByRole('button', { name: /Delete User/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
        expect(deletePortalUser).not.toHaveBeenCalled();
    });

    it('announces a delete failure with the frozen prefix and does not refresh', async () => {
        deletePortalUser.mockRejectedValueOnce(new Error('nope'));
        const { onSave } = renderNameForm();
        fireEvent.click(screen.getByRole('button', { name: /Delete User/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete user' }));

        expect(await screen.findByText('Failed to delete user: nope')).toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });
});

describe('UserMembershipsManager — listing contract', () => {
    it('loads memberships for the user and names the company', async () => {
        renderMemberships();
        await waitFor(() => expect(getMembershipsForUser).toHaveBeenCalledWith('user-1'));
        expect(await screen.findByText('Artificial Freight Co')).toBeInTheDocument();
        expect(screen.getByText('ID: co-1')).toBeInTheDocument();
    });

    it('keeps the Unknown Company fallback for an unmapped id', async () => {
        getMembershipsForUser.mockResolvedValueOnce({
            docs: [{ id: 'mem-x', data: () => ({ companyId: 'gone', role: 'hr_user' }) }],
        });
        renderMemberships();
        expect(await screen.findByText('Unknown Company')).toBeInTheDocument();
    });

    it('shows the frozen empty state', async () => {
        getMembershipsForUser.mockResolvedValueOnce({ docs: [] });
        renderMemberships();
        expect(await screen.findByText('No active memberships.')).toBeInTheDocument();
        expect(screen.getByText('This user cannot access any company data.')).toBeInTheDocument();
    });

    it('announces a load failure with the frozen message', async () => {
        getMembershipsForUser.mockRejectedValueOnce(new Error('denied'));
        renderMemberships();
        expect(await screen.findByText('Could not load memberships. Check permissions.')).toBeInTheDocument();
    });

    it('offers only companies the user is not already in', async () => {
        renderMemberships();
        const select = await screen.findByLabelText(/^Add to Company/);
        expect([...select.options].map((o) => o.value)).toEqual(['', 'co-2', 'co-3']);
    });

    it('keeps the two differing role vocabularies', async () => {
        renderMemberships();
        await screen.findByText('Artificial Freight Co');

        // Per-row select says "Company Admin".
        const rowSelect = screen.getByLabelText('Role for Artificial Freight Co');
        expect([...rowSelect.options].map((o) => o.textContent)).toEqual(['HR User', 'Company Admin']);

        // Add form says "Admin". Scoped to the add form: the per-row label also
        // starts with "Role", and the required marker makes the label text
        // "Role* required".
        const addForm = screen.getByLabelText(/^Add to Company/).closest('form');
        const addSelect = within(addForm).getByLabelText(/^Role/);
        expect([...addSelect.options].map((o) => o.textContent)).toEqual(['HR User', 'Admin']);
    });
});

describe('UserMembershipsManager — mutation contracts', () => {
    it('changes a role with the frozen arguments and refreshes the parent', async () => {
        const { onDataUpdate } = renderMemberships();
        const rowSelect = await screen.findByLabelText('Role for Artificial Freight Co');
        fireEvent.change(rowSelect, { target: { value: 'company_admin' } });

        await waitFor(() => expect(updateMembershipRole).toHaveBeenCalledWith('mem-1', 'company_admin'));
        expect(onDataUpdate).toHaveBeenCalledTimes(1);
    });

    it('announces a role-change failure in place, preserving the two-line wording', async () => {
        updateMembershipRole.mockRejectedValueOnce(new Error('denied'));
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);

        renderMemberships();
        fireEvent.change(await screen.findByLabelText('Role for Artificial Freight Co'), {
            target: { value: 'company_admin' },
        });

        expect(await screen.findByText(
            /Failed to update role: denied\s+Ensure you are logged in as Super Admin\./,
        )).toBeInTheDocument();
        expect(alertSpy).not.toHaveBeenCalled();
        // Controlled select restores the previous role on failure.
        expect(screen.getByLabelText('Role for Artificial Freight Co')).toHaveValue('hr_user');
        vi.unstubAllGlobals();
    });

    it('removes access through an accessible dialog with the frozen question', async () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);

        const { onDataUpdate } = renderMemberships();
        fireEvent.click(await screen.findByRole('button', { name: 'Remove access to Artificial Freight Co' }));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Remove access to Artificial Freight Co?')).toBeInTheDocument();
        expect(confirmSpy).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Remove access' }));

        await waitFor(() => expect(deleteMembership).toHaveBeenCalledWith('mem-1'));
        await waitFor(() => expect(onDataUpdate).toHaveBeenCalled());
        vi.unstubAllGlobals();
    });

    it('does not remove when the confirmation is cancelled', async () => {
        renderMemberships();
        fireEvent.click(await screen.findByRole('button', { name: 'Remove access to Artificial Freight Co' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
        expect(deleteMembership).not.toHaveBeenCalled();
    });

    it('adds a membership with the frozen payload, then resets, reloads and refreshes', async () => {
        const { onDataUpdate } = renderMemberships();
        const companySelect = await screen.findByLabelText(/^Add to Company/);
        fireEvent.change(companySelect, { target: { value: 'co-2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Grant access to the selected company' }));

        await waitFor(() => expect(addMembership).toHaveBeenCalledWith({
            userId: 'user-1',
            companyId: 'co-2',
            role: 'hr_user',
        }));
        await waitFor(() => expect(onDataUpdate).toHaveBeenCalledTimes(1));
        expect(getMembershipsForUser).toHaveBeenCalledTimes(2);
        expect(screen.getByLabelText(/^Add to Company/)).toHaveValue('');
    });

    /**
     * The company select carries the native `required` attribute — it did before
     * the migration too — so in a real browser constraint validation blocks the
     * submit and this application-level message is a defensive fallback rather
     * than the normal path. Submitting the form directly proves the guard is
     * still wired and still uses the frozen wording.
     */
    it('keeps the frozen guard message when the form is submitted with nothing selected', async () => {
        renderMemberships();
        const select = await screen.findByLabelText(/^Add to Company/);
        expect(select).toBeRequired();

        fireEvent.submit(select.closest('form'));
        expect(await screen.findByText('Please select a company and role.')).toBeInTheDocument();
        expect(addMembership).not.toHaveBeenCalled();
    });

    it('announces an add failure', async () => {
        addMembership.mockRejectedValueOnce(new Error('already a member'));
        renderMemberships();
        fireEvent.change(await screen.findByLabelText(/^Add to Company/), { target: { value: 'co-2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Grant access to the selected company' }));
        expect(await screen.findByText('already a member')).toBeInTheDocument();
    });
});

describe('Edit User bodies — accessibility', () => {
    it('names the three previously title-only icon controls', async () => {
        renderMemberships();
        await screen.findByText('Artificial Freight Co');
        expect(screen.getByRole('button', { name: 'Refresh membership list' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove access to Artificial Freight Co' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Grant access to the selected company' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refresh membership list' })).not.toHaveAttribute('title');
    });

    it('makes the membership list a named, focusable scroll region', async () => {
        renderMemberships();
        await screen.findByText('Artificial Freight Co');
        const region = screen.getByRole('region', { name: 'Access & Permissions' });
        expect(region).toHaveAttribute('tabindex', '0');
    });

    it('has no jsdom axe violations — name form', async () => {
        const { container } = renderNameForm();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no jsdom axe violations — name form with both dialogs reachable', async () => {
        const { container } = renderNameForm();
        fireEvent.click(screen.getByRole('button', { name: /Delete User/ }));
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no jsdom axe violations — memberships with rows', async () => {
        const { container } = renderMemberships();
        await screen.findByText('Artificial Freight Co');
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no jsdom axe violations — memberships empty', async () => {
        getMembershipsForUser.mockResolvedValueOnce({ docs: [] });
        const { container } = renderMemberships();
        await screen.findByText('No active memberships.');
        expect((await axe(container)).violations).toEqual([]);
    });
});
