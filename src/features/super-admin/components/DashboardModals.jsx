import React from 'react';
import {
    EditCompanyModal,
    EditUserModal,
    ViewCompanyAppsModal,
    DeleteCompanyModal,
    DeleteUserModal
} from './modals';
import { ApplicationDetailViewV2 } from '@features/company-admin/components/application-v2';

export function DashboardModals({
    // Modal States
    editingCompanyDoc,
    deletingCompany,
    editingUser,
    deletingUser,
    viewingCompanyApps,
    selectedApplication,
    // Data Dependencies
    allCompaniesMap,
    // Handlers
    onClose,
    onRefreshData,
    onPhoneClick
}) {
    return (
        <>
            {editingCompanyDoc && (
                <EditCompanyModal
                    companyDoc={editingCompanyDoc}
                    onClose={onClose}
                    onSave={onRefreshData}
                />
            )}

            {deletingCompany && (
                <DeleteCompanyModal
                    companyId={deletingCompany.id}
                    companyName={deletingCompany.name}
                    onClose={onClose}
                    onConfirm={onRefreshData}
                />
            )}

            {editingUser && (
                <EditUserModal
                    userId={editingUser.id}
                    allCompaniesMap={allCompaniesMap}
                    onClose={onClose}
                    onSave={onRefreshData}
                />
            )}

            {deletingUser && (
                <DeleteUserModal
                    userId={deletingUser.id}
                    userName={deletingUser.name}
                    onClose={onClose}
                    onConfirm={onRefreshData}
                />
            )}

            {viewingCompanyApps && (
                <ViewCompanyAppsModal
                    companyId={viewingCompanyApps.id}
                    companyName={viewingCompanyApps.name}
                    onClose={onClose}
                />
            )}

            {selectedApplication && (
                <ApplicationDetailViewV2
                    companyId={selectedApplication.companyId}
                    applicationId={selectedApplication.appId}
                    collectionName="applications"
                    onClose={onClose}
                    onStatusChange={onRefreshData}
                />
            )}
        </>
    );
}