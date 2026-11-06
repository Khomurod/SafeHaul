/**
 * The Applications and Leads lists with no row (У5.6): a list nothing narrows
 * says nothing is in it yet and how the first record arrives; a list a search
 * or a filter narrows says nothing matches and clears them all on request.
 *
 * All names and ids below are artificial.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const fx = vi.hoisted(() => ({
    records: [],
    filters: {},
    searchQuery: '',
    segment: 'all',
    loading: false,
    claims: { roles: { 'company-1': 'company_admin' } },
    features: {},
    setFilters: vi.fn(),
    setSearchQuery: vi.fn(),
    setPipelineSegment: vi.fn(),
}));

vi.mock('@features/companies', () => ({
    DashboardToolbar: () => null,
    useCompanyDashboard: (_companyId, options) => ({
        activeTab: options?.initialTab, setActiveTab: () => {},
        pipelineSegment: fx.segment, setPipelineSegment: fx.setPipelineSegment,
        searchQuery: fx.searchQuery, setSearchQuery: fx.setSearchQuery,
        filters: fx.filters, setFilters: fx.setFilters,
        paginatedData: fx.records, loading: fx.loading, error: '', listCountError: '',
        currentPage: 1, totalPages: 1, totalCount: fx.records.length,
        nextPage: () => {}, prevPage: () => {}, refreshData: () => {},
        teamMembers: [], undatedCount: 0,
        dateOrder: 'desc', setDateOrder: () => {},
    }),
}));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'company-1', features: fx.features }, currentUserClaims: fx.claims }),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showError: () => {}, showSuccess: () => {} }),
}));
vi.mock('@shared/components/modals/CallOutcomeModal', () => ({ CallOutcomeModal: () => null }));
vi.mock('../components/LeadAssignmentModal', () => ({ LeadAssignmentModal: () => null }));

import { CompanyCandidatesListPage } from './CompanyCandidatesListPage';

const page = (scope) => render(<MemoryRouter><CompanyCandidatesListPage scope={scope} /></MemoryRouter>);
const emptyState = () => screen.getByText(/No (applications|leads|unassigned)/).closest('[role="status"]');

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(fx, {
        records: [], filters: {}, searchQuery: '', segment: 'all', loading: false,
        claims: { roles: { 'company-1': 'company_admin' } }, features: {},
    });
});

afterEach(() => vi.resetAllMocks());

describe('an empty list nothing narrows', () => {
    it('says no application has come yet, with where the personal link is, and offers no clearing', () => {
        page('applications');

        expect(emptyState()).toHaveTextContent('No applications yet');
        expect(emptyState()).toHaveTextContent('Share your personal link (Settings → My profile) with drivers.');
        expect(screen.queryByText(/Try adjusting/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Clear search and filters' })).toBeNull();
    });

    it('points a company admin at Add lead and Import leads', () => {
        page('company_leads');

        expect(emptyState()).toHaveTextContent('No leads yet');
        expect(emptyState()).toHaveTextContent('Use Add lead or Import leads above to bring in your first leads.');
    });

    it('points a recruiter, who cannot import, at Add lead alone', () => {
        fx.claims = { roles: { 'company-1': 'recruiter' } };
        page('company_leads');

        expect(emptyState()).toHaveTextContent('Use Add lead above to add your first lead.');
    });
});

describe('an empty list a search or a filter narrows', () => {
    it('says nothing matches, and clears the search, every filter and the segment', () => {
        fx.searchQuery = 'zz-no-such-driver';
        fx.segment = 'hired';
        fx.filters = { state: 'Texas', myAssignmentsOnly: true };
        page('applications');

        expect(emptyState()).toHaveTextContent('No applications match your search or filters');
        fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));

        expect(fx.setSearchQuery).toHaveBeenCalledWith('');
        expect(fx.setPipelineSegment).toHaveBeenCalledWith('all');
        const update = fx.setFilters.mock.calls.at(-1)[0];
        expect(update({ state: 'Texas', myAssignmentsOnly: true, dateFilter: '2026-10-01', period: { kind: 'added' } }))
            .toEqual({ driverType: '', state: '', dob: '', assignee: '', dateFilter: '', myAssignmentsOnly: false, period: null });
    });

    it('says the same on a leads list', () => {
        fx.filters = { driverType: 'Reefer' };
        page('my_leads');

        expect(emptyState()).toHaveTextContent('No leads match your search or filters');
        expect(screen.getByRole('button', { name: 'Clear search and filters' })).toBeInTheDocument();
    });
});
