// src/features/driver-app/components/application/PublicApplyHandler.jsx
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, setDoc, serverTimestamp, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@lib/firebase';
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

        const q = query(collection(db, "companies"), where("appSlug", "==", slug), limit(1));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          companyId = snapshot.docs[0].id;
          companyData = { id: companyId, ...snapshot.docs[0].data() };
        } else {
          const docRef = doc(db, "companies", slug);
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
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('@lib/firebase'); // Lazy load to ensure init

      const getSignedUrlFn = httpsCallable(functions, 'getSignedUploadUrl');

      const { data: { url, storagePath, publicUrl } } = await getSignedUrlFn({
        companyId: company.id,
        fileName: file.name,
        fileType: file.type,
        folder: 'applications'
      });

      // 2. Perform PUT Request to Google Cloud Storage
      const uploadRes = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
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
      showError("Please complete the electronic signature in Step 9.");
      setCurrentStep(8);
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

      const timestamp = serverTimestamp();
      const recruiterCode = sessionStorage.getItem('pending_application_recruiter');

      // Sanitize data helper
      function sanitizeData(data) {
        if (data === undefined) return null;
        if (data === null) return null;
        if (data instanceof Date) return data;
        if (Array.isArray(data)) return data.map(sanitizeData);
        if (typeof data === 'object') {
          const sanitized = {};
          for (const key in data) {
            sanitized[key] = sanitizeData(data[key]);
          }
          return sanitized;
        }
        return data;
      }

      const applicationData = sanitizeData({
        applicantId: applicationId,
        applicationId: applicationId,
        confirmationNumber: confirmationNumber,
        personalInfo: {
          firstName: formData.firstName || '',
          lastName: formData.lastName || '',
          email: email,
          phone: phone,
        },
        ...formData,
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
        submittedAt: timestamp,
        createdAt: timestamp,
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
      });

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

      // 4. Attempt submission with retries
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const appRef = doc(db, "companies", company.id, "applications", applicationId);
          await setDoc(appRef, applicationData, { merge: true });

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
            message: 'Guest application submitted successfully',
            data: { applicationId, confirmationNumber },
            level: 'info',
          });

          // Store confirmation for display
          sessionStorage.setItem('lastConfirmationNumber', confirmationNumber);
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

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 px-4 py-3 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between font-bold">{company.companyName}</div>
      </div>
      <div className="max-w-4xl mx-auto mt-6 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <Stepper step={currentStep} formData={formData} updateFormData={handleUpdateFormData} onNavigate={handleNavigate} onPartialSubmit={handlePartialSubmit} onFinalSubmit={handleFinalSubmit} handleFileUpload={handleFileUpload} isUploading={isUploading} submissionStatus={submissionStatus} />
      </div>

    </div>
  );
}
// END OF FILE