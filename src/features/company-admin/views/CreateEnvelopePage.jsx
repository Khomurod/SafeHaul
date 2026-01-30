import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
// FIX: Corrected import path (removed '/components')
import EnvelopeCreator from '@features/signing/EnvelopeCreator'; 
import GlobalLoadingState from '@shared/components/feedback/GlobalLoadingState';

export default function CreateEnvelopePage() {
  const { currentCompanyProfile, loading } = useData();
  const navigate = useNavigate();

  // 1. Loading State
  if (loading) return <GlobalLoadingState />;

  // 2. Safety Check: If page accessed without a selected company, redirect
  if (!currentCompanyProfile) {
     setTimeout(() => navigate('/company/dashboard'), 100);
     return <GlobalLoadingState />;
  }

  // 3. Render the Envelope Creator
  return (
    <div className="h-screen w-full bg-white">
        <EnvelopeCreator 
            companyId={currentCompanyProfile.id} 
            onClose={() => navigate('/company/dashboard')} 
        />
    </div>
  );
}