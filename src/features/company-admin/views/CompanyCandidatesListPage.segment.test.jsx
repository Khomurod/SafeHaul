/**
 * A candidate list opens on its own tab, and on the segment a link names when
 * the list has it: the dashboard's Hired card opens All Applications on Hired.
 * A segment the list does not have opens the whole list.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const fixture = vi.hoisted(() => ({ options: [], filters: {}, teamMembers: [], noop: () => {} }));

vi.mock('@features/companies', () => ({
    DashboardToolbar: () => null,
    useCompanyDashboard: (companyId, options) => {
        fixture.options.push(options);
        return {
            activeTab: options?.initialTab, setActiveTab: fixture.noop,
            pipelineSegment: options?.initialSegment, setPipelineSegment: fixture.noop,
            searchQuery: '', setSearchQuery: fixture.noop, filters: fixture.filters, setFilters: fixture.noop,
            paginatedData: [], loading: false, currentPage: 1, totalPages: 1, totalCount: 0,
            nextPage: fixture.noop, prevPage: fixture.noop, refreshData: fixture.noop,
            teamMembers: fixture.teamMembers, undatedCount: 0, dateOrder: 'desc', setDateOrder: fixture.noop,
        };
    },
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

function openedWith(scope, state) {
    fixture.options = [];
    render(
        <MemoryRouter initialEntries={[{ pathname: '/company/drivers/list', state }]}>
            <CompanyCandidatesListPage scope={scope} />
        </MemoryRouter>,
    );
    return fixture.options[0];
}

describe('the list a candidate page opens on', () => {
    it('is the Hired applications from the Hired card', () => {
        expect(openedWith('applications', { segment: 'hired' })).toEqual({ initialTab: 'applications', initialSegment: 'hired' });
    });

    it("is a leads segment on a leads list, in the list's own tab", () => {
        expect(openedWith('company_leads', { segment: 'attempting' })).toEqual({ initialTab: 'company_leads', initialSegment: 'attempting' });
    });

    it.each([
        ['applications', { segment: 'attempting' }],
        ['my_leads', { segment: 'hired' }],
        ['applications', null],
        ['applications', undefined],
    ])('is the whole %s list for %o', (scope, state) => {
        expect(openedWith(scope, state)).toEqual({ initialTab: scope, initialSegment: 'all' });
    });
});
