/**
 * The view router hands each list the console's loading state. The Unified
 * Driver DB was given none, so while the records loaded it said "No drivers
 * match your filters." instead of loading.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const unifiedProps = vi.hoisted(() => ({ current: null }));

vi.mock('./GlobalSearchResults.jsx', () => ({ GlobalSearchResults: () => null }));
vi.mock('./DashboardView.jsx', () => ({ DashboardView: () => null }));
vi.mock('./CompaniesView.jsx', () => ({ CompaniesView: () => null }));
vi.mock('./UsersView.jsx', () => ({ UsersView: () => null }));
vi.mock('./CreateView.jsx', () => ({ CreateView: () => null }));
vi.mock('./FeaturesView.jsx', () => ({ FeaturesView: () => null }));
vi.mock('./SystemHealthView.jsx', () => ({ SystemHealthView: () => null }));
vi.mock('./integrations/IntegrationManager.jsx', () => ({ IntegrationManager: () => null }));
vi.mock('./StatsBackfillPanel.jsx', () => ({ default: () => null }));
vi.mock('./GlobalQuestionsManager', () => ({ GlobalQuestionsManager: () => null }));
vi.mock('../views/AnalyticsView.jsx', () => ({ AnalyticsView: () => null }));
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
});
