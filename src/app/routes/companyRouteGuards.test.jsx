/**
 * The admin-only guard belongs to the page, not to its menu item.
 *
 * These render the app's real routes (`AppRoutes`, built from the real
 * `companyChildRouteDefs`) with each screen replaced by a line of text, so what
 * is proven is the wiring: an `adminOnly` page is behind `CompanyAdminRoute`
 * whether or not the menu has an item for it. Import Leads has none since the
 * Leads page's header offers it.
 *
 * All ids below are artificial.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ data: {} }));

vi.mock('@/context/DataContext', () => ({
    DataProvider: ({ children }) => children,
    useData: () => fx.data,
}));
vi.mock('@app/routes/featureRegistry', async (importOriginal) => {
    const actual = await importOriginal();
    const { Outlet } = await import('react-router-dom');
    const page = (text) => function StubScreen() { return <p>{text}</p>; };
    return {
        ...actual,
        // Only the screens these routes need; App skips a route without one.
        featureScreens: {
            companyAppShell: () => <Outlet />,
            companyAdminDashboard: page('Dashboard page'),
            importLeadsPage: page('Import Leads page'),
            quickAddLeadPage: page('Add lead page'),
            companySettings: page('Settings page'),
        },
    };
});

import { AppRoutes } from '@/App';
import { COMPANY_ROUTE_MANIFEST } from './companyRouteManifest';

const COMPANY_ID = 'artificial-company-1';

function openAs(role, path) {
    fx.data = {
        currentUser: { uid: `artificial-${role}` },
        userRole: role,
        currentUserClaims: { roles: { [COMPANY_ID]: role } },
        currentCompanyProfile: { id: COMPANY_ID },
    };
    render(
        <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
        </MemoryRouter>,
    );
}

describe('an admin-only company page opened by its address', () => {
    it.each([
        ['recruiter', '/company/import-leads'],
        ['hr_user', '/company/import-leads'],
        ['recruiter', '/company/settings'],
    ])('sends a %s who opens %s to the dashboard', async (role, path) => {
        openAs(role, path);

        expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
        expect(screen.queryByText('Import Leads page')).not.toBeInTheDocument();
        expect(screen.queryByText('Settings page')).not.toBeInTheDocument();
    });

    it('opens for a company admin', async () => {
        openAs('company_admin', '/company/import-leads');
        expect(await screen.findByText('Import Leads page')).toBeInTheDocument();
    });

    it('keeps its guard with no menu item: Import Leads has none', () => {
        const importLeads = COMPANY_ROUTE_MANIFEST.find((route) => route.id === 'importLeads');
        expect(importLeads.nav).toBeUndefined();
        expect(importLeads.adminOnly).toBe(true);
    });
});

describe('Add lead', () => {
    it('opens for a recruiter, whose lead is assigned to them', async () => {
        openAs('recruiter', '/company/quick-add-lead');
        expect(await screen.findByText('Add lead page')).toBeInTheDocument();
    });
});
