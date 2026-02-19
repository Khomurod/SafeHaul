// src/features/super-admin/components/ViewRouter.jsx
import React from 'react';

// --- Sibling Components (Same Directory) ---
import { GlobalSearchResults } from './GlobalSearchResults.jsx';
import { DashboardView } from './DashboardView.jsx';
import { CompaniesView } from './CompaniesView.jsx';
import { UsersView } from './UsersView.jsx';
import { BulkLeadAddingView } from './BulkLeadAddingView.jsx';
import { CreateView } from './CreateView.jsx';
import { FeaturesView } from './FeaturesView.jsx';
import { SystemHealthView } from './SystemHealthView.jsx';
import { IntegrationManager } from './integrations/IntegrationManager.jsx';
import StatsBackfillPanel from './StatsBackfillPanel.jsx';
import { LeadPoolView } from './LeadPoolView.jsx';

// --- Views from Parent Directory ---
import { AnalyticsView } from '../views/AnalyticsView.jsx';
import { UnifiedDriverList } from '../views/UnifiedDriverList.jsx';

// --- Form Builder (Super Admin) ---
import { GlobalQuestionsManager } from './GlobalQuestionsManager';

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
        case 'dashboard':
            return (
                <DashboardView
                    stats={stats}
                    statsLoading={listLoading}
                    statsError={statsError}
                />
            );
        case 'analytics':
            return (
                <AnalyticsView />
            );
        case 'lead-pool':
            return (
                <LeadPoolView onDataUpdate={onDataUpdate} />
            );
        case 'companies':
            return (
                <CompaniesView
                    listLoading={listLoading}
                    statsError={statsError}
                    companyList={companyList}
                    onViewApps={onViewApps}
                    onEdit={onEditCompany}
                    onDelete={onDeleteCompany}
                    loadMore={loadMore}
                    hasMore={hasMoreCompanies}
                />
            );
        case 'users':
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
        case 'applications':
            return (
                <UnifiedDriverList
                    allApplications={allApplications}
                    allCompaniesMap={allCompaniesMap}
                    onAppClick={onAppClick}
                    onDataUpdate={onDataUpdate}
                    loadMore={loadMore}
                    hasMore={hasMoreApps}
                />
            );
        case 'features':
            return (
                <FeaturesView
                    companyList={companyList}
                    onDataUpdate={onDataUpdate}
                />
            );
        case 'system-health':
            return (
                <SystemHealthView />
            );
        case 'bulk-lead-adding':
            return (
                <BulkLeadAddingView
                    onDataUpdate={onDataUpdate}
                    onClose={() => setActiveView('dashboard')}
                />
            );
        case 'create':
            return (
                <CreateView
                    allCompaniesMap={allCompaniesMap}
                    onDataUpdate={onDataUpdate}
                />
            );
        case 'integrations':
            return (
                <CompaniesView
                    listLoading={listLoading}
                    statsError={statsError}
                    companyList={companyList}
                    onViewApps={onViewApps}
                    onEdit={onSelectIntegrationCompany} // Use select for integration
                    onDelete={onDeleteCompany}
                    loadMore={loadMore}
                    hasMore={hasMoreCompanies}
                    isIntegrationMode={true} // Add flag for special UI if needed
                />
            );
        case 'integration-setup':
            return (
                <IntegrationManager
                    companyId={selectedIntegrationCompany?.id}
                    companyName={selectedIntegrationCompany?.companyName}
                    onBack={onBackToIntegrations}
                />
            );
        case 'stats-backfill':
            return <StatsBackfillPanel />;
        case 'questions':
            return <GlobalQuestionsManager />;
        default:
            return null;
    }
}