import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { useData } from '@/context/DataContext';

// Keep your existing imports for the Steps (Step1, Step2, etc.)
// import { Step1_Contact } from './steps/Step1_Contact';
// ... etc ...

export function DriverApplicationWizard() {
  const { companyId: paramCompanyId } = useParams(); // <--- CRITICAL CHANGE: Get ID from URL
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useData();

  const [loading, setLoading] = useState(true);
  const [targetCompanyId, setTargetCompanyId] = useState(null);

  useEffect(() => {
    async function initWizard() {
      // 1. Priority: ID from URL (Deep Link)
      if (paramCompanyId) {
        setTargetCompanyId(paramCompanyId);
      } 
      // 2. Fallback: Pending ID from Session Storage (PublicApplyHandler)
      else {
        const pending = sessionStorage.getItem('pending_application_company');
        if (pending) {
           setTargetCompanyId(pending);
        } else {
           // 3. Fallback: Global Pool (No specific company)
           console.log("No specific company target - applying to General Pool");
        }
      }
      setLoading(false);
    }
    initWizard();
  }, [paramCompanyId]);

  // ... [Rest of your existing Wizard Logic] ...

  // When saving the application, ensure you use 'targetCompanyId'
  const handleSubmit = async () => {
      // ...
      // const path = targetCompanyId 
      //    ? `companies/${targetCompanyId}/applications/${currentUser.uid}` 
      //    : `leads/${currentUser.uid}`;
      // ...
  };

  if (loading) return <div>Loading Application...</div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
       {/* Render your Wizard Steps here as before */}
       {/* Pass 'targetCompanyId' to your steps if they need it */}
    </div>
  );
}