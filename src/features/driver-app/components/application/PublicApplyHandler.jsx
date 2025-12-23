import React, { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore';
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
  const { setCurrentCompanyProfile } = useData(); // Global context setter to ensure steps can access config

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

        // Try finding by custom slug first
        const q = query(collection(db, "companies"), where("appSlug", "==", slug));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          companyId = snapshot.docs[0].id;
          companyData = { id: companyId, ...snapshot.docs[0].data() };
        } else {
          // Fallback: Try ID direct match
          const docRef = doc(db, "companies", slug);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            companyId = docSnap.id;
            companyData = { id: companyId, ...docSnap.data() };
          }
        }

        if (!companyData) {
          setError("Company not found. Please check the link and try again.");
          setLoading(false);
          return;
        }

        setCompany(companyData);
        // Important: Set this to global context so steps (like Step3_License) can read 'applicationConfig'
        if (setCurrentCompanyProfile) {
            setCurrentCompanyProfile(companyData);
        }

        // Check for Recruiter Code
        const recruiter = searchParams.get('r') || searchParams.get('recruiter');
        if (recruiter) {
          sessionStorage.setItem('pending_application_recruiter', recruiter);
        }

        // Save company ID for potential login redirect later
        sessionStorage.setItem('pending_application_company', companyId);

        setLoading(false);

      } catch (err) {
        console.error("Error loading company:", err);
        setError("Unable to load application. Please try again later.");
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
      if (direction === 'next') {
          setCurrentStep(prev => prev + 1);
      } else if (direction === 'back') {
          setCurrentStep(prev => Math.max(0, prev - 1));
      } else if (typeof direction === 'number') {
          setCurrentStep(direction);
      }
      window.scrollTo(0, 0);
  };

  const handleFileUpload = async (fieldName, file) => {
      if (!file) return;
      setIsUploading(true);
      try {
          // For public users (no UID yet), use a temporary folder or organize by email/phone if available
          // Better strategy: Use a random ID for the session/application
          const tempId = formData.email || Date.now().toString();
          const storagePath = `companies/${company.id}/applications/pending_${tempId}/${fieldName}/${file.name}`;

          const fileRef = ref(storage, storagePath);
          await uploadBytes(fileRef, file);
          const downloadURL = await getDownloadURL(fileRef);

          const fileData = {
              name: file.name,
              url: downloadURL,
              storagePath: storagePath
          };

          handleUpdateFormData(fieldName, fileData);
          showSuccess("File uploaded successfully.");

      } catch (error) {
          console.error("Upload failed:", error);
          showError("Upload failed. Please try again.");
      } finally {
          setIsUploading(false);
      }
  };

  const handlePartialSubmit = () => {
      // For public users, "Save Draft" might prompt them to create an account
      // For now, we'll just show a message or save to localStorage
      localStorage.setItem(`draft_${slug}`, JSON.stringify(formData));
      showSuccess("Progress saved to this browser.");
  };

  const handleFinalSubmit = async () => {
    // Validation
    if (!formData.signature || !formData.signature.startsWith('TEXT_SIGNATURE')) {
        alert("Please sign the application in the Review step.");
        return;
    }

    setSubmissionStatus('submitting');

    try {
        const timestamp = serverTimestamp();
        const recruiterCode = sessionStorage.getItem('pending_application_recruiter');

        // --- CRITICAL FIX START: Align with Firestore Rules ---
        // 1. Generate unique Guest ID for 'applicantId' field
        const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const applicationData = {
            // 2. Satisfy rules requiring 'applicantId'
            applicantId: guestId,

            // 3. Satisfy rules requiring nested 'personalInfo' object
            personalInfo: {
                firstName: formData.firstName || '',
                lastName: formData.lastName || '',
                email: formData.email || '',
                phone: formData.phone || '',
            },

            // Spread the rest of the data (flat) for backward compatibility
            ...formData,

            companyId: company.id,
            companyName: company.companyName,
            recruiterCode: recruiterCode || null,
            sourceType: 'Public Application',
            sourceSlug: slug,
            status: 'New Application',
            submittedAt: timestamp,
            createdAt: timestamp,
            // Ensure lists are arrays
            employers: Array.isArray(formData.employers) ? formData.employers : [],
            violations: Array.isArray(formData.violations) ? formData.violations : [],
            accidents: Array.isArray(formData.accidents) ? formData.accidents : [],
            schools: Array.isArray(formData.schools) ? formData.schools : [],
            military: Array.isArray(formData.military) ? formData.military : []
        };
        // --- CRITICAL FIX END ---

        const applicationsRef = collection(db, "companies", company.id, "applications");
        await addDoc(applicationsRef, applicationData);

        setSubmissionStatus('success');
        localStorage.removeItem(`draft_${slug}`); // Clear local draft
        sessionStorage.removeItem('pending_application_recruiter');

    } catch (error) {
        console.error("Submission error:", error);
        setSubmissionStatus('error');
        showError("Failed to submit application. Please try again.");
    }
  };

  // --- Render States ---

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
        <h2 className="text-lg font-semibold text-gray-700">Loading Application...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg border border-red-100 text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={32} />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">Link Error</h3>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (submissionStatus === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md border border-green-100">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <Building2 size={40} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Application Submitted!</h2>
          <p className="text-gray-600 mb-6">
            Thank you for applying to <strong>{company.companyName}</strong>. 
            Your application has been received and a recruiter will contact you soon.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="text-blue-600 hover:underline text-sm font-medium"
          >
            Start a new application
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Public Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 px-4 py-3 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {company.logoUrl ? (
              <img src={company.logoUrl} alt={company.companyName} className="h-8 w-auto" />
            ) : (
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <Building2 size={18} className="text-blue-600" />
              </div>
            )}
            <span className="font-bold text-gray-900">{company.companyName}</span>
          </div>
          <div className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">
            Secure Application
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto mt-6 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <Stepper 
            step={currentStep}
            formData={formData}
            updateFormData={handleUpdateFormData}
            onNavigate={handleNavigate}
            onPartialSubmit={handlePartialSubmit}
            onFinalSubmit={handleFinalSubmit}
            handleFileUpload={handleFileUpload}
            isUploading={isUploading}
            submissionStatus={submissionStatus}
        />
      </div>
    </div>
  );
}