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
