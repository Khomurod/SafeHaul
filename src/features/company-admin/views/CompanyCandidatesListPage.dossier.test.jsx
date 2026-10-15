/**
 * The candidate list shows before the driver dossier's code loads: the dossier
 * is most of what the page downloaded, and it is only needed once a row is
 * opened. It loads behind the list once the page is idle, or on the first open,
 * and a row opens the dossier's frame at once while that code arrives.
 *
 * All names and ids below are artificial.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';

const fixture = vi.hoisted(() => {
    let releaseDossierCode;
    const dossierCode = new Promise((resolve) => { releaseDossierCode = resolve; });
    return {
        loaded: false,
        dossierCode,
        releaseDossierCode,
        records: [{ id: 'app-1', firstName: 'Ann', lastName: 'Driver', status: 'New Application' }],
        filters: {},
        teamMembers: [],
        noop: () => {},
    };
});

vi.mock('@features/companies', () => ({
    DashboardToolbar: () => null,
    useCompanyDashboard: () => ({
        activeTab: 'applications', setActiveTab: fixture.noop, pipelineSegment: 'all', setPipelineSegment: fixture.noop,
        searchQuery: '', setSearchQuery: fixture.noop, filters: fixture.filters, setFilters: fixture.noop,
        paginatedData: fixture.records, loading: false, currentPage: 1, totalPages: 1, totalCount: 1,
        nextPage: fixture.noop, prevPage: fixture.noop, refreshData: fixture.noop, teamMembers: fixture.teamMembers, undatedCount: 0,
        dateOrder: 'desc', setDateOrder: fixture.noop,
    }),
}));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'company-1' }, currentUserClaims: { roles: { 'company-1': 'company_admin' } } }),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => ({ showError: () => {}, showSuccess: () => {} }) }));
vi.mock('@shared/components/modals/CallOutcomeModal', () => ({ CallOutcomeModal: () => null }));
vi.mock('../components/LeadAssignmentModal', () => ({ LeadAssignmentModal: () => null }));
// The idle prefetch waits for a later moment than this test looks at.
vi.mock('@lib/monitoring/sentry', () => ({ whenIdle: () => {} }));
vi.mock('../components/modals/driver-dossier/DriverProfileModal', async () => {
    fixture.loaded = true;
    await fixture.dossierCode;
    return { DriverProfileModal: ({ driverId }) => <p>Dossier of {driverId}</p> };
});

import { CompanyCandidatesListPage } from './CompanyCandidatesListPage';

describe('the driver dossier on a candidate list', () => {
    it('loads after the list, and a row opens it at once', async () => {
        render(
            <MemoryRouter>
                <CompanyCandidatesListPage scope="applications" />
            </MemoryRouter>,
        );

        expect(screen.getByRole('row', { name: 'Open driver dossier for Ann Driver' })).toBeInTheDocument();
        expect(fixture.loaded).toBe(false);

        await userEvent.click(screen.getByRole('row', { name: 'Open driver dossier for Ann Driver' }));

        expect(screen.getByRole('dialog', { name: 'Driver dossier' })).toHaveTextContent('Loading driver dossier…');
        fixture.releaseDossierCode();
        expect(await screen.findByText('Dossier of app-1')).toBeInTheDocument();
        expect(fixture.loaded).toBe(true);
    });
});
