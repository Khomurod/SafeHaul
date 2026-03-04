// src/features/driver-app/components/application/PublicApplyHandler.jsx
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, setDoc, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, functions } from '@lib/firebase';
import { Loader2, AlertCircle, Building2, WifiOff, RefreshCw } from 'lucide-react';
import Stepper from '@shared/components/layout/Stepper';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { useData } from '@/context/DataContext';
import { isValidEmail, isValidPhone } from '@shared/utils/validation';
import * as Sentry from '@sentry/react';

// Bulletproof submission imports
import {
  initQueue,
  enqueueSubmission,
  dequeueSubmission,
  isSupported as isQueueSupported
} from '@lib/submissionQueue';
import {
  generateApplicationId,
  generateConfirmationNumber
} from '@lib/applicationId';

export function PublicApplyHandler() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const { setCurrentCompanyProfile } = useData();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [company, setCompany] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({});
  const [isUploading, setIsUploading] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState(null);
  const hasStarted = useRef(false);

  // #7 FIX: Derive custom questions from company profile for public applicants
  const customQuestions = company?.customQuestions || [];
  // #8 FIX: Dynamic consent step index based on whether custom questions exist
  const consentStepIndex = customQuestions.length > 0 ? 9 : 8;

  // 1. Load Company Info from Slug
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    async function loadCompany() {
      if (!slug) {
        setError("Invalid link - no company specified.");
        setLoading(false);
        return;
      }

      try {
        let companyData = null;
        let companyId = null;

        const q = query(collection(db, "public_profiles"), where("appSlug", "==", slug), limit(1));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          companyId = snapshot.docs[0].id;
          companyData = { id: companyId, ...snapshot.docs[0].data() };
        } else {
          const docRef = doc(db, "public_profiles", slug);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            companyId = docSnap.id;
            companyData = { id: companyId, ...docSnap.data() };
          }
        }



        if (!companyData) {
          setError("Company not found.");
          setLoading(false);
          return;
        }

        setCompany(companyData);
        // Important: Global context setter preserved
        if (setCurrentCompanyProfile) {
          setCurrentCompanyProfile(companyData);
        }

        // P2-5 FIX: Recover saved draft from localStorage on page revisit
        try {
          const savedDraft = localStorage.getItem(`draft_${slug}`);
          if (savedDraft) {
            const parsed = JSON.parse(savedDraft);
            if (parsed && typeof parsed === 'object') {
              setFormData(prev => ({ ...prev, ...parsed }));
            }
          }
        } catch (draftErr) {
          console.warn('[PublicApplyHandler] Failed to load draft:', draftErr);
        }

        const recruiter = searchParams.get('r') || searchParams.get('recruiter');
        if (recruiter) {
          sessionStorage.setItem('pending_application_recruiter', recruiter);
        }

        sessionStorage.setItem('pending_application_company', companyId);
        setLoading(false);

      } catch (err) {
        console.error("Error loading company:", err);
        setError("Unable to load application.");
        setLoading(false);
      }
    }
    loadCompany();
  }, [slug, searchParams, setCurrentCompanyProfile]);

  // 2. Form Handlers
  const handleUpdateFormData = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleNavigate = (direction) => {
    if (direction === 'next') setCurrentStep(prev => prev + 1);
    else if (direction === 'back') setCurrentStep(prev => Math.max(0, prev - 1));
    else if (typeof direction === 'number') setCurrentStep(direction);
    window.scrollTo(0, 0);
  };

  const handleFileUpload = async (fieldName, file) => {
    if (!file) return;
    setIsUploading(true);
    try {
      // SECURE UPLOAD: Use Signed URL for Guests
      // 1. Get Signed URL from Backend
      const getSignedUrlFn = httpsCallable(functions, 'getSignedUploadUrl');

      const { data: { url, storagePath, publicUrl, token } } = await getSignedUrlFn({
        companyId: company.id,
        fileName: file.name,
        fileType: file.type,
        folder: 'applications'
      });

      // 2. Perform PUT Request to Google Cloud Storage
      // The signed URL includes extensionHeaders requirements, we must pass the exact headers it expects
      const headers = { 'Content-Type': file.type };
      if (token) {
        headers['x-goog-meta-firebasestoragedownloadtokens'] = token;
      }

      const uploadRes = await fetch(url, {
        method: 'PUT',
        headers: headers,
        body: file
      });

      if (!uploadRes.ok) throw new Error('Upload request failed');

      // 3. Update Form Data
      handleUpdateFormData(fieldName, { name: file.name, url: publicUrl, storagePath });
      showSuccess("File uploaded successfully.");
    } catch (error) {
      console.error("Upload Error:", error);
      showError("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handlePartialSubmit = () => {
    localStorage.setItem(`draft_${slug}`, JSON.stringify(formData));
    showSuccess("Progress saved.");
  };

  const handleFinalSubmit = async () => {
    // Validate signature and certification
    if (!formData.signature || !formData['final-certification']) {
      showError("Please complete the electronic signature.");
      setCurrentStep(consentStepIndex);
      return;
    }

    // Validate email and phone
    if (!isValidEmail(formData.email)) {
      showError("Invalid Email Address.");
      return;
    }
    if (!isValidPhone(formData.phone)) {
      showError("Invalid Phone Number.");
      return;
    }

    // Prevent double submission
    if (submissionStatus === 'submitting') return;
    setSubmissionStatus('submitting');

    const email = formData.email || '';
    const phone = formData.phone || '';

    // Sentry breadcrumb
    Sentry.addBreadcrumb({
      category: 'submission',
      message: 'Guest application submission started',
      data: { companyId: company.id, slug },
      level: 'info',
    });

    try {
      // 1. Generate deterministic application ID
      let applicationId;
      try {
        applicationId = await generateApplicationId(company.id, email, phone);
      } catch (idError) {
        // Fallback for ID generation failure
        const prefillLeadId = searchParams.get('prefill') || searchParams.get('leadId');
        applicationId = prefillLeadId || `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }

      // 2. Generate confirmation number
      const confirmationNumber = generateConfirmationNumber();


      const recruiterCode = sessionStorage.getItem('pending_application_recruiter');

      // Note: No client-side sanitizeData() needed here — httpsCallable handles JSON serialization,
      // and the Cloud Function (submitGuestApplication) does its own sanitization server-side.
      // AF6 FIX: Removed redundant `personalInfo` wrapper — all fields are spread from formData
      // at the top level, matching the authenticated submission structure exactly.
      const applicationData = {
        applicantId: applicationId,
        applicationId: applicationId,
        confirmationNumber: confirmationNumber,
        ...formData,
        // Ensure these top-level keys always exist (overrides from formData if present)
        firstName: formData.firstName || '',
        lastName: formData.lastName || '',
        email: email,
        phone: phone,
        signature: formData.signature,
        signatureType: formData.signatureType || 'drawn',
        companyId: company.id,
        companyName: company.companyName,
        recruiterCode: recruiterCode || null,
        sourceType: 'Public Application',
        sourceSlug: slug,
        status: 'New Application',
        // BUGFIX: Removed submittedAt/createdAt serverTimestamp() from here.
        // sanitizeData() destroys FieldValue sentinels by recursing into them.
        // The Cloud Function (submitGuestApplication) adds server timestamps after sanitization.
        employers: Array.isArray(formData.employers) ? formData.employers : [],
        violations: Array.isArray(formData.violations) ? formData.violations : [],
        accidents: Array.isArray(formData.accidents) ? formData.accidents : [],
        schools: Array.isArray(formData.schools) ? formData.schools : [],
        military: Array.isArray(formData.military) ? formData.military : [],
        // Bulletproof tracking
        lifecycle: {
          status: 'pending',
          submittedAt: new Date().toISOString(),
          clientVersion: '2.0-bulletproof',
          isGuest: true,
        },
      };

      // 3. Queue first for guaranteed delivery
      let queueId = null;
      if (isQueueSupported()) {
        try {
          await initQueue();
          queueId = await enqueueSubmission(applicationData, company.id, {
            type: 'guest',
            userId: null,
          });
          console.log(`[PublicApplyHandler] Queued submission ${queueId}`);
        } catch (queueError) {
          console.warn('[PublicApplyHandler] Queue failed:', queueError);
        }
      }

      // 4. Submit via Cloud Function (Admin SDK — bypasses all rules)
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const submitFn = httpsCallable(functions, 'submitGuestApplication');
          const result = await submitFn({
            companyId: company.id,
            email: email,
            phone: phone,
            signature: formData.signature,
            formData: applicationData,
          });

          // Use server-generated values if available
          const serverData = result.data || {};

          // Success - dequeue if queued
          if (queueId) {
            try {
              await dequeueSubmission(queueId);
            } catch (dequeueError) {
              console.warn('[PublicApplyHandler] Dequeue failed:', dequeueError);
            }
          }

          setSubmissionStatus('success');
          localStorage.removeItem(`draft_${slug}`);
          sessionStorage.removeItem('pending_application_recruiter');

          Sentry.addBreadcrumb({
            category: 'submission',
            message: 'Guest application submitted successfully via Cloud Function',
            data: { applicationId: serverData.applicationId || applicationId, confirmationNumber: serverData.confirmationNumber || confirmationNumber },
            level: 'info',
          });

          // Store confirmation for display
          sessionStorage.setItem('lastConfirmationNumber', serverData.confirmationNumber || confirmationNumber);
          return; // Exit on success

        } catch (error) {
          console.warn(`[PublicApplyHandler] Attempt ${attempt} failed:`, error);
          lastError = error;
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
          }
        }
      }

      // All attempts failed
      Sentry.captureException(lastError, {
        tags: { flow: 'guest_application', stage: 'submission_failed' },
        extra: { applicationId, companyId: company.id, queueId },
      });

      // If queued, show partial success
      if (queueId) {
        setSubmissionStatus('queued');
        showSuccess("Your application is saved and will be submitted automatically when connection is restored.");
      } else {
        throw lastError;
      }

    } catch (error) {
      console.error("Submission error:", error);
      setSubmissionStatus('error');
      showError("Failed to submit application. Please try again.");
    }
  };

  if (loading) return <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center"><Loader2 className="animate-spin text-blue-600 mb-4" size={48} /><h2 className="text-lg font-semibold text-gray-700">Loading Application...</h2></div>;

  if (error) return <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4"><div className="bg-white p-8 rounded-xl shadow-lg border border-red-100 text-center max-w-md"><AlertCircle size={32} className="text-red-600 mx-auto mb-4" /><h3 className="text-xl font-bold text-gray-900 mb-2">Link Error</h3><p className="text-gray-600">{error}</p></div></div>;

  if (submissionStatus === 'success') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md border border-green-100">
        <Building2 size={40} className="text-green-600 mx-auto mb-6" />
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Application Submitted!</h2>
        <p className="text-gray-600 mb-6">Your application has been received and a recruiter will contact you soon.</p>
        <button onClick={() => navigate('/')} className="text-blue-600 hover:underline text-sm font-medium">Go to home</button>
      </div>
    </div>
  );

  // P3-3 FIX: Queued status UI — shown when all direct submit attempts failed but data is queued
  if (submissionStatus === 'queued') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md border border-amber-100">
        <Building2 size={40} className="text-amber-500 mx-auto mb-6" />
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Application Saved</h2>
        <p className="text-gray-600 mb-4">Your application has been securely saved and will be automatically submitted when your connection is restored.</p>
        <p className="text-sm text-gray-500 mb-6">You can safely close this page. No data will be lost.</p>
        <button onClick={() => navigate('/')} className="text-blue-600 hover:underline text-sm font-medium">Go to home</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 px-4 py-3 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between font-bold">{company.companyName}</div>
      </div>
      <div className="max-w-4xl mx-auto mt-6 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <Stepper step={currentStep} formData={formData} updateFormData={handleUpdateFormData} onNavigate={handleNavigate} onPartialSubmit={handlePartialSubmit} onFinalSubmit={handleFinalSubmit} handleFileUpload={handleFileUpload} isUploading={isUploading} submissionStatus={submissionStatus} customQuestions={customQuestions} />
      </div>

    </div>
  );
}
// END OF FILE