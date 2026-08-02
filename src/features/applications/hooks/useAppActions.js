import { useRef, useState } from 'react';
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage, auth } from '@lib/firebase';
import { logActivity } from '@shared/utils/activityLogger';
import { useToast } from '@shared/components/feedback';
import { buildApplicationSearchFields } from '@shared/utils/searchNormalization';

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
  setFileUrls,
  setCurrentStatus,
  currentStatus,
  setAssignedTo,
  teamMembers,
  canEdit,
  onStatusUpdate
}) {
  const { showSuccess, showError } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  /**
   * Staged file removal awaiting confirmation: `{ fieldKey, storagePath } | null`.
   * State only — the hook never renders the dialog. See
   * `requestAdminFileDelete` below.
   */
  const [pendingFileRemoval, setPendingFileRemoval] = useState(null);
  const removingFileRef = useRef(false);

  const getDocRef = () => {
    return doc(db, "companies", companyId, collectionName, applicationId);
  };

  const handleAssignChange = async (newUserId) => {
    const newOwnerName = teamMembers.find(m => m.id === newUserId)?.name || 'Unassigned';
    const prevName = appData?.assignedToName || 'Unassigned';
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

      await logActivity(
        companyId,
        collectionName,
        applicationId,
        "Assignment Changed",
        `${actor} reassigned this from ${prevName} to ${newOwnerName}`
      );
      showSuccess(`Assigned to ${newOwnerName}`);
      if (onStatusUpdate) onStatusUpdate();
    } catch (error) {
      console.error("Error assigning:", error);
      showError("Failed to update assignment.");
    }
  };

  const handleDataChange = (field, value) => {
    if (!canEdit) return;
    setAppData(prev => ({ ...prev, [field]: value }));
  };

  const handleAdminFileUpload = async (fieldKey, file) => {
    if (!file || !canEdit) return;
    setIsUploading(true);

    const storagePath = `companies/${companyId}/${collectionName}/${applicationId}/${fieldKey}-${file.name}`;

    const fileRef = ref(storage, storagePath);

    try {
      await simpleRetry(() => uploadBytes(fileRef, file));
      const newUrl = await getDownloadURL(fileRef);
      const fileData = { name: file.name, storagePath: storagePath, url: newUrl };

      setAppData(prev => ({ ...prev, [fieldKey]: fileData }));
      setFileUrls(prev => ({ ...prev, [fieldKey]: newUrl }));

      const docRef = getDocRef();
      await simpleRetry(() => updateDoc(docRef, { [fieldKey]: fileData }));

      await logActivity(companyId, collectionName, applicationId, "File Uploaded", `Uploaded ${fieldKey}`);
      showSuccess("File uploaded successfully");
    } catch (error) {
      console.error("Upload Error:", error);
      showError("File upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Admin removal of an uploaded application file.
   *
   * This used to open a blocking `window.confirm("Remove file?")` from inside the
   * hook. Two problems with that, both fixed here (2026-07-28):
   *
   *  1. **A hook must not own a dialog.** Confirmation is presentation. Keeping it
   *     here meant the only possible confirmation was the browser's blocking one,
   *     and no consumer could substitute an accessible dialog.
   *  2. **The guard was unreachable anyway.** `handleAdminFileDelete` is exported
   *     through `useApplicationDetails` and `useApplicationView`, but no component
   *     calls it — verified by a repository-wide search. The confirmation was dead
   *     code sitting in a live API, waiting to surprise whoever wired it up.
   *
   * The Firebase work stays here. Confirmation ownership moves to the presentation
   * layer through the additive `requestAdminFileDelete` /
   * `confirmAdminFileDelete` / `cancelAdminFileDelete` API below, which holds the
   * pending target as *state* — state is a hook's job; rendering is not.
   *
   * `handleAdminFileDelete` is retained with its original name and signature so
   * the public hook contract is unchanged, but it is now purely the executor:
   * **callers must confirm before invoking it.** Prefer the request/confirm API,
   * which cannot be invoked without an explicit confirmation step.
   */
  const handleAdminFileDelete = async (fieldKey, storagePath) => {
    if (!storagePath || !canEdit) return false;
    setIsUploading(true);
    try {
      try { await deleteObject(ref(storage, storagePath)); } catch (e) { console.warn("Storage file may not exist:", e.code); }

      setAppData(prev => ({ ...prev, [fieldKey]: null }));
      setFileUrls(prev => ({ ...prev, [fieldKey]: null }));

      const docRef = getDocRef();
      await simpleRetry(() => updateDoc(docRef, { [fieldKey]: null }));

      await logActivity(companyId, collectionName, applicationId, "File Deleted", `Deleted ${fieldKey}`);
      showSuccess("File removed");
      // Additive: previously returned `undefined` in every branch, so reporting
      // the outcome cannot break a caller. It lets the confirmation keep itself
      // open for a retry when the removal fails.
      return true;
    } catch (error) {
      showError("File deletion failed.");
      return false;
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Stage a file removal for confirmation. Performs no deletion — a presentation
   * component renders the shared `ConfirmDialog` from `pendingFileRemoval` and
   * calls `confirmAdminFileDelete` only when the operator confirms.
   */
  const requestAdminFileDelete = (fieldKey, storagePath) => {
    if (!storagePath || !canEdit) return;
    setPendingFileRemoval({ fieldKey, storagePath });
  };

  /** Dismiss the staged removal. Performs no deletion. */
  const cancelAdminFileDelete = () => setPendingFileRemoval(null);

  /**
   * Remove the staged file. Guarded by a synchronous ref so two activations
   * dispatched inside one render cannot both delete — `isUploading` is state and
   * only takes effect on the next render.
   */
  const confirmAdminFileDelete = async () => {
    const target = pendingFileRemoval;
    if (!target || removingFileRef.current) return;
    removingFileRef.current = true;
    try {
      const removed = await handleAdminFileDelete(target.fieldKey, target.storagePath);
      // Only clear the target once the removal actually succeeded, so a failure
      // leaves the confirmation open and the operator can retry the same file.
      if (removed) setPendingFileRemoval(null);
    } finally {
      removingFileRef.current = false;
    }
  };

  const computeDiff = (oldData, newData) => {
    const changes = [];
    const ignoreFields = [
      'updatedAt', 'lastModified', 'activity_logs', 'id',
      // Derived search fields — noise in human-facing change logs.
      'firstNameNormalized', 'lastNameNormalized', 'fullNameNormalized',
      'emailNormalized', 'phoneNormalized', 'confirmationNumberNormalized',
      'applicationIdNormalized',
    ];

    Object.keys(newData).forEach(key => {
      if (ignoreFields.includes(key)) return;
      if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
        const oldVal = oldData[key] || 'None';
        const newVal = newData[key] || 'Removed';
        // Limit string length for logs
        const oldStr = typeof oldVal === 'string' ? oldVal.substring(0, 50) : JSON.stringify(oldVal);
        const newStr = typeof newVal === 'string' ? newVal.substring(0, 50) : JSON.stringify(newVal);
        changes.push(`${key}: "${oldStr}" → "${newStr}"`);
      }
    });
    return changes.join('\n');
  };

  const handleSaveEdit = async (originalData, callback) => {
    if (!canEdit) return;
    setIsSaving(true);
    try {
      const docRef = getDocRef();

      // Refresh ALL persisted normalized search fields (name/email/phone/
      // confirmation/id) so recruiter edits keep search working — this also
      // lazily backfills legacy documents that predate normalized fields.
      let finalData = { ...appData };
      Object.assign(finalData, buildApplicationSearchFields({
        firstName: finalData.firstName,
        lastName: finalData.lastName,
        email: finalData.email,
        phone: finalData.phone,
        confirmationNumber: finalData.confirmationNumber,
        applicationId: finalData.applicationId || applicationId,
      }));

      const diff = computeDiff(originalData || {}, finalData);

      // Firestore rejects any payload containing `undefined`. Strip undefined
      // keys so a partially-populated field can never fail the whole save.
      const sanitized = Object.fromEntries(
        Object.entries(finalData).filter(([, v]) => v !== undefined),
      );

      await simpleRetry(() => updateDoc(docRef, sanitized));

      if (diff) {
        await logActivity(companyId, collectionName, applicationId, "Details Updated", diff);
      } else if (!diff) {
        await logActivity(companyId, collectionName, applicationId, "Details Saved", "No changes detected");
      }

      // Update local state to match saved data (including normalized phone)
      setAppData(finalData);

      showSuccess("Changes saved successfully");

      if (callback) callback();
      if (onStatusUpdate) onStatusUpdate();
    } catch (error) {
      console.error("Save Error:", error);
      showError(`Error saving: ${error.message}`);
    } finally {
      setIsSaving(false);
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

  const handleDriverTypeUpdate = async (newType) => {
    try {
      const docRef = getDocRef();
      const payload = (collectionName === 'drivers')
        ? { "driverProfile.type": newType }
        : { driverType: newType };

      await simpleRetry(() => updateDoc(docRef, payload));

      setAppData(prev => ({ ...prev, driverType: newType }));
      await logActivity(companyId, collectionName, applicationId, "Type Updated", `Driver type changed to ${newType}`);
      showSuccess(`Driver type updated to ${newType}`);
    } catch (error) {
      console.error("Error updating driver type:", error);
      showError("Failed to update driver type.");
    }
  };

  return {
    isUploading,
    isSaving,
    handleAssignChange,
    handleDataChange,
    handleAdminFileUpload,
    handleAdminFileDelete,
    handleSaveEdit,
    handleStatusUpdate,
    handleDriverTypeUpdate,
    // Additive confirm-ready file-removal API (2026-07-28). Replaces the blocking
    // `window.confirm` that used to live inside `handleAdminFileDelete`.
    pendingFileRemoval,
    requestAdminFileDelete,
    confirmAdminFileDelete,
    cancelAdminFileDelete
  };
}
