/**
 * Pressing the Applied header sets the order Firestore sorts the whole list by:
 * the dashboard hook's `dateOrder`, newest first until the header is pressed.
 * The page shows the rows in the order the list query returns them, so a page
 * never reorders on its own, and the header's `aria-sort` says which order is
 * in force.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';

const fixture = vi.hoisted(() => {
    const at = (iso) => ({ seconds: Date.parse(iso) / 1000 });
    const noop = () => {};
    return {
        // Artificial records, in the order the hook returns them.
        records: [
            { id: 'ben', firstName: 'Ben', lastName: 'Middle', status: 'New Application', createdAt: at('2026-10-08T15:00:00Z') },
            { id: 'ann', firstName: 'Ann', lastName: 'Early', status: 'New Application', createdAt: at('2026-10-05T15:00:00Z'), submittedAt: at('2026-10-12T15:00:00Z') },
        ],
        // Held once, as the hook holds them in state: a new object on every
        // render would re-run the page's selection reset forever.
        filters: {},
        teamMembers: [],
        dateOrder: 'desc',
        setDateOrder: vi.fn(),
        noop,
    };
});

vi.mock('@features/companies', () => ({
    DashboardToolbar: () => null,
    useCompanyDashboard: () => ({
        activeTab: 'applications', setActiveTab: fixture.noop, pipelineSegment: 'all', setPipelineSegment: fixture.noop,
        searchQuery: '', setSearchQuery: fixture.noop, filters: fixture.filters, setFilters: fixture.noop,
        paginatedData: fixture.records, loading: false, currentPage: 1, totalPages: 1, totalCount: 2,
        nextPage: fixture.noop, prevPage: fixture.noop, refreshData: fixture.noop, teamMembers: fixture.teamMembers, undatedCount: 0,
        dateOrder: fixture.dateOrder, setDateOrder: fixture.setDateOrder,
    }),
}));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({
        currentCompanyProfile: { id: 'company-1' },
        currentUserClaims: { roles: { 'company-1': 'company_admin' } },
    }),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showError: () => {}, showSuccess: () => {} }),
}));
vi.mock('@shared/components/modals/CallOutcomeModal', () => ({ CallOutcomeModal: () => null }));
vi.mock('../components/LeadAssignmentModal', () => ({ LeadAssignmentModal: () => null }));
vi.mock('../components/modals/driver-dossier/DriverProfileModal', () => ({ DriverProfileModal: () => null }));

import { CompanyCandidatesListPage } from './CompanyCandidatesListPage';

const rowOrder = () => screen.getAllByRole('row', { name: /^Open driver dossier for / })
    .map((row) => row.getAttribute('aria-label'));
/** The Applied header: one button, and its column header says how the list is ordered. */
const added = () => screen.getByRole('button', { name: 'Applied' });
const addedHeader = () => screen.getByRole('columnheader', { name: 'Applied' });

beforeEach(() => {
    fixture.dateOrder = 'desc';
    fixture.setDateOrder.mockClear();
});

describe('the Applied header', () => {
    it('says newest first is the order in force, and leaves the rows as the list query returned them', () => {
        render(<MemoryRouter><CompanyCandidatesListPage scope="applications" /></MemoryRouter>);

        expect(addedHeader()).toHaveAttribute('aria-sort', 'descending');
        expect(rowOrder()).toEqual(['Open driver dossier for Ben Middle', 'Open driver dossier for Ann Early']);
    });

    it('turns the whole list oldest first, and back to newest first when pressed again', async () => {
        const { rerender } = render(<MemoryRouter><CompanyCandidatesListPage scope="applications" /></MemoryRouter>);
        await userEvent.click(added());
        expect(fixture.setDateOrder).toHaveBeenLastCalledWith('asc');

        fixture.dateOrder = 'asc';
        rerender(<MemoryRouter><CompanyCandidatesListPage scope="applications" /></MemoryRouter>);
        expect(addedHeader()).toHaveAttribute('aria-sort', 'ascending');
        await userEvent.click(added());
        expect(fixture.setDateOrder).toHaveBeenLastCalledWith('desc');
    });

    it('does not open a record when the header is pressed', async () => {
        render(<MemoryRouter><CompanyCandidatesListPage scope="applications" /></MemoryRouter>);
        await userEvent.click(added());

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
