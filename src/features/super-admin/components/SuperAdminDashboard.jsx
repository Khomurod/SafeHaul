import React, { useCallback, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { db } from '@lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useSuperAdminData } from '../hooks/useSuperAdminData';
import { useToast } from '@shared/components/feedback';
import { SuperAdminSidebar } from './SuperAdminSidebar.jsx';
import { DashboardHeader } from './DashboardHeader';
import { ViewRouter } from './ViewRouter';
import { DashboardModals } from './DashboardModals';
import {
  SUPER_ADMIN_VIEWS,
  superAdminMovedPath,
  superAdminPathFor,
  superAdminViewFromPath,
} from '../config/views';

export function SuperAdminDashboard() {
  const { handleLogout } = useData();
  const { showError } = useToast();
  const navigate = useNavigate();
  const { search } = useLocation();
  // The screen is in the address (`config/views.js`): a reload, Back and a
  // shared link keep it. Choosing one adds a history entry, and keeps the query
  // string, which is how the browser tests sign in.
  const subPath = useParams()['*'];
  const { view: activeView, companyId, tab: companyTab } = superAdminViewFromPath(subPath);
  // A merged screen's old address opens the screen that holds it now (above),
  // and is replaced by that screen's address, so Back does not return to it.
  const movedTo = superAdminMovedPath(subPath);
  const setActiveView = useCallback((view, id = null, tab = null, replace = false) => {
    navigate({ pathname: superAdminPathFor(view, id, tab), search }, { replace });
  }, [navigate, search]);

  const {
    searchResults,
    totalSearchResults,
    refreshData,
    loadMore,
    loadingMore,
    hasMoreCompanies,
    hasMoreUsers,
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
  // A company's screen reads it again when its details are saved here.
  const [companyRevision, setCompanyRevision] = useState(0);
  const refreshAfterEdit = useCallback(() => {
    refreshData();
    setCompanyRevision((revision) => revision + 1);
  }, [refreshData]);

  const isSearching = searchQuery.length > 0;
  const selectedCompany = companyId ? { id: companyId, tab: companyTab } : null;

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

  return (
    <>
      {movedTo && <Navigate replace to={{ pathname: movedTo, search }} />}

      <div id="super-admin-container" className="min-h-screen bg-ds-canvas">

        <DashboardHeader
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
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
              selectedCompany={selectedCompany}
              companyRevision={companyRevision}
              onOpenCompany={(company) => setActiveView(SUPER_ADMIN_VIEWS.COMPANY, company.id)}
              // A tab is a place on the same screen: it replaces the address, so
              // Back leaves the company rather than walking its tabs.
              onCompanyTab={(tab) => setActiveView(SUPER_ADMIN_VIEWS.COMPANY, companyId, tab, true)}
              onBackToCompanies={() => setActiveView(SUPER_ADMIN_VIEWS.COMPANIES)}
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
              hasMoreUsers={hasMoreUsers}
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
        onRefreshData={refreshAfterEdit}
      />
    </>
  );
}
