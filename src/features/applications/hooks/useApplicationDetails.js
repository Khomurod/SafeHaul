import { useData } from '@/context/DataContext';
import { useState } from 'react';
import { useAppFetch } from './useAppFetch';
import { useAppActions } from './useAppActions';
import { isCompanyWorkspaceRole } from '@app/auth/roles';

export function useApplicationDetails(companyId, applicationId, onStatusUpdate) {
  const { currentUserClaims } = useData();
  const [originalData, setOriginalData] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  const fetch = useAppFetch(companyId, applicationId);

  const userRole = currentUserClaims?.roles?.[companyId];
  const canEdit =
    currentUserClaims?.roles?.globalRole === 'super_admin' ||
    isCompanyWorkspaceRole(userRole);

  const actions = useAppActions({
    companyId,
    applicationId,
    collectionName: fetch.collectionName,
    isGlobal: fetch.isGlobal,
    appData: fetch.appData,
    setAppData: fetch.setAppData,
    setFileUrls: fetch.setFileUrls,
    setCurrentStatus: fetch.setCurrentStatus,
    currentStatus: fetch.currentStatus,
    setAssignedTo: fetch.setAssignedTo,
    teamMembers: fetch.teamMembers,
    canEdit,
    onStatusUpdate,
    originalData
  });

  return {
    loading: fetch.loading,
    error: fetch.error,
    appData: fetch.appData,
    companyProfile: fetch.companyProfile,
    collectionName: fetch.collectionName,
    fileUrls: fetch.fileUrls,
    currentStatus: fetch.currentStatus,
    teamMembers: fetch.teamMembers,
    assignedTo: fetch.assignedTo,
    isGlobal: fetch.isGlobal,

    isEditing,  // FIX: Use local state, not actions.isEditing (which is undefined)
    isSaving: actions.isSaving,
    isUploading: actions.isUploading,
    canEdit,

    loadApplication: fetch.loadApplication,
    handleAssignChange: actions.handleAssignChange,
    handleDataChange: actions.handleDataChange,
    handleAdminFileUpload: actions.handleAdminFileUpload,
    handleAdminFileDelete: actions.handleAdminFileDelete,
    // Additive confirm-ready file-removal API (2026-07-28). `handleAdminFileDelete`
    // is now purely the executor — it no longer opens a blocking `window.confirm`
    // — so a consumer that wires the action renders the shared `ConfirmDialog`
    // from `pendingFileRemoval` instead.
    pendingFileRemoval: actions.pendingFileRemoval,
    requestAdminFileDelete: actions.requestAdminFileDelete,
    confirmAdminFileDelete: actions.confirmAdminFileDelete,
    cancelAdminFileDelete: actions.cancelAdminFileDelete,
    handleSaveEdit: () => actions.handleSaveEdit(originalData, () => setIsEditing(false)),
    handleStatusUpdate: actions.handleStatusUpdate,
    handleDriverTypeUpdate: actions.handleDriverTypeUpdate,

    setIsEditing: (val) => {
      if (val) setOriginalData({ ...fetch.appData });
      setIsEditing(val);
    }
  };
}
