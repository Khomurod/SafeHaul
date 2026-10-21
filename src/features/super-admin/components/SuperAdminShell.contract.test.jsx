/**
 * Contract freeze + defect proof for the Super Admin shell
 * (`SuperAdminDashboard`, `DashboardHeader`, `SuperAdminSidebar`).
 *
 * The masthead holds the product identity, the global search and logout; the
 * maintenance actions live on the Maintenance page, whose suite
 * (`MaintenanceView.contract.test.jsx`) froze the employer backfill's callable,
 * confirmation and focus hand-back when the button moved there. This suite
 * proves the accessibility defects the migration set out to fix are fixed:
 *  - the global search input had no label,
 *  - the clear-search control had no accessible name,
 *  - the nav had no accessible name and signalled the active view by colour only,
 * and that the screen is in the address, including the addresses of screens
 * that were merged into another.
 *
 * All company/user names below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

const httpsCallable = vi.fn();
const showSuccess = vi.fn();
const showError = vi.fn();
const showInfo = vi.fn();
const handleLogout = vi.fn();
const refreshData = vi.fn();

let superAdminData;

vi.mock('firebase/functions', () => ({ httpsCallable: (...a) => httpsCallable(...a) }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: { __functions: true } }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(() => ({})),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
}));
vi.mock('@/context/DataContext', () => ({ useData: () => ({ handleLogout }) }));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showSuccess, showError, showInfo }),
}));
vi.mock('../hooks/useSuperAdminData', () => ({
    useSuperAdminData: () => superAdminData,
}));
// The view layer is exercised by its own suites; the shell only needs to prove
// it routes and composes.
vi.mock('./ViewRouter', () => ({
    ViewRouter: ({ activeView, isSearching, selectedCompany, companyRevision, onOpenCompany, onCompanyTab, onBackToCompanies }) => (
        <div
            data-testid="view-router"
            data-active-view={activeView}
            data-searching={String(isSearching)}
            data-company-id={selectedCompany?.id ?? ''}
            data-tab={selectedCompany?.tab ?? ''}
            data-revision={String(companyRevision)}
        >
            <button type="button" onClick={() => onOpenCompany({ id: 'co-9', companyName: 'Artificial Carrier 9' })}>
                Open Artificial Carrier 9
            </button>
            <button type="button" onClick={() => onCompanyTab('sms')}>Show the SMS tab</button>
            <button type="button" onClick={onBackToCompanies}>Back to companies</button>
        </div>
    ),
}));
vi.mock('./DashboardModals', () => ({
    DashboardModals: ({ onRefreshData }) => (
        <button type="button" onClick={onRefreshData}>Save company details</button>
    ),
}));

import { SuperAdminDashboard } from './SuperAdminDashboard';

/** The address the panel is at, and the browser's Back. */
function AddressProbe() {
    const location = useLocation();
    const navigate = useNavigate();
    return (
        <>
            <output data-testid="address">{`${location.pathname}${location.search}`}</output>
            <button type="button" onClick={() => navigate(-1)}>Browser back</button>
        </>
    );
}

/** The panel at `path`, under the route the application gives it. */
function renderShell(path = '/super-admin') {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/super-admin/*" element={<SuperAdminDashboard />} />
            </Routes>
            <AddressProbe />
        </MemoryRouter>,
    );
}

function makeData(overrides = {}) {
    return {
        searchResults: { companies: [], users: [], applications: [] },
        totalSearchResults: 0,
        refreshData,
        loadMore: vi.fn(),
        hasMoreCompanies: false,
        hasMoreApps: false,
        searchQuery: '',
        setSearchQuery: vi.fn(),
        allCompaniesMap: new Map(),
        stats: { companyCount: 0, userCount: 0, appCount: 0 },
        statsError: { companies: false, users: false, apps: false },
        loading: false,
        companyList: [],
        userList: [],
        allApplications: [],
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    superAdminData = makeData();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Super Admin shell — header accessibility (defects)', () => {
    it('gives the global search box an accessible name', () => {
        renderShell();
        expect(
            screen.getByRole('searchbox', { name: /Search companies, users and driver applications/i }),
        ).toBeInTheDocument();
    });

    it('names the clear-search control', () => {
        superAdminData = makeData({ searchQuery: 'acme' });
        renderShell();
        expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    });

    it('keeps the logout hook and its stable id', () => {
        renderShell();
        const logout = screen.getByRole('button', { name: /Logout|Log out/i });
        expect(logout).toHaveAttribute('id', 'logout-button-super');
        fireEvent.click(logout);
        expect(handleLogout).toHaveBeenCalled();
    });

    it('carries no maintenance action: the employer backfill is on the Maintenance page', () => {
        renderShell();
        const banner = screen.getByRole('banner');
        expect(within(banner).queryByRole('button', { name: /Backfill Employers/i })).not.toBeInTheDocument();
        expect(within(banner).getAllByRole('button').map((button) => button.id)).toEqual(['logout-button-super']);
        expect(httpsCallable).not.toHaveBeenCalled();
    });
});

describe('Super Admin shell — navigation (defects)', () => {
    it('names the section navigation landmark', () => {
        renderShell();
        expect(screen.getByRole('navigation', { name: 'Super Admin sections' })).toBeInTheDocument();
    });

    it('marks the active view with aria-current, not colour alone', () => {
        renderShell();
        const nav = screen.getByRole('navigation', { name: 'Super Admin sections' });
        expect(within(nav).getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
        expect(within(nav).getByRole('button', { name: 'Companies' })).not.toHaveAttribute('aria-current');
    });

    it('routes to the exact SUPER_ADMIN_VIEWS value for each nav item', () => {
        renderShell();
        const nav = screen.getByRole('navigation', { name: 'Super Admin sections' });

        fireEvent.click(within(nav).getByRole('button', { name: 'Unified Driver DB' }));
        expect(screen.getByTestId('view-router')).toHaveAttribute('data-active-view', 'applications');

        expect(within(nav).queryByRole('button', { name: 'SMS Integrations' })).not.toBeInTheDocument();
        expect(within(nav).queryByRole('button', { name: 'Global Features' })).not.toBeInTheDocument();

        fireEvent.click(within(nav).getByRole('button', { name: 'System Health' }));
        expect(screen.getByTestId('view-router')).toHaveAttribute('data-active-view', 'system-health');

        fireEvent.click(within(nav).getByRole('button', { name: 'Maintenance' }));
        expect(screen.getByTestId('view-router')).toHaveAttribute('data-active-view', 'maintenance');
        expect(within(nav).queryByRole('button', { name: 'Stats Backfill' })).not.toBeInTheDocument();
    });

    it('clears the search query when a section is chosen', () => {
        const setSearchQuery = vi.fn();
        superAdminData = makeData({ searchQuery: 'acme', setSearchQuery });
        renderShell();

        fireEvent.click(screen.getByRole('button', { name: 'Companies' }));
        expect(setSearchQuery).toHaveBeenCalledWith('');
    });

    it('exposes the search state to the router so results replace the active view', () => {
        superAdminData = makeData({ searchQuery: 'acme' });
        renderShell();
        expect(screen.getByTestId('view-router')).toHaveAttribute('data-searching', 'true');
    });
});

describe('Super Admin shell — the screen in the address', () => {
    const view = () => screen.getByTestId('view-router');
    const nav = () => screen.getByRole('navigation', { name: 'Super Admin sections' });

    it('opens the screen the address names', () => {
        renderShell('/super-admin/users');

        expect(view()).toHaveAttribute('data-active-view', 'users');
        expect(within(nav()).getByRole('button', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    });

    it('writes the chosen screen into the address, keeping its query', () => {
        renderShell('/super-admin?e2eAuth=super_admin');

        fireEvent.click(within(nav()).getByRole('button', { name: 'Companies' }));
        expect(screen.getByTestId('address')).toHaveTextContent('/super-admin/companies?e2eAuth=super_admin');

        fireEvent.click(within(nav()).getByRole('button', { name: 'Dashboard' }));
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/super-admin\?e2eAuth=super_admin$/);
    });

    it('goes back to the previous screen with the browser', () => {
        renderShell();
        fireEvent.click(within(nav()).getByRole('button', { name: 'Companies' }));
        fireEvent.click(within(nav()).getByRole('button', { name: 'Releases' }));

        fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));

        expect(view()).toHaveAttribute('data-active-view', 'companies');
    });

    it("opens a company's screen from its address, on the tab it names, as part of Companies", () => {
        renderShell('/super-admin/companies/co-7/sms');

        expect(view()).toHaveAttribute('data-active-view', 'company');
        expect(view()).toHaveAttribute('data-company-id', 'co-7');
        expect(view()).toHaveAttribute('data-tab', 'sms');
        expect(within(nav()).getByRole('button', { name: 'Companies' })).toHaveAttribute('aria-current', 'page');
    });

    it("opens a company's features when its address names no tab", () => {
        renderShell('/super-admin/companies/co-7');

        expect(view()).toHaveAttribute('data-company-id', 'co-7');
        expect(view()).toHaveAttribute('data-tab', 'features');
    });

    it('puts the company a row opens into the address; a tab replaces it, so Back leaves the company', () => {
        renderShell('/super-admin/companies?e2eAuth=super_admin');

        fireEvent.click(screen.getByRole('button', { name: 'Open Artificial Carrier 9' }));
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/super-admin\/companies\/co-9\?e2eAuth=super_admin$/);

        fireEvent.click(screen.getByRole('button', { name: 'Show the SMS tab' }));
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/super-admin\/companies\/co-9\/sms\?e2eAuth=super_admin$/);
        expect(view()).toHaveAttribute('data-tab', 'sms');

        fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/super-admin\/companies\?e2eAuth=super_admin$/);
        expect(view()).toHaveAttribute('data-active-view', 'companies');
    });

    it("leaves a company's screen for the list", () => {
        renderShell('/super-admin/companies/co-9');

        fireEvent.click(screen.getByRole('button', { name: 'Back to companies' }));
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/super-admin\/companies$/);
        expect(view()).toHaveAttribute('data-active-view', 'companies');
    });

    it("has the company's screen read it again when its details are saved, and refreshes the lists", () => {
        renderShell('/super-admin/companies/co-9');
        expect(view()).toHaveAttribute('data-revision', '0');

        fireEvent.click(screen.getByRole('button', { name: 'Save company details' }));
        expect(view()).toHaveAttribute('data-revision', '1');
        expect(refreshData).toHaveBeenCalledTimes(1);
    });

    it('opens the dashboard for an address it does not know', () => {
        renderShell('/super-admin/nowhere');
        expect(view()).toHaveAttribute('data-active-view', 'dashboard');
    });
});

describe('Super Admin shell — the addresses of merged screens', () => {
    const view = () => screen.getByTestId('view-router');
    const address = () => screen.getByTestId('address');

    /** The panel at the last of `entries`, with the earlier ones behind it in history. */
    function renderShellAfter(entries) {
        return render(
            <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
                <Routes>
                    <Route path="/super-admin/*" element={<SuperAdminDashboard />} />
                </Routes>
                <AddressProbe />
            </MemoryRouter>,
        );
    }

    it('opens Maintenance from the old Stats Backfill address, keeping the query string', async () => {
        renderShellAfter(['/super-admin/stats-backfill?e2eAuth=super_admin']);

        expect(view()).toHaveAttribute('data-active-view', 'maintenance');
        await waitFor(() => expect(address()).toHaveTextContent(/^\/super-admin\/maintenance\?e2eAuth=super_admin$/));
        const nav = screen.getByRole('navigation', { name: 'Super Admin sections' });
        expect(within(nav).getByRole('button', { name: 'Maintenance' })).toHaveAttribute('aria-current', 'page');
    });

    it('opens the Dashboard from the old Analytics address, keeping the query string', async () => {
        renderShellAfter(['/super-admin/analytics?e2eAuth=super_admin']);

        expect(view()).toHaveAttribute('data-active-view', 'dashboard');
        await waitFor(() => expect(address()).toHaveTextContent(/^\/super-admin\?e2eAuth=super_admin$/));
        const nav = screen.getByRole('navigation', { name: 'Super Admin sections' });
        expect(within(nav).getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
        expect(within(nav).queryByRole('button', { name: 'Analytics' })).not.toBeInTheDocument();
    });

    it('opens the companies list from the old Global Features and SMS Integrations addresses', async () => {
        renderShellAfter(['/super-admin/features?e2eAuth=super_admin']);
        expect(view()).toHaveAttribute('data-active-view', 'companies');
        await waitFor(() => expect(address()).toHaveTextContent(/^\/super-admin\/companies\?e2eAuth=super_admin$/));
    });

    it("opens a company's SMS tab from the old address of its SMS setup", async () => {
        renderShellAfter(['/super-admin/integrations/co-7?e2eAuth=super_admin']);

        expect(view()).toHaveAttribute('data-active-view', 'company');
        expect(view()).toHaveAttribute('data-company-id', 'co-7');
        expect(view()).toHaveAttribute('data-tab', 'sms');
        await waitFor(() => expect(address()).toHaveTextContent(/^\/super-admin\/companies\/co-7\/sms\?e2eAuth=super_admin$/));
    });

    it('replaces the old address rather than stacking one, so Back does not loop', async () => {
        renderShellAfter(['/super-admin/companies?e2eAuth=super_admin', '/super-admin/stats-backfill?e2eAuth=super_admin']);
        await waitFor(() => expect(address()).toHaveTextContent(/^\/super-admin\/maintenance\?e2eAuth=super_admin$/));

        // A push would put the old address behind the new one: Back would land
        // on it and be sent forward to Maintenance again.
        fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
        expect(address()).toHaveTextContent(/^\/super-admin\/companies\?e2eAuth=super_admin$/);
        expect(view()).toHaveAttribute('data-active-view', 'companies');
    });
});
