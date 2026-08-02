/**
 * Contract freeze + defect proof for the Super Admin shell
 * (`SuperAdminDashboard`, `DashboardHeader`, `SuperAdminSidebar`).
 *
 * The shell owns a maintenance action that writes to live data across every
 * company, so the callable name, timeout and payload are frozen here before any
 * presentation change. The rest proves the accessibility defects the migration
 * set out to fix are actually fixed:
 *  - the global search input had no label,
 *  - the clear-search control had no accessible name,
 *  - the nav had no accessible name and signalled the active view by colour only,
 *  - the backfill was guarded by a blocking `window.confirm` and reported by a
 *    blocking `alert()`.
 *
 * All company/user names below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    ViewRouter: ({ activeView, isSearching }) => (
        <div data-testid="view-router" data-active-view={activeView} data-searching={String(isSearching)} />
    ),
}));
vi.mock('./DashboardModals', () => ({ DashboardModals: () => null }));

import { SuperAdminDashboard } from './SuperAdminDashboard';

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

describe('Super Admin shell — frozen maintenance contract', () => {
    it('calls backfillEmployerFields with the exact name, timeout and payload', async () => {
        const backfillFn = vi.fn().mockResolvedValue({ data: { message: 'done', stats: {} } });
        httpsCallable.mockReturnValue(backfillFn);

        render(<SuperAdminDashboard />);
        fireEvent.click(screen.getByRole('button', { name: /Backfill Employers/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));

        await waitFor(() => expect(backfillFn).toHaveBeenCalled());
        expect(httpsCallable).toHaveBeenCalledWith(
            { __functions: true },
            'backfillEmployerFields',
            { timeout: 540000 },
        );
        expect(backfillFn).toHaveBeenCalledWith({ dryRun: false });
    });

    it('does not run the backfill unless the confirmation is accepted', async () => {
        const backfillFn = vi.fn().mockResolvedValue({ data: { message: 'done', stats: {} } });
        httpsCallable.mockReturnValue(backfillFn);

        render(<SuperAdminDashboard />);
        fireEvent.click(screen.getByRole('button', { name: /Backfill Employers/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

        expect(backfillFn).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps the toast + refresh sequence on success', async () => {
        const backfillFn = vi.fn().mockResolvedValue({
            data: { message: 'Backfill complete', stats: { totalDocs: 9, updatedDocs: 4, skippedDocs: 5, errorDocs: 0 } },
        });
        httpsCallable.mockReturnValue(backfillFn);

        render(<SuperAdminDashboard />);
        fireEvent.click(screen.getByRole('button', { name: /Backfill Employers/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));

        await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('Backfill complete'));
        expect(showInfo).toHaveBeenCalledWith('Running employer field backfill... this may take a few minutes.');
        expect(refreshData).toHaveBeenCalled();
    });

    it('reports failures through the error toast rather than throwing', async () => {
        httpsCallable.mockReturnValue(vi.fn().mockRejectedValue(new Error('nope')));

        render(<SuperAdminDashboard />);
        fireEvent.click(screen.getByRole('button', { name: /Backfill Employers/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));

        await waitFor(() => expect(showError).toHaveBeenCalledWith('Employer backfill failed: nope'));
    });
});

describe('Super Admin shell — blocking dialogs replaced (defect)', () => {
    it('never calls window.confirm or window.alert', async () => {
        // jsdom does not implement `confirm`/`alert`, so install stubs rather than
        // spy on them. If the shell ever reintroduces a blocking dialog these fire.
        const confirmSpy = vi.fn(() => true);
        const alertSpy = vi.fn();
        vi.stubGlobal('confirm', confirmSpy);
        vi.stubGlobal('alert', alertSpy);
        httpsCallable.mockReturnValue(
            vi.fn().mockResolvedValue({ data: { message: 'ok', stats: { totalDocs: 1 } } }),
        );

        render(<SuperAdminDashboard />);
        fireEvent.click(screen.getByRole('button', { name: /Backfill Employers/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));

        await screen.findByText('Employer backfill report');
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(alertSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('returns focus to the Backfill trigger after the report is closed', async () => {
        httpsCallable.mockReturnValue(vi.fn().mockResolvedValue({
            data: { message: 'ok', stats: { totalDocs: 3 } },
        }));

        render(<SuperAdminDashboard />);
        const trigger = screen.getByRole('button', { name: /Backfill Employers/i });
        trigger.focus();
        fireEvent.click(trigger);
        fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));

        await screen.findByText('Employer backfill report');
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        // The confirmation cannot hand focus back itself: confirming disables the
        // trigger and unmounts the dialog in the same commit, so its restore
        // targets a disabled button and lands on <body>. Without the explicit
        // hand-back, a keyboard user ends the flow at the top of the page.
        await waitFor(() => {
            expect(document.activeElement).toBe(
                screen.getByRole('button', { name: /Backfill Employers/i }),
            );
        });
    });

    it('presents the confirmation as a real dialog with an accessible name', async () => {
        render(<SuperAdminDashboard />);
        fireEvent.click(screen.getByRole('button', { name: /Backfill Employers/i }));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(within(dialog).getByText('Run employer field backfill?')).toBeInTheDocument();
    });

    it('shows the same four counters the alert() used to print', async () => {
        httpsCallable.mockReturnValue(vi.fn().mockResolvedValue({
            data: { message: 'ok', stats: { totalDocs: 12, updatedDocs: 7, skippedDocs: 4, errorDocs: 1 } },
        }));

        render(<SuperAdminDashboard />);
        fireEvent.click(screen.getByRole('button', { name: /Backfill Employers/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));

        const report = await screen.findByRole('dialog');
        expect(within(report).getByText('Total applications').nextSibling).toHaveTextContent('12');
        expect(within(report).getByText('Updated').nextSibling).toHaveTextContent('7');
        expect(within(report).getByText('Already correct').nextSibling).toHaveTextContent('4');
        expect(within(report).getByText('Errors').nextSibling).toHaveTextContent('1');
    });
});

describe('Super Admin shell — header accessibility (defects)', () => {
    it('gives the global search box an accessible name', () => {
        render(<SuperAdminDashboard />);
        expect(
            screen.getByRole('searchbox', { name: /Search companies, users and driver applications/i }),
        ).toBeInTheDocument();
    });

    it('names the clear-search control', () => {
        superAdminData = makeData({ searchQuery: 'acme' });
        render(<SuperAdminDashboard />);
        expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    });

    it('keeps the logout hook and its stable id', () => {
        render(<SuperAdminDashboard />);
        const logout = screen.getByRole('button', { name: /Logout|Log out/i });
        expect(logout).toHaveAttribute('id', 'logout-button-super');
        fireEvent.click(logout);
        expect(handleLogout).toHaveBeenCalled();
    });
});

describe('Super Admin shell — navigation (defects)', () => {
    it('names the section navigation landmark', () => {
        render(<SuperAdminDashboard />);
        expect(screen.getByRole('navigation', { name: 'Super Admin sections' })).toBeInTheDocument();
    });

    it('marks the active view with aria-current, not colour alone', () => {
        render(<SuperAdminDashboard />);
        const nav = screen.getByRole('navigation', { name: 'Super Admin sections' });
        expect(within(nav).getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
        expect(within(nav).getByRole('button', { name: 'Companies' })).not.toHaveAttribute('aria-current');
    });

    it('routes to the exact SUPER_ADMIN_VIEWS value for each nav item', () => {
        render(<SuperAdminDashboard />);
        const nav = screen.getByRole('navigation', { name: 'Super Admin sections' });

        fireEvent.click(within(nav).getByRole('button', { name: 'Unified Driver DB' }));
        expect(screen.getByTestId('view-router')).toHaveAttribute('data-active-view', 'applications');

        fireEvent.click(within(nav).getByRole('button', { name: 'SMS Integrations' }));
        expect(screen.getByTestId('view-router')).toHaveAttribute('data-active-view', 'integrations');

        fireEvent.click(within(nav).getByRole('button', { name: 'Form Builder' }));
        expect(screen.getByTestId('view-router')).toHaveAttribute('data-active-view', 'questions');
    });

    it('clears the search query when a section is chosen', () => {
        const setSearchQuery = vi.fn();
        superAdminData = makeData({ searchQuery: 'acme', setSearchQuery });
        render(<SuperAdminDashboard />);

        fireEvent.click(screen.getByRole('button', { name: 'Companies' }));
        expect(setSearchQuery).toHaveBeenCalledWith('');
    });

    it('exposes the search state to the router so results replace the active view', () => {
        superAdminData = makeData({ searchQuery: 'acme' });
        render(<SuperAdminDashboard />);
        expect(screen.getByTestId('view-router')).toHaveAttribute('data-searching', 'true');
    });
});
