/**
 * The Added Date arrows sort the list by the date the column shows: the day a
 * record was created, else the day it was submitted. An application the driver
 * sent again later shows its creation day, so it sorts by that day too.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const fixture = vi.hoisted(() => {
    const at = (iso) => ({ seconds: Date.parse(iso) / 1000 });
    // Artificial records: Ann's application was created on 5 October and sent
    // again on 12 October; Ben's was created and sent on 8 October.
    const records = [
        { id: 'ann', firstName: 'Ann', lastName: 'Early', status: 'New Application', createdAt: at('2026-10-05T15:00:00Z'), submittedAt: at('2026-10-12T15:00:00Z') },
        { id: 'ben', firstName: 'Ben', lastName: 'Middle', status: 'New Application', createdAt: at('2026-10-08T15:00:00Z'), submittedAt: at('2026-10-08T15:00:00Z') },
    ];
    const noop = () => {};
    return {
        dashboard: {
            activeTab: 'applications', setActiveTab: noop, pipelineSegment: 'all', setPipelineSegment: noop,
            searchQuery: '', setSearchQuery: noop, filters: {}, setFilters: noop,
            paginatedData: records, loading: false, currentPage: 1, totalPages: 1, totalCount: 2,
            nextPage: noop, prevPage: noop, refreshData: noop, teamMembers: [],
        },
    };
});

vi.mock('@features/companies', () => ({
    DashboardToolbar: () => null,
    useCompanyDashboard: () => fixture.dashboard,
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

let zone;

beforeEach(() => {
    zone = process.env.TZ;
    process.env.TZ = 'America/Chicago';
});

afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
});

const rowOrder = () => screen.getAllByRole('row', { name: /^Open driver dossier for / })
    .map((row) => row.getAttribute('aria-label') || row.textContent);

describe('the Added Date arrows', () => {
    it('put the latest shown date first', async () => {
        render(<CompanyCandidatesListPage scope="applications" />);
        await userEvent.click(screen.getByRole('button', { name: 'Sort by latest added date' }));

        expect(rowOrder()).toEqual(['Open driver dossier for Ben Middle', 'Open driver dossier for Ann Early']);
        expect(screen.getAllByText(/^10\/0[58]\/2026$/).map((cell) => cell.textContent)).toEqual(['10/08/2026', '10/05/2026']);
    });

    it('put the earliest shown date first', async () => {
        render(<CompanyCandidatesListPage scope="applications" />);
        await userEvent.click(screen.getByRole('button', { name: 'Sort by earliest added date' }));

        expect(rowOrder()).toEqual(['Open driver dossier for Ann Early', 'Open driver dossier for Ben Middle']);
        expect(screen.getAllByText(/^10\/0[58]\/2026$/).map((cell) => cell.textContent)).toEqual(['10/05/2026', '10/08/2026']);
    });
});
