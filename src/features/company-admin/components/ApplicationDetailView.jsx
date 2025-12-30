import React, { useState } from 'react';
import { generateApplicationPDF } from '@shared/utils/pdfGenerator.js';
import { getFieldValue } from '@shared/utils/helpers.js';
import { useData } from '@/context/DataContext';
import { useApplicationDetails } from '@features/applications/hooks/useApplicationDetails';
import { 
  Download, X, ArrowRight, Edit2, Save, Trash2, 
  FileText, UserCheck, Folder, FileSignature, MessageSquare, Clock, Mail
} from 'lucide-react';

// --- Local Feature Imports (New Structure) ---
import { ApplicationInfo } from './application';
import { DQFileTab, GeneralDocumentsTab, NotesTab, ActivityHistoryTab } from './tabs';
import { SendOfferModal } from './modals';

// --- Shared/External Imports ---
import { MoveApplicationModal, DeleteConfirmModal } from '@shared/components/modals/ApplicationModals.jsx';
import { ContactTab } from '@features/companies'; 

function SideTab({ label, icon, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all border-l-4 
        ${isActive 
          ? 'bg-white border-blue-600 text-blue-700 shadow-sm' 
          : 'border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`}
    >
      <span className={isActive ? "text-blue-600" : "text-gray-400"}>{icon}</span>
      {label}
    </button>
  );
}

export function ApplicationDetailView({ 
  companyId, 
  applicationId, 
  onClosePanel, 
  onStatusUpdate,
  isCompanyAdmin, 
  onPhoneClick 
}) {
  const { currentUserClaims } = useData();
  const {
    loading, error, appData, companyProfile, collectionName, fileUrls, currentStatus,
    isEditing, setIsEditing, isSaving, isUploading, canEdit,
    teamMembers, assignedTo, handleAssignChange,
    loadApplication, handleDataChange, handleAdminFileUpload, handleAdminFileDelete, handleSaveEdit, handleStatusUpdate,
    handleDriverTypeUpdate 
  } = useApplicationDetails(companyId, applicationId, onStatusUpdate);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [activeTab, setActiveTab] = useState('application');

  const isSuperAdmin = currentUserClaims?.roles?.globalRole === 'super_admin';
  const canEditAllFields = isCompanyAdmin || isSuperAdmin;

  const currentAppName = getFieldValue(appData?.['firstName']) + ' ' + getFieldValue(appData?.['lastName']);
  const driverId = appData?.driverId || appData?.userId;

  const handleDownloadPdf = () => {
    if (!appData || !companyProfile) return;
    try {
      generateApplicationPDF({ applicant: appData, agreements: [], company: companyProfile });
    } catch (e) {
      alert("PDF Generation failed.");
    }
  };

  const handleManagementComplete = () => {
    if (onStatusUpdate) onStatusUpdate();
    onClosePanel(); 
  };

  const renderTabContent = () => {
    if (loading) return <div className="flex h-full items-center justify-center"><p className="text-gray-500">Loading...</p></div>;
    if (error) return <div className="flex h-full items-center justify-center"><p className="text-red-500">{error}</p></div>;
    if (!appData) return <div className="flex h-full items-center justify-center"><p className="text-gray-500">No Data</p></div>;

    switch (activeTab) {
      case 'application':
        return (
          <ApplicationInfo
            appData={appData}
            fileUrls={fileUrls}
            isEditing={isEditing}
            isUploading={isUploading}
            handleDataChange={handleDataChange}
            handleAdminFileUpload={handleAdminFileUpload}
            handleAdminFileDelete={handleAdminFileDelete}
            companyId={companyId}
            applicationId={applicationId}
            currentStatus={currentStatus}
            handleStatusUpdate={handleStatusUpdate}
            handleDriverTypeUpdate={handleDriverTypeUpdate} 
            isCompanyAdmin={isCompanyAdmin} 
            isSuperAdmin={isSuperAdmin}
            canEdit={canEdit}
            canEditAllFields={canEditAllFields}
            onPhoneClick={onPhoneClick} 
          />
        );
      case 'contact': return <ContactTab companyId={companyId} recordId={applicationId} collectionName={collectionName} email={appData.email} phone={appData.phone} />;
      case 'dqFile': return <DQFileTab companyId={companyId} applicationId={applicationId} collectionName={collectionName} />;
      case 'documents': return <GeneralDocumentsTab companyId={companyId} applicationId={applicationId} appData={appData} fileUrls={fileUrls} collectionName={collectionName} />;
      case 'notes': return <NotesTab companyId={companyId} applicationId={applicationId} collectionName={collectionName} />;
      case 'activity': return <ActivityHistoryTab companyId={companyId} applicationId={applicationId} collectionName={collectionName} />;
      default: return null;
    }
  };

  return (
    // FIX: Increased z-index from z-40 to z-[60] to sit above Dashboard Header (z-50)
    <div className="fixed inset-0 bg-slate-900/60 z-[60] backdrop-blur-sm flex justify-end transition-opacity duration-300" onClick={onClosePanel}>

      <div 
        className="bg-gray-50 w-[85%] md:w-[75%] lg:w-[65%] h-full shadow-2xl flex flex-col border-l border-gray-200 transform transition-transform duration-300"
        onClick={e => e.stopPropagation()}
      >

        {/* Header */}
        <div className="p-6 border-b border-gray-200 bg-white shrink-0 flex justify-between items-center shadow-sm z-10">
            <div>
                <h2 className="text-2xl font-bold text-gray-800 tracking-tight">
                    {loading ? "Loading..." : currentAppName}
                </h2>
                {!loading && appData && (
                    <p className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 bg-gray-100 rounded text-xs border border-gray-200 font-mono">{appData.id}</span>
                        &bull; {appData.email} 
                    </p>
                )}
            </div>
            <div className="flex items-center gap-3">
                {!loading && appData && (
                    <>
                        {canEdit && ['Approved', 'Background Check'].includes(currentStatus) && (
                            <button onClick={() => setShowOfferModal(true)} className="px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-lg hover:bg-green-700 transition shadow-sm flex items-center gap-2">
                                <FileSignature size={16} /> Offer
                            </button>
                        )}
                        <button className="px-4 py-2 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 text-sm transition flex items-center gap-2" onClick={handleDownloadPdf}>
                            <Download size={16} /> PDF
                        </button>
                    </>
                )}
                <div className="h-8 w-px bg-gray-300 mx-1"></div>
                <button className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition" onClick={onClosePanel}>
                    <X size={24} />
                </button>
            </div>
        </div>

        {/* Main Layout */}
        <div className="flex flex-1 overflow-hidden">

            {/* Professional Sidebar */}
            <div className="w-64 bg-gray-100/50 border-r border-gray-200 p-4 flex flex-col gap-1 overflow-y-auto shrink-0">
                <div className="mb-6">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2 px-2">Assignee</label>
                    <select 
                        className="w-full p-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
                        value={assignedTo}
                        onChange={(e) => handleAssignChange(e.target.value)}
                        disabled={!canEdit}
                    >
                        <option value="">Unassigned</option>
                        {teamMembers.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                    </select>
                </div>

                <div className="space-y-1">
                    <SideTab label="Application Data" icon={<FileText size={18} />} isActive={activeTab === 'application'} onClick={() => setActiveTab('application')} />
                    <SideTab label="Contact Driver" icon={<Mail size={18} />} isActive={activeTab === 'contact'} onClick={() => setActiveTab('contact')} />
                    <SideTab label="Internal Notes" icon={<MessageSquare size={18} />} isActive={activeTab === 'notes'} onClick={() => setActiveTab('notes')} />
                    <SideTab label="DQ File" icon={<UserCheck size={18} />} isActive={activeTab === 'dqFile'} onClick={() => setActiveTab('dqFile')} />
                    <SideTab label="Documents" icon={<Folder size={18} />} isActive={activeTab === 'documents'} onClick={() => setActiveTab('documents')} />
                    <div className="my-4 border-t border-gray-200 mx-4"></div>
                    <SideTab label="Activity History" icon={<Clock size={18} />} isActive={activeTab === 'activity'} onClick={() => setActiveTab('activity')} />
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto bg-white p-8 scroll-smooth">
                {renderTabContent()}
            </div>

        </div>

        {/* Footer Actions */}
        {(canEdit || isSuperAdmin) && activeTab === 'application' && (
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center shrink-0 z-10">
                 <div className="flex gap-3">
                    {isSuperAdmin && !isEditing && (
                        <button className="px-4 py-2 bg-indigo-100 text-indigo-700 font-bold rounded-lg hover:bg-indigo-200 transition flex items-center gap-2" onClick={() => setShowMoveModal(true)}>
                            <ArrowRight size={16} /> Move
                        </button>
                    )}

                    {!isEditing ? (
                        <button className="px-4 py-2 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-100 transition flex items-center gap-2 shadow-sm" onClick={() => setIsEditing(true)}>
                            <Edit2 size={16} /> Edit Application
                        </button>
                    ) : (
                        <>
                            <button className="px-4 py-2 text-gray-600 hover:underline font-medium" onClick={() => {setIsEditing(false); loadApplication();}}>Cancel</button>
                            <button className="px-6 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition flex items-center gap-2 shadow-md" onClick={handleSaveEdit} disabled={isSaving}>
                                <Save size={16} /> Save Changes
                            </button>
                        </>
                    )}
                 </div>
                 {!isEditing && (
                    <button className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-bold transition flex items-center gap-2" onClick={() => setShowDeleteConfirm(true)}>
                        <Trash2 size={16} /> Delete
                    </button>
                 )}
            </div>
        )}

        {/* Modals */}
        {showDeleteConfirm && (
            <DeleteConfirmModal 
                appName={currentAppName} 
                companyId={companyId} 
                applicationId={applicationId}
                collectionName={collectionName}
                onClose={() => setShowDeleteConfirm(false)} 
                onDeletionComplete={handleManagementComplete} 
            />
        )}
        {showMoveModal && isSuperAdmin && <MoveApplicationModal sourceCompanyId={companyId} applicationId={applicationId} onClose={() => setShowMoveModal(false)} onMoveComplete={handleManagementComplete} />}
        {showOfferModal && <SendOfferModal companyId={companyId} applicationId={applicationId} driverId={driverId} driverName={currentAppName} onClose={() => setShowOfferModal(false)} onOfferSent={() => { handleStatusUpdate('Offer Sent'); loadApplication(); }} />}

      </div>
    </div>
  );
}