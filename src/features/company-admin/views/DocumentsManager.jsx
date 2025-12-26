import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import EnvelopeCreator from '@features/signing/EnvelopeCreator';
import EnvelopeHistory from '@features/signing/components/EnvelopeHistory';
import { GlobalLoadingState } from '@shared/components/feedback';
import { FileSignature, History, ArrowLeft, Plus } from 'lucide-react';

export default function DocumentsManager() {
  const { currentCompanyProfile, loading } = useData();
  const navigate = useNavigate();
  
  // Default to 'list' view, switch to 'create' when needed
  const [activeTab, setActiveTab] = useState('list'); 

  if (loading) return <GlobalLoadingState />;
  if (!currentCompanyProfile) {
     setTimeout(() => navigate('/company/dashboard'), 100);
     return <GlobalLoadingState />;
  }

  // If in 'create' mode, we render the Creator FULL SCREEN (as it was before)
  if (activeTab === 'create') {
      return (
          <EnvelopeCreator 
              companyId={currentCompanyProfile.id} 
              onClose={() => setActiveTab('list')} // Go back to list on close
          />
      );
  }

  // 'List' Mode (The Dashboard)
  return (
    <div className="min-h-screen bg-gray-50 p-6 sm:p-8">
        <div className="max-w-6xl mx-auto space-y-6">
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <button 
                        onClick={() => navigate('/company/dashboard')} 
                        className="flex items-center gap-2 text-gray-500 hover:text-gray-800 text-sm font-medium mb-2 transition-colors"
                    >
                        <ArrowLeft size={16}/> Back to Dashboard
                    </button>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <FileSignature className="text-blue-600"/> Documents Center
                    </h1>
                    <p className="text-gray-500 text-sm">Manage contracts, offers, and agreements.</p>
                </div>

                <button 
                    onClick={() => setActiveTab('create')}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 hover:shadow-blue-200 transition-all transform hover:-translate-y-0.5"
                >
                    <Plus size={20}/> Send New Document
                </button>
            </div>

            {/* Tabs (Visual only since we swap content above) */}
            <div className="flex border-b border-gray-200">
                <button 
                    className={`px-6 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors border-blue-600 text-blue-600`}
                >
                    <History size={16}/> Sent & Received
                </button>
                {/* We could add Drafts here later */}
            </div>

            {/* Content */}
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <EnvelopeHistory companyId={currentCompanyProfile.id} />
            </div>

        </div>
    </div>
  );
}