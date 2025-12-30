import { useData } from '@/context/DataContext';
import { useAppFetch } from './useAppFetch';
import { useAppActions } from './useAppActions';

export function useApplicationDetails(companyId, applicationId, onStatusUpdate) {
  const { currentUserClaims } = useData();

  const fetch = useAppFetch(companyId, applicationId);

  const userRole = currentUserClaims?.roles?.[companyId];
  const canEdit = 
    currentUserClaims?.roles?.globalRole === 'super_admin' || 
    ['company_admin', 'hr_user'].includes(userRole);

  const actions = useAppActions({
    companyId,
    applicationId,
    collectionName: fetch.collectionName,
    isGlobal: fetch.isGlobal,
    appData: fetch.appData,
    setAppData: fetch.setAppData,
    setFileUrls: fetch.setFileUrls,
    setCurrentStatus: fetch.setCurrentStatus,
    setAssignedTo: fetch.setAssignedTo,
    teamMembers: fetch.teamMembers,
    canEdit,
    onStatusUpdate
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

    isEditing: actions.isEditing,
    isSaving: actions.isSaving,
    isUploading: actions.isUploading,
    canEdit,

    loadApplication: fetch.loadApplication,
    handleAssignChange: actions.handleAssignChange,
    handleDataChange: actions.handleDataChange,
    handleAdminFileUpload: actions.handleAdminFileUpload,
    handleAdminFileDelete: actions.handleAdminFileDelete,
    handleSaveEdit: actions.handleSaveEdit,
    handleStatusUpdate: actions.handleStatusUpdate,
    handleDriverTypeUpdate: actions.handleDriverTypeUpdate,
    
    setIsEditing: (val) => {}
  };
}
