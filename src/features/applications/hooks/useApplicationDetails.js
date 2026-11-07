import { useData } from '@/context/DataContext';
import { useAppFetch } from './useAppFetch';
import { useAppActions } from './useAppActions';
import { isCompanyWorkspaceRole, isSuperAdminClaims } from '@app/auth/roles';

/** `collectionHint`: the record's collection when the opener knows it (`useAppFetch`). */
export function useApplicationDetails(companyId, applicationId, onStatusUpdate, collectionHint) {
  const { currentUserClaims } = useData();

  const fetch = useAppFetch(companyId, applicationId, collectionHint);

  const userRole = currentUserClaims?.roles?.[companyId];
  const canEdit = isSuperAdminClaims(currentUserClaims) || isCompanyWorkspaceRole(userRole);

  const actions = useAppActions({
    companyId,
    applicationId,
    collectionName: fetch.collectionName,
    appData: fetch.appData,
    setAppData: fetch.setAppData,
    setCurrentStatus: fetch.setCurrentStatus,
    currentStatus: fetch.currentStatus,
    setAssignedTo: fetch.setAssignedTo,
    teamMembers: fetch.teamMembers,
    onStatusUpdate,
  });

  return {
    loading: fetch.loading,
    error: fetch.error,
    appData: fetch.appData,
    refreshRecord: fetch.refreshRecord,
    collectionName: fetch.collectionName,
    fileUrls: fetch.fileUrls,
    filesPending: fetch.filesPending,
    currentStatus: fetch.currentStatus,
    teamMembers: fetch.teamMembers,
    assignedTo: fetch.assignedTo,
    canEdit,

    handleAssignChange: actions.handleAssignChange,
    handleStatusUpdate: actions.handleStatusUpdate,
  };
}
