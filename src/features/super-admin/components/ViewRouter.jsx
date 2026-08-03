// src/features/super-admin/components/ViewRouter.jsx
import React from 'react';

// --- Sibling Components (Same Directory) ---
import { GlobalSearchResults } from './GlobalSearchResults.jsx';
import { DashboardView } from './DashboardView.jsx';
import { CompaniesView } from './CompaniesView.jsx';
import { UsersView } from './UsersView.jsx';

import { CreateView } from './CreateView.jsx';
import { FeaturesView } from './FeaturesView.jsx';
import { SystemHealthView } from './SystemHealthView.jsx';
import { IntegrationManager } from './integrations/IntegrationManager.jsx';
import StatsBackfillPanel from './StatsBackfillPanel.jsx';


// --- Views from Parent Directory ---
import { AnalyticsView } from '../views/AnalyticsView.jsx';
import { UnifiedDriverList } from '../views/UnifiedDriverList.jsx';
import { EnvironmentIntegrationsView } from '../views/EnvironmentIntegrationsView.jsx';
import { AiIntegrationsView } from '../views/AiIntegrationsView.jsx';
import { BlogPostsView } from '../views/BlogPostsView.jsx';

// --- Form Builder (Super Admin) ---
import { GlobalQuestionsManager } from './GlobalQuestionsManager';
import { SUPER_ADMIN_VIEWS } from '../config/views';

export function ViewRouter({
    isSearching,
    activeView,
    setActiveView,
    // Data Props
    searchResults,
    totalSearchResults,
    allCompaniesMap,
    stats,
    statsError,
    listLoading,
    companyList,
    userList,
    allApplications,
    // Handlers
    onViewApps,
    onEditCompany,
    onEditUser,
    onAppClick,
    onDeleteCompany,
    onDeleteUser,
    onDataUpdate,
    loadMore,
    loadingMore = { companies: false, applications: false },
    hasMoreCompanies,
    hasMoreApps,
    // Integration Specific
    selectedIntegrationCompany,
    onSelectIntegrationCompany,
    onBackToIntegrations
}) {

    if (isSearching) {
        return (
            <GlobalSearchResults
                results={searchResults}
                totalResults={totalSearchResults}
                allCompaniesMap={allCompaniesMap}
                onViewApps={onViewApps}
                onEditCompany={onEditCompany}
                onEditUser={onEditUser}
                onAppClick={onAppClick}
            />
        );
    }

    switch (activeView) {
        case SUPER_ADMIN_VIEWS.DASHBOARD:
            return (
                <DashboardView
                    stats={stats}
                    statsLoading={listLoading}
                    statsError={statsError}
                />
            );
        case SUPER_ADMIN_VIEWS.ANALYTICS:
            return (
                <AnalyticsView />
            );

        case SUPER_ADMIN_VIEWS.COMPANIES:
            return (
                <CompaniesView
                    listLoading={listLoading}
                    statsError={statsError}
                    companyList={companyList}
                    onViewApps={onViewApps}
                    onEdit={onEditCompany}
                    onDelete={onDeleteCompany}
                    loadMore={loadMore}
                    isLoadingMore={loadingMore.companies}
                    hasMore={hasMoreCompanies}
                />
            );
        case SUPER_ADMIN_VIEWS.USERS:
            return (
                <UsersView
                    listLoading={listLoading}
                    statsError={statsError}
                    userList={userList}
                    allCompaniesMap={allCompaniesMap}
                    onEdit={onEditUser}
                    onDelete={onDeleteUser}
                />
            );
        case SUPER_ADMIN_VIEWS.APPLICATIONS:
            return (
                <UnifiedDriverList
                    allApplications={allApplications}
                    allCompaniesMap={allCompaniesMap}
                    onAppClick={onAppClick}
                    onDataUpdate={onDataUpdate}
                    loadMore={loadMore}
                    isLoadingMore={loadingMore.applications}
                    hasMore={hasMoreApps}
                />
            );
        case SUPER_ADMIN_VIEWS.FEATURES:
            return (
                <FeaturesView
                    companyList={companyList}
                    onDataUpdate={onDataUpdate}
                />
            );
        case SUPER_ADMIN_VIEWS.SYSTEM_HEALTH:
            return (
                <SystemHealthView />
            );

        case SUPER_ADMIN_VIEWS.CREATE:
            return (
                <CreateView
                    allCompaniesMap={allCompaniesMap}
                    onDataUpdate={onDataUpdate}
                    setActiveView={setActiveView}
                />
            );
        case SUPER_ADMIN_VIEWS.INTEGRATIONS:
            return (
                <CompaniesView
                    listLoading={listLoading}
                    statsError={statsError}
                    companyList={companyList}
                    onViewApps={onViewApps}
                    onEdit={onSelectIntegrationCompany} // Use select for integration
                    onDelete={onDeleteCompany}
                    loadMore={loadMore}
                    isLoadingMore={loadingMore.companies}
                    hasMore={hasMoreCompanies}
                    isIntegrationMode={true} // Add flag for special UI if needed
                />
            );
        case SUPER_ADMIN_VIEWS.INTEGRATION_SETUP:
            return (
                <IntegrationManager
                    companyId={selectedIntegrationCompany?.id}
                    companyName={selectedIntegrationCompany?.companyName}
                    onBack={onBackToIntegrations}
                />
            );
        case SUPER_ADMIN_VIEWS.ENVIRONMENT:
            return <EnvironmentIntegrationsView />;
        case SUPER_ADMIN_VIEWS.AI_INTEGRATIONS:
            return <AiIntegrationsView />;
        case SUPER_ADMIN_VIEWS.BLOG_POSTS:
            return <BlogPostsView />;
        case SUPER_ADMIN_VIEWS.STATS_BACKFILL:
            return <StatsBackfillPanel />;
        case SUPER_ADMIN_VIEWS.QUESTIONS:
            return <GlobalQuestionsManager />;
        default:
            return null;
    }
}
