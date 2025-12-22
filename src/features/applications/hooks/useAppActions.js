import { useState } from 'react';
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from '@lib/firebase';
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
    isGlobal, 
    appData, 
    setAppData, 
    setFileUrls,
    setCurrentStatus,
    setAssignedTo,
    teamMembers,
    canEdit,
    onStatusUpdate 
}) {
  const { showSuccess, showError } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const getDocRef = () => {
      if (isGlobal) {
          return doc(db, collectionName, applicationId);
      }
      return doc(db, "companies", companyId, collectionName, applicationId);
  };

  const handleAssignChange = async (newUserId) => {
      if (isGlobal) {
          showError("Global leads cannot be assigned to specific recruiters. Please 'Move' them to a company first.");
          return;
      }
      
      const newOwnerName = teamMembers.find(m => m.id === newUserId)?.name || 'Unassigned';
      setAssignedTo(newUserId);

      try {
          const docRef = getDocRef();
          await simpleRetry(() => updateDoc(docRef, { 
              assignedTo: newUserId,
              assignedToName: newOwnerName
          }));
          
          await logActivity(companyId, collectionName, applicationId, "Reassigned", `Assigned to ${newOwnerName}`);
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

    const storagePath = isGlobal 
        ? `global_leads/${applicationId}/${fieldKey}-${file.name}`
        : `companies/${companyId}/${collectionName}/${applicationId}/${fieldKey}-${file.name}`;
        
    const fileRef = ref(storage, storagePath);

    try {
        await simpleRetry(() => uploadBytes(fileRef, file));
        const newUrl = await getDownloadURL(fileRef);
        const fileData = { name: file.name, storagePath: storagePath, url: newUrl };
        
        setAppData(prev => ({ ...prev, [fieldKey]: fileData }));
        setFileUrls(prev => ({ ...prev, [fieldKey]: newUrl }));
        
        const docRef = getDocRef();
        await simpleRetry(() => updateDoc(docRef, { [fieldKey]: fileData }));
        
        if (!isGlobal) await logActivity(companyId, collectionName, applicationId, "File Uploaded", `Uploaded ${fieldKey}`);
        showSuccess("File uploaded successfully");
    } catch (error) {
        console.error("Upload Error:", error);
        showError("File upload failed.");
    } finally {
        setIsUploading(false);
    }
  };

  const handleAdminFileDelete = async (fieldKey, storagePath) => {
    if (!storagePath || !window.confirm("Remove file?") || !canEdit) return;
    setIsUploading(true);
    try {
        try { await deleteObject(ref(storage, storagePath)); } catch(e) {}
        
        setAppData(prev => ({ ...prev, [fieldKey]: null }));
        setFileUrls(prev => ({ ...prev, [fieldKey]: null }));
        
        const docRef = getDocRef();
        await simpleRetry(() => updateDoc(docRef, { [fieldKey]: null }));
        
        if (!isGlobal) await logActivity(companyId, collectionName, applicationId, "File Deleted", `Deleted ${fieldKey}`);
        showSuccess("File removed");
    } catch (error) {
        showError("File deletion failed.");
    } finally {
        setIsUploading(false);
    }
  };

  const handleSaveEdit = async (callback) => {
    if (!canEdit) return;
    setIsSaving(true);
    try {
        const docRef = getDocRef();
        await simpleRetry(() => updateDoc(docRef, appData));
        
        if (!isGlobal) await logActivity(companyId, collectionName, applicationId, "Details Updated", "User edited details");
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
      await simpleRetry(() => updateDoc(docRef, { status: newStatus }));
      
      if (!isGlobal) await logActivity(companyId, collectionName, applicationId, "Status Changed", `Status changed to ${newStatus}`);
      
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
      if (!isGlobal) await logActivity(companyId, collectionName, applicationId, "Type Updated", `Driver type changed to ${newType}`);
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
    handleDriverTypeUpdate
  };
}
