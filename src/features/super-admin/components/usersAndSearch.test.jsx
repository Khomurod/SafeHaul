/**
 * Contract freeze + defect proof for the migrated `UsersView` and
 * `GlobalSearchResults`.
 *
 * Both are read-only presentations over data `useSuperAdminData` owns, so the
 * frozen parts are the role/membership mapping rules, the result grouping and
 * counts, and the callback argument shapes.
 *
 * All names, emails and company names below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';

import { UsersView } from './UsersView';
import { GlobalSearchResults } from './GlobalSearchResults';

const NO_ERRORS = { companies: false, users: false, apps: false };

const COMPANIES_MAP = new Map([
    ['co-1', 'Artificial Freight Co'],
    ['co-2', 'Second Artificial Carrier'],
]);

const USERS = [
    { id: 'u-1', name: 'Artificial Admin', email: 'admin@example.test', globalRole: 'super_admin' },
    { id: 'u-2', name: 'Artificial Recruiter', email: 'recruiter@example.test', memberships: [{ companyId: 'co-1', role: 'company_admin' }, { companyId: 'co-9', role: 'recruiter' }] },
    { id: 'u-3', name: 'Unattached Person', email: 'nobody@example.test', memberships: [] },
];

function renderUsers(props = {}) {
    return render(
        <UsersView
            listLoading={false}
            statsError={NO_ERRORS}
            userList={USERS}
            allCompaniesMap={COMPANIES_MAP}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            {...props}
        />,
    );
}

describe('UsersView — frozen role and membership mapping', () => {
    it('shows Super Admin instead of memberships when globalRole is super_admin', () => {
        renderUsers();
        const row = screen.getByText('Artificial Admin').closest('tr');
        expect(within(row).getByText('Super Admin')).toBeInTheDocument();
    });

    // The claims trigger grants the Super Admin claim for a super_admin
    // membership, and nothing writes users/{uid}.globalRole: such a user showed
    // as "User at …".
    it('shows Super Admin for a super_admin membership, which is what grants the claim', () => {
        renderUsers({
            userList: [{ id: 'u-4', name: 'Membership Admin', email: 'm@example.test', memberships: [{ companyId: 'co-1', role: 'super_admin' }] }],
        });
        const row = screen.getByText('Membership Admin').closest('tr');
        expect(within(row).getByText('Super Admin')).toBeInTheDocument();
        expect(within(row).queryByText(/at Artificial Freight Co/)).not.toBeInTheDocument();
    });

    it('labels company_admin as Admin and anything else as User', () => {
        renderUsers();
        const row = screen.getByText('Artificial Recruiter').closest('tr');
        expect(within(row).getByText('Admin at Artificial Freight Co')).toBeInTheDocument();
        // Unknown company id keeps the frozen "Unknown" fallback.
        expect(within(row).getByText('User at Unknown')).toBeInTheDocument();
    });

    it('keeps the frozen no-memberships copy', () => {
        renderUsers();
        const row = screen.getByText('Unattached Person').closest('tr');
        expect(within(row).getByText('No active memberships')).toBeInTheDocument();
    });

    it('passes { id } to onEdit and { id, name } to onDelete', () => {
        const onEdit = vi.fn();
        const onDelete = vi.fn();
        renderUsers({ onEdit, onDelete });

        fireEvent.click(screen.getByRole('button', { name: 'Edit Artificial Recruiter' }));
        expect(onEdit).toHaveBeenCalledWith({ id: 'u-2' });

        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Recruiter' }));
        expect(onDelete).toHaveBeenCalledWith({ id: 'u-2', name: 'Artificial Recruiter' });
    });

    it('searches across name and email', () => {
        renderUsers();
        fireEvent.change(screen.getByLabelText('Search users by name or email'), { target: { value: 'nobody@' } });
        expect(screen.getByText('Unattached Person')).toBeInTheDocument();
        expect(screen.queryByText('Artificial Admin')).not.toBeInTheDocument();
    });

    it('keeps the frozen loading, error and empty strings', () => {
        const { rerender } = renderUsers({ listLoading: true });
        expect(screen.getByText('Loading users...')).toBeInTheDocument();

        rerender(<UsersView listLoading={false} statsError={{ ...NO_ERRORS, users: true }} userList={[]} allCompaniesMap={COMPANIES_MAP} onEdit={vi.fn()} onDelete={vi.fn()} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Error loading users.');

        rerender(<UsersView listLoading={false} statsError={NO_ERRORS} userList={[]} allCompaniesMap={COMPANIES_MAP} onEdit={vi.fn()} onDelete={vi.fn()} />);
        expect(screen.getByText('No users found.')).toBeInTheDocument();
    });

    /*
     * A live-region role on a `<td>` replaces the cell role. Each state is
     * announced by its own wrapper (the table's state panel), never by a cell,
     * and the empty state is announced too.
     */
    it('announces each state from its own wrapper, never from a cell', () => {
        const { rerender } = renderUsers({ listLoading: true });
        const loading = screen.getByText('Loading users...').closest('[role="status"]');
        expect(loading).not.toBeNull();
        expect(loading.tagName).not.toBe('TD');

        rerender(<UsersView listLoading={false} statsError={{ ...NO_ERRORS, users: true }} userList={[]} allCompaniesMap={COMPANIES_MAP} onEdit={vi.fn()} onDelete={vi.fn()} />);
        const error = screen.getByText('Error loading users.').closest('[role="alert"]');
        expect(error).not.toBeNull();
        expect(error.tagName).not.toBe('TD');

        rerender(<UsersView listLoading={false} statsError={NO_ERRORS} userList={[]} allCompaniesMap={COMPANIES_MAP} onEdit={vi.fn()} onDelete={vi.fn()} />);
        const empty = screen.getByText('No users found.').closest('[role="status"]');
        expect(empty).not.toBeNull();
        expect(empty.tagName).not.toBe('TD');
    });
});

describe('UsersView — the shared table', () => {
    it('is a DataTable with the user as each row header', () => {
        renderUsers();
        const table = screen.getByRole('table', { name: 'All platform users' });
        expect(table.closest('.ds-data-table')).toHaveAttribute('data-embedded', 'true');
        expect(within(table).getAllByRole('columnheader').map((th) => th.textContent))
            .toEqual(['User', 'Role & Access', 'Actions']);
        expect(within(table).getAllByRole('rowheader')[1]).toHaveTextContent('Artificial Recruiter');
    });

    it('pages the list with the table pager: 20, 50 or 100 rows', () => {
        const many = Array.from({ length: 25 }, (_, i) => ({
            id: `u-${i + 1}`, name: `Artificial Person ${i + 1}`, email: `p${i + 1}@example.test`, memberships: [],
        }));
        renderUsers({ userList: many });
        expect(screen.getByText('Showing 20 of 25 users')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(screen.getByText('Showing 5 of 25 users')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });
        expect(screen.getByText('Showing 25 of 25 users')).toBeInTheDocument();
    });
});

describe('UsersView — Load More from Database', () => {
    it('offers the next users while there are more, and asks the hook for them', () => {
        const loadMore = vi.fn();
        renderUsers({ hasMore: true, loadMore });
        fireEvent.click(screen.getByRole('button', { name: 'Load More from Database' }));
        expect(loadMore).toHaveBeenCalledWith('users');
    });

    it('shows no Load More once every user is read, or before the hook says there are more', () => {
        renderUsers({ hasMore: false, loadMore: vi.fn() });
        expect(screen.queryByRole('button', { name: 'Load More from Database' })).not.toBeInTheDocument();
    });
});

describe('UsersView — accessible names (defect)', () => {
    it('names every icon-only action after its user', () => {
        renderUsers();
        expect(screen.getByRole('button', { name: 'Edit Artificial Admin' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Unattached Person' })).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
        const { container } = renderUsers();
        expect((await axe(container)).violations).toEqual([]);
    });
});

const RESULTS = {
    companies: [{ id: 'co-1', companyName: 'Artificial Freight Co', appSlug: 'artificial-freight' }],
    users: [{ id: 'u-1', name: 'Artificial Recruiter', email: 'recruiter@example.test' }],
    applications: [
        { id: 'a-1', firstName: 'Artificial', lastName: 'Driver', email: 'driver@example.test', companyId: 'co-1', status: 'Approved' },
        { id: 'a-2', firstName: 'No', lastName: 'Status', companyId: 'unknown-co' },
    ],
};

function renderSearch(props = {}) {
    return render(
        <GlobalSearchResults
            results={RESULTS}
            totalResults={4}
            allCompaniesMap={COMPANIES_MAP}
            onViewApps={vi.fn()}
            onEditCompany={vi.fn()}
            onEditUser={vi.fn()}
            onAppClick={vi.fn()}
            {...props}
        />,
    );
}

describe('GlobalSearchResults — frozen grouping and mapping', () => {
    it('shows the total and per-group counts', () => {
        renderSearch();
        expect(screen.getByRole('heading', { name: /Search Results \(4 found\)/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Companies (1)' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Users (1)' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Driver Applications (2)' })).toBeInTheDocument();
    });

    it('keeps the exact callback shapes per group', () => {
        const onViewApps = vi.fn();
        const onEditCompany = vi.fn();
        const onEditUser = vi.fn();
        const onAppClick = vi.fn();
        renderSearch({ onViewApps, onEditCompany, onEditUser, onAppClick });

        fireEvent.click(screen.getByRole('button', { name: /View Apps for Artificial Freight Co/ }));
        expect(onViewApps).toHaveBeenCalledWith({ id: 'co-1', name: 'Artificial Freight Co' });

        fireEvent.click(screen.getByRole('button', { name: /Edit Artificial Freight Co/ }));
        expect(onEditCompany).toHaveBeenCalledWith('co-1');

        fireEvent.click(screen.getByRole('button', { name: /Edit Artificial Recruiter/ }));
        expect(onEditUser).toHaveBeenCalledWith({ id: 'u-1' });

        fireEvent.click(screen.getByRole('button', { name: /Artificial Driver/ }));
        expect(onAppClick).toHaveBeenCalledWith(RESULTS.applications[0]);
    });

    it('falls back to Unknown Company and New Application', () => {
        renderSearch();
        expect(screen.getByText('Unknown Company')).toBeInTheDocument();
        expect(screen.getByText('New Application')).toBeInTheDocument();
    });

    it('keeps the frozen empty-group copy', () => {
        renderSearch({ results: { companies: [], users: [], applications: [] }, totalResults: 0 });
        expect(screen.getByText('No companies found.')).toBeInTheDocument();
        expect(screen.getByText('No users found.')).toBeInTheDocument();
        expect(screen.getByText('No driver applications found.')).toBeInTheDocument();
    });
});

describe('GlobalSearchResults — status is never colour-only (defect)', () => {
    it('renders the status as text', () => {
        renderSearch();
        expect(screen.getByText('Approved')).toBeInTheDocument();
    });

    it('names each result group section', () => {
        renderSearch();
        expect(screen.getByRole('region', { name: /Companies \(1\)/ })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /Driver Applications \(2\)/ })).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
        const { container } = renderSearch();
        expect((await axe(container)).violations).toEqual([]);
    });
});
