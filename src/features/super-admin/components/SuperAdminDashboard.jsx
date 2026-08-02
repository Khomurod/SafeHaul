import React, { useEffect, useRef, useState } from 'react';
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
import {
  BackfillEmployersConfirmDialog,
  BackfillEmployersResultDialog,
} from './BackfillEmployersDialogs';
import { SUPER_ADMIN_VIEWS } from '../config/views';

export function SuperAdminDashboard() {
  const { handleLogout } = useData();
  const { showSuccess, showError, showInfo } = useToast();
  const [activeView, setActiveView] = useState(SUPER_ADMIN_VIEWS.DASHBOARD);

  const {
    searchResults,
    totalSearchResults,
    refreshData,
    loadMore,
    loadingMore,
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

  const [backfillingEmployers, setBackfillingEmployers] = useState(false);
  const [confirmingBackfill, setConfirmingBackfill] = useState(false);
  const [backfillReport, setBackfillReport] = useState(null);
  // The backfill spans two dialogs, and the shared Modal's own focus restoration
  // cannot bridge them: confirming disables the trigger (`loading`) *and*
  // unmounts the confirmation, so the confirmation restores focus to a disabled
  // button — which silently lands on <body>. The result dialog then captures
  // <body> as its "previously focused" element, and closing the report drops a
  // keyboard user at the top of the page. Holding the trigger ourselves lets us
  // put focus back where it started once the whole flow ends.
  const backfillTriggerRef = useRef(null);
  const restoreFocusAfterReport = useRef(false);

  // Deliberately an effect rather than a call inside the dialog's `onClose`:
  // the closing Modal restores focus in its own unmount cleanup, which runs
  // *after* the click handler, so focusing there would just be overwritten.
  // A parent effect runs after that cleanup, so this wins.
  useEffect(() => {
    if (!backfillReport && restoreFocusAfterReport.current) {
      restoreFocusAfterReport.current = false;
      backfillTriggerRef.current?.focus();
    }
  }, [backfillReport]);

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

  // The blocking `window.confirm` guard is now an accessible confirmation dialog;
  // the callable payload, timeout, toasts and refresh below are unchanged.
  const runBackfillEmployers = async () => {
    setConfirmingBackfill(false);
    setBackfillingEmployers(true);
    showInfo("Running employer field backfill... this may take a few minutes.");

    try {
      const backfillFn = httpsCallable(functions, 'backfillEmployerFields', { timeout: 540000 });
      const result = await backfillFn({ dryRun: false });
      const stats = result.data.stats || {};
      showSuccess(result.data.message);
      // Was a blocking `alert()`; the same four counters now render in a dialog.
      setBackfillReport(stats);
      refreshData();
    } catch (e) {
      console.error("Employer Backfill Failed:", e);
      showError("Employer backfill failed: " + e.message);
    } finally {
      setBackfillingEmployers(false);
    }
  };

  return (
    <>
      <div id="super-admin-container" className="min-h-screen bg-ds-canvas">

        <DashboardHeader
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onBackfillEmployers={() => setConfirmingBackfill(true)}
          backfillTriggerRef={backfillTriggerRef}
          backfillingEmployers={backfillingEmployers}
          onLogout={handleLogout}
        />

        {/* `flex-col` below `sm` so the nav rail and the main region stack instead
            of competing for width — the old always-row layout overflowed on phones. */}
        <div className="container mx-auto flex flex-col items-start gap-ds-8 p-ds-4 sm:flex-row sm:p-ds-8">

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
                setActiveView(SUPER_ADMIN_VIEWS.INTEGRATION_SETUP);
              }}
              onBackToIntegrations={() => {
                setSelectedIntegrationCompany(null);
                setActiveView(SUPER_ADMIN_VIEWS.INTEGRATIONS);
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
              loadingMore={loadingMore}
              hasMoreCompanies={hasMoreCompanies}
              hasMoreApps={hasMoreApps}
            />
          </main>
        </div>
      </div>

      {confirmingBackfill && (
        <BackfillEmployersConfirmDialog
          onConfirm={runBackfillEmployers}
          onCancel={() => setConfirmingBackfill(false)}
        />
      )}

      {backfillReport && (
        <BackfillEmployersResultDialog
          stats={backfillReport}
          onClose={() => {
            // By now `backfillingEmployers` is false, so the trigger is
            // focusable again and this is the end of the flow.
            restoreFocusAfterReport.current = true;
            setBackfillReport(null);
          }}
        />
      )}

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
