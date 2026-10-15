import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from '@lib/firebase';
import { logActivity } from '@shared/utils/activityLogger';
import { useToast } from '@shared/components/feedback';

const simpleRetry = async (fn, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

export function useAppActions({
  companyId,
  applicationId,
  collectionName,
  appData,
  setAppData,
  setCurrentStatus,
  currentStatus,
  setAssignedTo,
  teamMembers,
  onStatusUpdate
}) {
  const { showSuccess, showError } = useToast();

  const getDocRef = () => {
    return doc(db, "companies", companyId, collectionName, applicationId);
  };

  const handleAssignChange = async (newUserId) => {
    // '' unassigns, and an unassigned record holds no assignee's name: the lists
    // show it as Unassigned, and the automated status SMS does not sign with it.
    const newOwnerName = newUserId ? (teamMembers.find(m => m.id === newUserId)?.name || '') : '';
    const prevName = (appData?.assignedTo && appData?.assignedToName) || 'Unassigned';
    const shownName = newOwnerName || 'Unassigned';
    const actor =
      auth.currentUser?.displayName ||
      auth.currentUser?.email ||
      'Team member';
    setAssignedTo(newUserId);

    try {
      const docRef = getDocRef();
      await simpleRetry(() => updateDoc(docRef, {
        assignedTo: newUserId,
        assignedToName: newOwnerName
      }));
      // The next change in this dossier is logged as from this one.
      setAppData((prev) => (prev ? { ...prev, assignedTo: newUserId, assignedToName: newOwnerName } : prev));

      await logActivity(
        companyId,
        collectionName,
        applicationId,
        "Assignment Changed",
        `${actor} reassigned this from ${prevName} to ${shownName}`
      );
      showSuccess(`Assigned to ${shownName}`);
      if (onStatusUpdate) onStatusUpdate();
    } catch (error) {
      console.error("Error assigning:", error);
      showError("Failed to update assignment.");
    }
  };

  const handleStatusUpdate = async (newStatus) => {
    try {
      const docRef = getDocRef();
      const oldStatus = currentStatus || 'Unknown';
      await simpleRetry(() => updateDoc(docRef, {
        status: newStatus,
        statusEnteredAt: serverTimestamp(),
      }));

      await logActivity(companyId, collectionName, applicationId, "Status Changed", `Transitioned from ${oldStatus} to ${newStatus}`);

      setCurrentStatus(newStatus);
      showSuccess(`Status updated to ${newStatus}`);
      if (onStatusUpdate) onStatusUpdate();
    } catch (error) {
      console.error("Error updating status:", error);
      showError("Failed to update status.");
    }
  };

  return {
    handleAssignChange,
    handleStatusUpdate,
  };
}
