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

    it('is the applications in process from the dashboard brief', () => {
        expect(openedWith('applications', { segment: 'in_process' })).toEqual({ initialTab: 'applications', initialSegment: 'in_process' });
    });

    it.each([
        { field: 'createdAt', month: '2026-11' },
        { field: 'hiredAt', month: '2026-11' },
    ])('is the applications of a month the brief named: %o', (period) => {
        expect(openedWith('applications', { period })).toEqual({ initialTab: 'applications', initialSegment: 'all', initialPeriod: period });
    });

    it.each([
        ['applications', { period: { field: 'statusChangedAt', month: '2026-11' } }],
        ['applications', { period: { field: 'hiredAt', month: 'November' } }],
        ['company_leads', { period: { field: 'createdAt', month: '2026-11' } }],
    ])('ignores a period %s has not got: %o', (scope, state) => {
        expect(openedWith(scope, state)).toEqual({ initialTab: scope, initialSegment: 'all' });
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
