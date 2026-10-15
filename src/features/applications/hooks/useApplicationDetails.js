import { useData } from '@/context/DataContext';
import { useAppFetch } from './useAppFetch';
import { useAppActions } from './useAppActions';
import { isCompanyWorkspaceRole } from '@app/auth/roles';

export function useApplicationDetails(companyId, applicationId, onStatusUpdate) {
  const { currentUserClaims } = useData();

  const fetch = useAppFetch(companyId, applicationId);

  const userRole = currentUserClaims?.roles?.[companyId];
  const canEdit =
    currentUserClaims?.roles?.globalRole === 'super_admin' ||
    isCompanyWorkspaceRole(userRole);

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
