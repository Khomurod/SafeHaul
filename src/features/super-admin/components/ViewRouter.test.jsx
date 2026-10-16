/**
 * The view router hands each list the console's loading state. The Unified
 * Driver DB was given none, so while the records loaded it said "No drivers
 * match your filters." instead of loading.
 *
 * A company's SMS setup opens from its address too, so the router opens it
 * only for a company that exists: the form saves under the company's path.
 *
 * The Maintenance page's employer backfill refreshes the console's lists when it
 * finishes, as it did from the masthead, so the router hands it the refresh.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const unifiedProps = vi.hoisted(() => ({ current: null }));
const maintenanceProps = vi.hoisted(() => ({ current: null }));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: () => ({}),
    getDoc: () => Promise.resolve({ exists: () => false }),
}));

vi.mock('./GlobalSearchResults.jsx', () => ({ GlobalSearchResults: () => null }));
vi.mock('./DashboardView.jsx', () => ({ DashboardView: () => null }));
vi.mock('./CompaniesView.jsx', () => ({ CompaniesView: () => null }));
vi.mock('./UsersView.jsx', () => ({ UsersView: () => null }));
vi.mock('./CreateView.jsx', () => ({ CreateView: () => null }));
vi.mock('./FeaturesView.jsx', () => ({ FeaturesView: () => null }));
vi.mock('./SystemHealthView.jsx', () => ({ SystemHealthView: () => null }));
vi.mock('./integrations/IntegrationManager.jsx', () => ({
    IntegrationManager: ({ companyId }) => <p>{`SMS setup form for ${companyId}`}</p>,
}));
vi.mock('./MaintenanceView.jsx', () => ({
    MaintenanceView: (props) => { maintenanceProps.current = props; return <h2>Maintenance</h2>; },
}));
vi.mock('../views/UnifiedDriverList.jsx', () => ({
    UnifiedDriverList: (props) => { unifiedProps.current = props; return null; },
}));
vi.mock('../views/EnvironmentIntegrationsView.jsx', () => ({ EnvironmentIntegrationsView: () => null }));
vi.mock('../views/AiIntegrationsView.jsx', () => ({ AiIntegrationsView: () => null }));
vi.mock('../views/BlogPostsView.jsx', () => ({ BlogPostsView: () => null }));
vi.mock('../views/WebsiteLeadsView.jsx', () => ({ WebsiteLeadsView: () => null }));
vi.mock('../views/ReleaseManagementView.jsx', () => ({ ReleaseManagementView: () => null }));

import { ViewRouter } from './ViewRouter';
import { SUPER_ADMIN_VIEWS } from '../config/views';

describe('ViewRouter', () => {
    it.each([true, false])('tells the Unified Driver DB whether the records are loading (%s)', (listLoading) => {
        render(<ViewRouter activeView={SUPER_ADMIN_VIEWS.APPLICATIONS} listLoading={listLoading} allApplications={[]} />);
        expect(unifiedProps.current.isLoading).toBe(listLoading);
    });

    it('opens the Maintenance page with the console refresh the employer backfill calls', () => {
        const refresh = vi.fn();
        render(<ViewRouter activeView={SUPER_ADMIN_VIEWS.MAINTENANCE} onDataUpdate={refresh} />);

        expect(screen.getByRole('heading', { name: 'Maintenance' })).toBeInTheDocument();
        expect(maintenanceProps.current.onDataUpdate).toBe(refresh);
    });

    it('opens no SMS setup form for an address whose company does not exist', async () => {
        render(
            <ViewRouter
                activeView={SUPER_ADMIN_VIEWS.INTEGRATION_SETUP}
                selectedIntegrationCompany={{ id: 'co-gone', picked: null }}
                onBackToIntegrations={() => {}}
            />,
        );

        expect(await screen.findByRole('heading', { name: 'Company not found' })).toBeInTheDocument();
        expect(screen.queryByText(/SMS setup form/)).not.toBeInTheDocument();
    });
});
