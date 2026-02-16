import React from 'react';
import {
    EditCompanyModal,
    EditUserModal,
    ViewCompanyAppsModal,
    DeleteCompanyModal,
    DeleteUserModal
} from './modals';
import { DriverProfileModal } from '@features/company-admin/components/modals/driver-dossier/DriverProfileModal';

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
                <DriverProfileModal
                    companyId={selectedApplication.companyId}
                    driverId={selectedApplication.appId}
                    isOpen={true}
                    onClose={onClose}
                />
            )}
        </>
    );
}