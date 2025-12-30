import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { db, storage } from '@lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import Stepper from '@shared/components/layout/Stepper';
import { Loader2 } from 'lucide-react';
import { useToast } from '@shared/components/feedback/ToastProvider';

export function DriverApplicationWizard() {
  const { currentUser } = useData();
  const navigate = useNavigate();
  const { companyId: paramCompanyId } = useParams();
  const { showSuccess, showError } = useToast();

  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [targetCompanyId, setTargetCompanyId] = useState(null);
  const [submissionStatus, setSubmissionStatus] = useState(null); // 'success', 'error', or null

  // 1. Resolve Target Company
  useEffect(() => {
    if (paramCompanyId) {
        setTargetCompanyId(paramCompanyId);
    } else {
        const pending = sessionStorage.getItem('pending_application_company');
        if (pending) setTargetCompanyId(pending);
    }
  }, [paramCompanyId]);

  // 2. Load Draft
  useEffect(() => {
    const loadDraft = async () => {
      if (!currentUser) return;
      try {
        const draftRef = doc(db, 'drivers', currentUser.uid, 'drafts', 'application');
        const snap = await getDoc(draftRef);

        if (snap.exists()) {
          const data = snap.data();
          setFormData(data);
          if (data.lastStep) setCurrentStep(data.lastStep);
        } else {
            // Pre-fill from Auth
            setFormData({ 
                email: currentUser.email,
                phone: currentUser.phoneNumber || '',
                firstName: currentUser.displayName?.split(' ')[0] || '',
                lastName: currentUser.displayName?.split(' ').slice(1).join(' ') || ''
            });
        }
      } catch (err) {
        console.error("Error loading draft:", err);
      } finally {
        setLoading(false);
      }
    };
    loadDraft();
  }, [currentUser]);

  // 3. Save Draft Helper
  const saveDraft = async (newData = {}) => {
    if (!currentUser) return;
    try {
      const mergedData = { ...formData, ...newData, lastStep: currentStep, updatedAt: serverTimestamp() };
      setFormData(mergedData);
      const draftRef = doc(db, 'drivers', currentUser.uid, 'drafts', 'application');
      await setDoc(draftRef, mergedData, { merge: true });
    } catch (err) {
      console.error("Auto-save failed:", err);
    }
  };

  // 4. Handlers
  const handleUpdateFormData = (name, value) => {
      const newData = { ...formData, [name]: value };
      setFormData(newData);
  };

  const handleNavigate = (direction) => {
      saveDraft(); // Auto-save on navigation
      if (direction === 'next') {
          setCurrentStep(prev => prev + 1);
      } else if (direction === 'back') {
          setCurrentStep(prev => Math.max(0, prev - 1));
      } else if (typeof direction === 'number') {
          setCurrentStep(direction);
      }
  };

  const handleFileUpload = async (fieldName, file) => {
      if (!file) return;
      setIsUploading(true);
      try {
          const basePath = targetCompanyId 
            ? `companies/${targetCompanyId}/applications/${currentUser.uid}`
            : `global_leads/${currentUser.uid}`;

          const storagePath = `${basePath}/${fieldName}/${Date.now()}_${file.name}`;
          const fileRef = ref(storage, storagePath);

          await uploadBytes(fileRef, file);
          const downloadURL = await getDownloadURL(fileRef);

          const fileData = {
              name: file.name,
              url: downloadURL,
              storagePath: storagePath
          };

          handleUpdateFormData(fieldName, fileData);
          await saveDraft({ [fieldName]: fileData });
          showSuccess("File uploaded successfully.");

      } catch (error) {
          console.error("Upload failed:", error);
          showError("Upload failed. Please try again.");
      } finally {
          setIsUploading(false);
      }
  };

  const handleFinalSubmit = async () => {
    // FIX: Add Validation for Signature
    if (!formData.signatureName || !formData['final-certification']) {
        showError("Please complete the electronic signature in the final step.");
        setCurrentStep(8); // Jump to Step 9
        return;
    }

    try {
        const timestamp = serverTimestamp();
        const activeCompanyId = targetCompanyId;

        // Prepare Payload
        const finalData = {
            ...formData,
            // FIX: Ensure signature format matches PDF generator expectation
            signature: `TEXT_SIGNATURE:${formData.signatureName}`,
            userId: currentUser.uid,
            driverId: currentUser.uid,
            status: 'New Application',
            submittedAt: timestamp,
            createdAt: timestamp, 
            sourceType: activeCompanyId ? 'Company App' : 'Global Pool',
            companyId: activeCompanyId || 'general-leads'
        };

        // Determine Destination
        let docRef;
        if (activeCompanyId) {
            docRef = doc(db, "companies", activeCompanyId, "applications", currentUser.uid);
        } else {
            docRef = doc(db, "leads", currentUser.uid);
        }

        await setDoc(docRef, finalData);

        // Clear Draft
        const draftRef = doc(db, 'drivers', currentUser.uid, 'drafts', 'application');
        await deleteDoc(draftRef);

        // Cleanup Session
        sessionStorage.removeItem('pending_application_company');

        setSubmissionStatus('success');
        showSuccess("Application Submitted!");

        // Redirect
        setTimeout(() => {
            navigate('/driver/dashboard');
        }, 1500);

    } catch (error) {
        console.error("Submission Error:", error);
        setSubmissionStatus('error');
        showError("Failed to submit application.");
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={40} /></div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center sticky top-0 z-30">
            <h1 className="font-bold text-gray-900">Driver Application</h1>
            <button onClick={() => navigate('/driver/dashboard')} className="text-sm text-gray-500 hover:text-gray-800 font-medium">
                Save & Exit
            </button>
        </div>

        <div className="max-w-4xl mx-auto mt-6 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <Stepper 
                step={currentStep}
                formData={formData}
                updateFormData={handleUpdateFormData}
                onNavigate={handleNavigate}
                onPartialSubmit={() => { saveDraft(); showSuccess("Draft saved."); }}
                onFinalSubmit={handleFinalSubmit}
                handleFileUpload={handleFileUpload}
                isUploading={isUploading}
                submissionStatus={submissionStatus}
            />
        </div>
    </div>
  );
}
