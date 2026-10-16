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
    ViewRouter: ({ activeView, isSearching, selectedIntegrationCompany, onSelectIntegrationCompany, onBackToIntegrations }) => (
        <div
            data-testid="view-router"
            data-active-view={activeView}
            data-searching={String(isSearching)}
            data-company-id={selectedIntegrationCompany?.id ?? ''}
            data-picked-name={selectedIntegrationCompany?.picked?.companyName ?? ''}
        >
            <button type="button" onClick={() => onSelectIntegrationCompany({ id: 'co-9', companyName: 'Artificial Carrier 9' })}>
                Set up SMS for Artificial Carrier 9
            </button>
            <button type="button" onClick={onBackToIntegrations}>Back to SMS integrations</button>
        </div>
    ),
}));
vi.mock('./DashboardModals', () => ({ DashboardModals: () => null }));

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

        fireEvent.click(within(nav).getByRole('button', { name: 'SMS Integrations' }));
        expect(screen.getByTestId('view-router')).toHaveAttribute('data-active-view', 'integrations');

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

    it("reopens a company's SMS setup from its address, for the setup to read the company", () => {
        renderShell('/super-admin/integrations/co-7');

        expect(view()).toHaveAttribute('data-active-view', 'integration-setup');
        expect(view()).toHaveAttribute('data-company-id', 'co-7');
        expect(view()).toHaveAttribute('data-picked-name', '');
    });

    it('puts the SMS setup a row opens into the address, and leaves it for the list', () => {
        renderShell('/super-admin/integrations');

        fireEvent.click(screen.getByRole('button', { name: 'Set up SMS for Artificial Carrier 9' }));
        expect(screen.getByTestId('address')).toHaveTextContent('/super-admin/integrations/co-9');
        expect(view()).toHaveAttribute('data-picked-name', 'Artificial Carrier 9');

        fireEvent.click(screen.getByRole('button', { name: 'Back to SMS integrations' }));
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/super-admin\/integrations$/);
        expect(view()).toHaveAttribute('data-active-view', 'integrations');
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
