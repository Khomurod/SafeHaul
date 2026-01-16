import React, { useState } from 'react';
import { useData } from '@/context/DataContext';
import { db, functions } from '@lib/firebase';
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from 'firebase/firestore';
import { useSuperAdminData } from '../hooks/useSuperAdminData';
import { useToast } from '@shared/components/feedback';
import { SuperAdminSidebar } from './SuperAdminSidebar.jsx';
import { DashboardHeader } from './DashboardHeader';
import { ViewRouter } from './ViewRouter';
import { DashboardModals } from './DashboardModals';

export function SuperAdminDashboard() {
  const { handleLogout } = useData();
  const { showSuccess, showError, showInfo } = useToast();
  const [activeView, setActiveView] = useState('dashboard');

  const {
    searchResults,
    totalSearchResults,
    refreshData,
    loadMore,
    hasMoreCompanies,
    hasMoreApps,
    searchQuery,
    setSearchQuery,
    // Fix: Destructure missing variables used in render
    allCompaniesMap,
    stats,
    statsError,
    loading: listLoading,
    companyList,
    userList,
    allApplications
  } = useSuperAdminData();

  const [editingCompanyDoc, setEditingCompanyDoc] = useState(null);
  const [deletingCompany, setDeletingCompany] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);
  const [viewingCompanyApps, setViewingCompanyApps] = useState(null);
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [selectedIntegrationCompany, setSelectedIntegrationCompany] = useState(null);

  const [distributing, setDistributing] = useState(false);
  const [fixingData, setFixingData] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const isSearching = searchQuery.length > 0;

  const onModalClose = () => {
    setEditingCompanyDoc(null);
    setDeletingCompany(null);
    setEditingUser(null);
    setDeletingUser(null);
    setViewingCompanyApps(null);
    setSelectedApplication(null);
  };

  const openEditCompany = async (companyId) => {
    try {
      const companyDoc = await getDoc(doc(db, 'companies', companyId));
      if (companyDoc.exists()) setEditingCompanyDoc(companyDoc);
    } catch (error) {
      console.error("Error opening edit company:", error);
      showError("Could not load company details.");
    }
  };

  const handleAppClick = (app) => {
    setSelectedApplication({
      companyId: app.companyId,
      appId: app.id,
    });
  };

  const handlePhoneClick = (e, item) => {
    if (e) e.stopPropagation();
    if (item && item.phone) {
      window.location.href = `tel:${item.phone}`;
    } else {
      showError("No phone number available for this driver.");
    }
  };

  const handleDistributeLeads = async () => {
    if (!window.confirm("Are you sure you want to distribute daily leads? This will FORCE ROTATE current leads.")) return;

    setDistributing(true);
    showInfo("Distribution started. This may take a few minutes...");

    try {
      // FIX: Added timeout option (600,000ms = 10 minutes) to prevent "deadline-exceeded"
      const distribute = httpsCallable(functions, 'distributeDailyLeads', { timeout: 600000 });
      const result = await distribute();
      const details = result.data.details || [];
      const detailMsg = details.length > 0 ? details.join('\n') : "Distribution complete.";

      console.log("Distribution Result:", result.data);
      showSuccess(`Success! Check console for details.`);
      alert("Distribution Report:\n" + detailMsg);

      refreshData();
    } catch (e) {
      console.error("Distribution Failed:", e);
      showError("Error distributing leads: " + e.message);
    } finally {
      setDistributing(false);
    }
  };

  const handleFixData = async () => {
    if (!window.confirm("Run database migration to copy DRIVERS to LEADS? This is required if the pool is empty.")) return;

    setFixingData(true);
    showInfo("Starting migration... this may take a moment.");

    try {
      const fixFn = httpsCallable(functions, 'migrateDriversToLeads', { timeout: 540000 });
      const result = await fixFn();
      showSuccess(result.data.message);
      refreshData();
    } catch (e) {
      console.error("Migration Failed:", e);
      showError("Migration failed: " + e.message);
    } finally {
      setFixingData(false);
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    showInfo("Purging trash leads...");

    try {
      const cleanupFn = httpsCallable(functions, 'cleanupBadLeads', { timeout: 540000 });
      const result = await cleanupFn();
      showSuccess(result.data.message);
      refreshData();
    } catch (e) {
      console.error("Cleanup Failed:", e);
      showError("Cleanup failed: " + e.message);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <>
      <div id="super-admin-container" className="min-h-screen bg-gray-50">

        <DashboardHeader
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onDistribute={handleDistributeLeads}
          distributing={distributing}
          onFixData={handleFixData}
          fixingData={fixingData}
          onCleanup={handleCleanup}
          cleaning={cleaning}
          onLogout={handleLogout}
        />

        <div className="container mx-auto p-4 sm:p-8 flex gap-8 items-start">

          <SuperAdminSidebar
            activeView={activeView}
            setActiveView={setActiveView}
            isSearching={isSearching}
            onClearSearch={() => setSearchQuery('')}
          />

          <main className="flex-1 w-full min-w-0">
            <ViewRouter
              isSearching={isSearching}
              activeView={activeView}
              setActiveView={setActiveView}
              searchResults={searchResults}
              totalSearchResults={totalSearchResults}
              allCompaniesMap={allCompaniesMap}
              selectedIntegrationCompany={selectedIntegrationCompany}
              onSelectIntegrationCompany={(company) => {
                setSelectedIntegrationCompany(company);
                setActiveView('integration-setup');
              }}
              onBackToIntegrations={() => {
                setSelectedIntegrationCompany(null);
                setActiveView('integrations');
              }}
              stats={stats}
              statsError={statsError}
              listLoading={listLoading}
              companyList={companyList}
              userList={userList}
              allApplications={allApplications}
              onViewApps={setViewingCompanyApps}
              onEditCompany={openEditCompany}
              onEditUser={setEditingUser}
              onAppClick={handleAppClick}
              onDeleteCompany={setDeletingCompany}
              onDeleteUser={setDeletingUser}
              onDataUpdate={refreshData}
              loadMore={loadMore}
              hasMoreCompanies={hasMoreCompanies}
              hasMoreApps={hasMoreApps}
            />
          </main>
        </div>
      </div>

      <DashboardModals
        editingCompanyDoc={editingCompanyDoc}
        deletingCompany={deletingCompany}
        editingUser={editingUser}
        deletingUser={deletingUser}
        viewingCompanyApps={viewingCompanyApps}
        selectedApplication={selectedApplication}
        allCompaniesMap={allCompaniesMap}
        onClose={onModalClose}
        onRefreshData={refreshData}
        onPhoneClick={handlePhoneClick}
      />
    </>
  );
}