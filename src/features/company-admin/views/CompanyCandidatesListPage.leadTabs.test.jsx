/**
 * The leads lists are one page, Leads, with three tabs at the top: All,
 * Assigned to me and Unassigned, each a link to its own address. The toolbar
 * has no "My leads" switch (Applications keeps Only mine), and offers the
 * Assigned to filter only where it can narrow the list: on All. Assigning stays
 * a company admin's, on All and Unassigned.
 *
 * All names and ids below are artificial.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const fx = vi.hoisted(() => ({
    claims: { roles: { 'company-1': 'company_admin' } },
    toolbarProps: [],
    records: [{ id: 'lena', firstName: 'Lena', lastName: 'Lister', status: 'New Lead', assignedTo: '', createdAt: { seconds: 1780000000 } }],
    noop: () => {},
}));

vi.mock('@features/companies', () => ({
    DashboardToolbar: (props) => {
        fx.toolbarProps.push(props);
        return null;
    },
    useCompanyDashboard: (_companyId, options) => ({
        activeTab: options?.initialTab, setActiveTab: fx.noop,
        pipelineSegment: 'all', setPipelineSegment: fx.noop,
        searchQuery: '', setSearchQuery: fx.noop, filters: {}, setFilters: fx.noop,
        paginatedData: fx.records, loading: false, error: '', listCountError: '',
        currentPage: 1, totalPages: 1, totalCount: fx.records.length,
        nextPage: fx.noop, prevPage: fx.noop, refreshData: fx.noop,
        teamMembers: [], undatedCount: 0, dateOrder: 'desc', setDateOrder: fx.noop,
    }),
}));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'company-1' }, currentUserClaims: fx.claims }),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showError: () => {}, showSuccess: () => {} }),
}));
vi.mock('@shared/components/modals/CallOutcomeModal', () => ({ CallOutcomeModal: () => null }));
vi.mock('../components/LeadAssignmentModal', () => ({ LeadAssignmentModal: () => null }));

import { CompanyCandidatesListPage } from './CompanyCandidatesListPage';
import { LEAD_LIST_TABS } from './leadLists';
import { COMPANY_ROUTE_MANIFEST } from '@app/routes/companyRouteManifest';

afterEach(() => {
    fx.claims = { roles: { 'company-1': 'company_admin' } };
    fx.toolbarProps = [];
});

function Where() {
    const { pathname, search } = useLocation();
    return <output data-testid="where">{`${pathname}${search}`}</output>;
}

/** The page at a tab's address, with the other tabs routed as the app routes them. */
function renderAt(url) {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                {LEAD_LIST_TABS.map(({ scope, path }) => (
                    <Route key={scope} path={path} element={<><CompanyCandidatesListPage scope={scope} /><Where /></>} />
                ))}
                <Route
                    path="/company/drivers/applications"
                    element={<CompanyCandidatesListPage scope="applications" />}
                />
            </Routes>
        </MemoryRouter>,
    );
}

const lastToolbar = () => fx.toolbarProps.at(-1);

describe('the Leads page', () => {
    it.each(LEAD_LIST_TABS.map((tab) => [tab.label, tab]))('is titled Leads on %s, its tab marked current', (_label, tab) => {
        renderAt(tab.path);

        expect(screen.getByRole('heading', { level: 1, name: 'Leads' })).toBeInTheDocument();
        expect(screen.getByRole('table', { name: 'Leads table' })).toBeInTheDocument();
        const nav = screen.getByRole('navigation', { name: 'Lead lists' });
        const links = within(nav).getAllByRole('link');
        expect(links.map((link) => link.textContent)).toEqual(['All', 'Assigned to me', 'Unassigned']);
        expect(links.map((link) => link.getAttribute('href'))).toEqual([
            '/company/drivers/leads/company', '/company/drivers/leads/my', '/company/drivers/leads/unassigned',
        ]);
        expect(within(nav).getByRole('link', { current: 'page' })).toHaveTextContent(tab.label);
        expect(within(nav).getAllByRole('link', { current: false })).toHaveLength(2);
    });

    it('has no lead tabs on Applications', () => {
        renderAt('/company/drivers/applications');

        expect(screen.getByRole('heading', { level: 1, name: 'Applications' })).toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: 'Lead lists' })).toBeNull();
    });

    it('moves between the tabs in place, keeping the query string', async () => {
        renderAt('/company/drivers/leads/company?e2eAuth=company_admin');

        await userEvent.click(screen.getByRole('link', { name: 'Unassigned' }));

        expect(screen.getByTestId('where')).toHaveTextContent('/company/drivers/leads/unassigned?e2eAuth=company_admin');
        expect(screen.getByRole('link', { name: 'Unassigned' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('href', '/company/drivers/leads/company?e2eAuth=company_admin');
    });

    it('routes each tab to the list it names', () => {
        for (const { scope, path } of LEAD_LIST_TABS) {
            const route = COMPANY_ROUTE_MANIFEST.find((entry) => `/company/${entry.path}` === path);
            expect(route?.props).toEqual({ scope });
            expect(route?.screen).toBe('companyCandidatesListPage');
        }
    });
});

describe('the toolbar on the Leads tabs', () => {
    it.each([
        ['/company/drivers/applications', true, true],
        ['/company/drivers/leads/company', false, true],
        ['/company/drivers/leads/my', false, false],
        ['/company/drivers/leads/unassigned', false, false],
    ])('on %s: Only mine %s, Assigned to filter %s', (url, toggle, assigneeFilter) => {
        renderAt(url);

        expect(lastToolbar().showMyAssignmentsToggle).toBe(toggle);
        expect(lastToolbar().showAssigneeFilter).toBe(assigneeFilter);
        // The switch, where there is one, is Only mine; no list says "My leads".
        expect(lastToolbar().myAssignmentsLabel).toBeUndefined();
    });
});

describe('assigning leads', () => {
    it.each([
        ['/company/drivers/leads/company', true],
        ['/company/drivers/leads/unassigned', true],
        ['/company/drivers/leads/my', false],
        ['/company/drivers/applications', false],
    ])('is offered to a company admin on %s: %s', (url, offered) => {
        renderAt(url);

        expect(lastToolbar().canAssign).toBe(offered);
        expect(screen.queryAllByRole('checkbox', { name: 'Select Lena Lister' })).toHaveLength(offered ? 1 : 0);
    });

    it.each(LEAD_LIST_TABS.map((tab) => tab.path))('is not offered to a recruiter, on %s', (url) => {
        fx.claims = { roles: { 'company-1': 'recruiter' } };
        renderAt(url);

        expect(lastToolbar().canAssign).toBe(false);
        expect(screen.queryByRole('checkbox')).toBeNull();
    });
});
