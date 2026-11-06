/**
 * Add lead and Import leads sit in the header of the leads lists, not of
 * Applications. `LeadsHeaderActions.test.jsx` covers who is offered which.
 *
 * All ids below are artificial.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const fixture = vi.hoisted(() => ({ filters: {}, teamMembers: [], noop: () => {} }));

vi.mock('@features/companies', () => ({
    DashboardToolbar: () => null,
    useCompanyDashboard: (companyId, options) => ({
        activeTab: options?.initialTab, setActiveTab: fixture.noop,
        pipelineSegment: 'all', setPipelineSegment: fixture.noop,
        searchQuery: '', setSearchQuery: fixture.noop, filters: fixture.filters, setFilters: fixture.noop,
        paginatedData: [], loading: false, currentPage: 1, totalPages: 1, totalCount: 0,
        nextPage: fixture.noop, prevPage: fixture.noop, refreshData: fixture.noop,
        teamMembers: fixture.teamMembers, undatedCount: 0, dateOrder: 'desc', setDateOrder: fixture.noop,
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
vi.mock('@lib/runtime/whenIdle', () => ({ whenIdle: () => {} }));

import { CompanyCandidatesListPage } from './CompanyCandidatesListPage';

function header(scope) {
    render(
        <MemoryRouter>
            <CompanyCandidatesListPage scope={scope} />
        </MemoryRouter>,
    );
    return screen.getByRole('heading', { level: 1 }).closest('header');
}

describe('the header of a candidate list', () => {
    it.each(['company_leads', 'my_leads'])('offers Add lead and Import leads on %s', (scope) => {
        const leadsHeader = within(header(scope));

        expect(leadsHeader.getByRole('link', { name: 'Add lead' })).toBeInTheDocument();
        expect(leadsHeader.getByRole('link', { name: 'Import leads' })).toBeInTheDocument();
    });

    it('offers neither on Applications', () => {
        const applicationsHeader = within(header('applications'));

        expect(applicationsHeader.queryByRole('link', { name: 'Add lead' })).not.toBeInTheDocument();
        expect(applicationsHeader.queryByRole('link', { name: 'Import leads' })).not.toBeInTheDocument();
    });
});
