// src/features/driver-app/components/application/PublicApplyHandler.jsx
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'; 
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@lib/firebase';
import { Loader2, AlertCircle, Building2 } from 'lucide-react';
import Stepper from '@shared/components/layout/Stepper';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { useData } from '@/context/DataContext';

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

        const q = query(collection(db, "companies"), where("appSlug", "==", slug));
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
          const tempId = formData.email || Date.now().toString();
          const storagePath = `companies/${company.id}/applications/pending_${tempId}/${fieldName}/${file.name}`;
          const fileRef = ref(storage, storagePath);
          await uploadBytes(fileRef, file);
          const downloadURL = await getDownloadURL(fileRef);

          handleUpdateFormData(fieldName, { name: file.name, url: downloadURL, storagePath: storagePath });
          showSuccess("File uploaded successfully.");
      } catch (error) {
          showError("Upload failed.");
      } finally {
          setIsUploading(false);
      }
  };

  const handlePartialSubmit = () => {
      localStorage.setItem(`draft_${slug}`, JSON.stringify(formData));
      showSuccess("Progress saved.");
  };

  const handleFinalSubmit = async () => {
    // FIX: Validate the actual fields from Step 9 (Signature Name + Checkbox)
    if (!formData.signatureName || !formData['final-certification']) {
        showError("Please complete the electronic signature in Step 9.");
        setCurrentStep(8); // Automatically jump to Step 9 (0-based index)
        return;
    }

    // DUPLICATION PREVENTION: Click Guard
    if (submissionStatus === 'submitting') return;
    setSubmissionStatus('submitting');

    try {
        const timestamp = serverTimestamp();
        const recruiterCode = sessionStorage.getItem('pending_application_recruiter');
        
        // DUPLICATION PREVENTION: Prefill detection for Lead IDs
        const prefillLeadId = searchParams.get('prefill') || searchParams.get('leadId');
        const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // DATA PRESERVATION: Maintained 'personalInfo' nested object for Firestore Rules
        const applicationData = {
            applicantId: prefillLeadId || guestId,
            personalInfo: {
                firstName: formData.firstName || '',
                lastName: formData.lastName || '',
                email: formData.email || '',
                phone: formData.phone || '',
            },
            ...formData,
            // FIX: Construct the signature field expected by the backend PDF generator
            signature: `TEXT_SIGNATURE:${formData.signatureName}`,
            
            companyId: company.id,
            companyName: company.companyName,
            recruiterCode: recruiterCode || null,
            sourceType: prefillLeadId ? 'Invite-Link Application' : 'Public Application',
            sourceSlug: slug,
            status: 'New Application',
            submittedAt: timestamp,
            createdAt: timestamp,
            employers: Array.isArray(formData.employers) ? formData.employers : [],
            violations: Array.isArray(formData.violations) ? formData.violations : [],
            accidents: Array.isArray(formData.accidents) ? formData.accidents : [],
            schools: Array.isArray(formData.schools) ? formData.schools : [],
            military: Array.isArray(formData.military) ? formData.military : []
        };

        // DUPLICATION PREVENTION: Use deterministic ID (updates Lead instead of duplicating)
        const docId = prefillLeadId || guestId;
        const appRef = doc(db, "companies", company.id, "applications", docId);
        await setDoc(appRef, applicationData, { merge: true });

        setSubmissionStatus('success');
        localStorage.removeItem(`draft_${slug}`);
        sessionStorage.removeItem('pending_application_recruiter');

    } catch (error) {
        console.error("Submission error:", error);
        setSubmissionStatus('error');
        showError("Failed to submit application.");
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