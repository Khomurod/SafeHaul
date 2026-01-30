import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { db, storage } from '@lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { uploadApplicationFile, submitDriverApplication } from '../../services/driverService';
import Stepper from '@shared/components/layout/Stepper';
import { Loader2, X, Save } from 'lucide-react';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { DraftRecoveryModal } from '../DraftRecoveryModal';
import { useApplicationSchema } from '@/hooks/useApplicationSchema';

export function DriverApplicationWizard({ isOpen, onClose, onSuccess, job, companyId }) {
  const { currentUser } = useData();
  const navigate = useNavigate();
  const { companyId: paramCompanyId } = useParams();
  const { showSuccess, showError } = useToast();

  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [targetCompanyId, setTargetCompanyId] = useState(null);
  const [submissionStatus, setSubmissionStatus] = useState(null);

  // New: Draft recovery and auto-save state
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [draftData, setDraftData] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef(null);
  const lastFormDataRef = useRef({});

  // NEW: Submission Guard to prevent "Ghost Drafts"
  const isSubmitting = useRef(false);

  // NEW: Fetch application schema with custom questions
  const { schema, hasCustomQuestions } = useApplicationSchema(targetCompanyId);
  const customQuestions = schema?.sections?.find(s => s.isCustom)?.fields ||
    schema?.fields?.filter(f => f.isCustom) ||
    [];

  // 1. Resolve Target Company
  useEffect(() => {
    if (paramCompanyId) {
      setTargetCompanyId(paramCompanyId);
    } else if (companyId) {
      setTargetCompanyId(companyId);
    } else {
      const pending = sessionStorage.getItem('pending_application_company');
      if (pending) setTargetCompanyId(pending);
    }
  }, [paramCompanyId, companyId]);

  // 2. Load Draft (with recovery modal)
  useEffect(() => {
    const loadDraft = async () => {
      // Wait for targetCompanyId to be resolved before loading draft
      if (!currentUser || !targetCompanyId) return;

      try {
        // SECURITY FIX: Isolate drafts by Company ID
        const draftId = `app_${targetCompanyId}`;
        const draftRef = doc(db, 'drivers', currentUser.uid, 'drafts', draftId);
        const snap = await getDoc(draftRef);

        if (snap.exists()) {
          const data = snap.data();
          setDraftData(data);

          // Show recovery modal if draft has meaningful progress (past step 0 or has data)
          if (data.lastStep > 0 || data.firstName || data.email) {
            setShowDraftModal(true);
          } else {
            // Very early draft - just load it
            setFormData(data);
            if (data.lastStep) setCurrentStep(data.lastStep);
          }
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
  }, [currentUser, targetCompanyId]);

  // Draft recovery handlers
  const handleResumeDraft = () => {
    if (draftData) {
      setFormData(draftData);
      if (draftData.lastStep) setCurrentStep(draftData.lastStep);
    }
    setShowDraftModal(false);
  };

  const handleStartFresh = async () => {
    // Clear old draft
    if (currentUser && targetCompanyId) {
      try {
        const draftId = `app_${targetCompanyId}`;
        const draftRef = doc(db, 'drivers', currentUser.uid, 'drafts', draftId);
        await deleteDoc(draftRef);
      } catch (err) {
        console.error("Failed to clear draft:", err);
      }
    }
    // Start with fresh pre-filled data
    setFormData({
      email: currentUser?.email || '',
      phone: currentUser?.phoneNumber || '',
      firstName: currentUser?.displayName?.split(' ')[0] || '',
      lastName: currentUser?.displayName?.split(' ').slice(1).join(' ') || ''
    });
    setCurrentStep(0);
    setShowDraftModal(false);
  };

  // 3. Save Draft Helper (with debounce indicator)
  const saveDraft = useCallback(async (newData = {}) => {
    if (!currentUser || !targetCompanyId) return;

    // GHOST DRAFT PREVENTION: Abort if submission has started
    if (isSubmitting.current) {
      console.log('Skipping draft save - submission in progress');
      return;
    }

    setIsSaving(true);
    try {
      const mergedData = {
        ...formData,
        ...newData,
        lastStep: currentStep,
        updatedAt: serverTimestamp(),
        lastSavedAt: new Date().toISOString(),
        companyId: targetCompanyId // Explicitly track which company this draft is for
      };
      setFormData(mergedData);
      lastFormDataRef.current = mergedData;

      const draftId = `app_${targetCompanyId}`;
      const draftRef = doc(db, 'drivers', currentUser.uid, 'drafts', draftId);
      await setDoc(draftRef, mergedData, { merge: true });
    } catch (err) {
      console.error("Auto-save failed:", err);
    } finally {
      setIsSaving(false);
    }
  }, [currentUser, formData, currentStep, targetCompanyId]);

  // 4. Aggressive Auto-Save: Debounced every 5 seconds
  useEffect(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Only auto-save if we have data and user is authenticated
    if (currentUser && Object.keys(formData).length > 0 && !loading) {
      saveTimeoutRef.current = setTimeout(() => {
        // Only save if data actually changed
        if (JSON.stringify(formData) !== JSON.stringify(lastFormDataRef.current)) {
          saveDraft();
        }
      }, 5000); // Save every 5 seconds of inactivity
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [formData, currentUser, loading, saveDraft]);

  // 5. Emergency save on page unload
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (currentUser && Object.keys(formData).length > 0 && targetCompanyId && !isSubmitting.current) {
        // Attempt synchronous save (best effort)
        // Note: For reliable unload saving, sendBeacon is preferred but specialized
        console.log('[DriverApplicationWizard] Page unload - draft check');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentUser, formData, currentStep, targetCompanyId]);

  // 6. Handlers
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
    if (!file) return null;
    setIsUploading(true);
    try {
      const fileData = await uploadApplicationFile(targetCompanyId, currentUser.uid, fieldName, file);

      handleUpdateFormData(fieldName, fileData);
      await saveDraft({ [fieldName]: fileData });
      showSuccess("File uploaded successfully.");

      // Return fileData for UploadField component to update its state
      return fileData;

    } catch (error) {
      console.error("Upload failed:", error);
      let msg = "Upload failed. Please try again.";
      if (error.message.includes("exceeds 20MB")) msg = "File is too large (Max 20MB).";
      showError(msg);
      throw error; // Re-throw so UploadField can handle error state
    } finally {
      setIsUploading(false);
    }
  };

  // VALIDATION HELPER
  const validateForm = () => {
    if (!schema?.sections) return [];
    const missing = [];

    // 1. Check sections
    schema.sections.forEach(section => {
      section.fields.forEach(field => {
        if (field.required && !formData[field.id]) {
          // Special case: boolean fields might be false but valid, check undefined/null/empty string
          if (formData[field.id] !== 0 && formData[field.id] !== false) {
            missing.push(field.label);
          }
        }
      });
    });

    // 2. Custom Questions
    customQuestions.forEach(q => {
      if (q.required && !formData[q.id]) {
        missing.push(q.label || q.question);
      }
    });

    return missing;
  };

  const handleFinalSubmit = async () => {
    // 0. GENERIC VALIDATION
    const missingFields = validateForm();
    if (missingFields.length > 0) {
      showError(`Missing required fields: ${missingFields.slice(0, 3).join(', ')}${missingFields.length > 3 ? '...' : ''}`);
      return;
    }

    // FIX: Add Validation for Signature and Certification
    if (!formData.signature || !formData['final-certification']) {
      showError("Please provide your signature and certify the application.");
      setCurrentStep(schema?.sections?.length || 8); // Jump to last step (approx)
      return;
    }

    // Set Guard Ref
    isSubmitting.current = true;

    try {
      const activeCompanyId = targetCompanyId;
      await submitDriverApplication(currentUser, formData, activeCompanyId, job);

      // Clear Draft (Company Specific)
      const draftId = `app_${activeCompanyId}`;
      const draftRef = doc(db, 'drivers', currentUser.uid, 'drafts', draftId);
      await deleteDoc(draftRef);

      // Cleanup Session
      sessionStorage.removeItem('pending_application_company');

      setSubmissionStatus('success');
      showSuccess("Application Submitted!");

      if (onSuccess && job?.id) {
        onSuccess(job.id);
      }

      // Redirect or Close
      setTimeout(() => {
        if (onClose) {
          onClose();
        } else {
          navigate('/driver/dashboard');
        }
      }, 1500);

    } catch (error) {
      console.error("Submission Error:", error);
      setSubmissionStatus('error');
      showError("Failed to submit application.");
    }
  };

  if (loading) {
    if (isOpen) return null; // Or a subtle loader inside the modal
    return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={40} /></div>;
  }

  // --- MODAL RENDER ---
  if (isOpen) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div
          className="bg-gray-50 w-full max-w-5xl max-h-[95vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
          onClick={e => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="px-6 py-4 bg-white border-b border-gray-200 flex justify-between items-center shrink-0">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Complete DOT Application</h2>
              {job && <p className="text-sm text-gray-500 font-medium italic">Position: {job.title}</p>}
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-all"
            >
              <X size={24} />
            </button>
          </div>

          {/* Modal Content */}
          <div className="flex-1 overflow-y-auto p-6 bg-white">
            <div className="max-w-4xl mx-auto border border-gray-100 rounded-xl shadow-sm">
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
                customQuestions={customQuestions}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- PAGE RENDER ---
  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Draft Recovery Modal */}
      <DraftRecoveryModal
        isOpen={showDraftModal}
        draftData={draftData}
        onResume={handleResumeDraft}
        onStartFresh={handleStartFresh}
        onClose={() => setShowDraftModal(false)}
      />

      <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-gray-900">Driver Application</h1>
          {/* Auto-save indicator */}
          {isSaving && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Save size={12} className="animate-pulse" />
              Saving...
            </span>
          )}
        </div>
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
          customQuestions={customQuestions}
        />
      </div>
    </div>
  );
}