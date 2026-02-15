import React, { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useApplicationView } from '@features/company-admin/hooks/useApplicationView';
import { DossierSidebar } from './DossierSidebar';
import { DossierHeader } from './DossierHeader';
import { DossierContent } from './DossierContent';

/**
 * DriverProfileModal
 * 
 * The main container for the Driver Dossier (3-pane modal).
 * It manages the active tab state and orchestrates the data fetching via useApplicationView.
 */
export function DriverProfileModal({
    companyId,
    driverId,
    isOpen,
    onClose
}) {
    const [activeTab, setActiveTab] = useState('application');

    // Use the existing hook for data fetching
    // We pass onClose as onClosePanel to the hook
    const {
        loading,
        error,
        appData,
        companyProfile,
        currentStatus,
        isEditing,
        setIsEditing,
        isSaving,
        canEdit,
        canEditAllFields,
        handleStatusUpdate,
        handleSaveEdit,
        handleManagementComplete,
        fileUrls,
        dqStatus,
        activities, // Note: these might need to be passed down or fetched inside tabs
        notes,
        collectionName // Get collectionName from hook
    } = useApplicationView(companyId, driverId, null, onClose, null);

    // Close on Escape key
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
            {/* Backdrop with blur */}
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Modal Card */}
            <div className="relative bg-white w-[90vw] h-[90vh] max-w-7xl rounded-2xl shadow-2xl overflow-hidden flex flex-row animate-in fade-in zoom-in-95 duration-200">

                {/* 1. Sidebar (Pane A) - Fixed Width */}
                <div className="w-[280px] shrink-0 border-r border-gray-200 bg-slate-50 h-full">
                    <DossierSidebar
                        appData={appData}
                        currentStatus={currentStatus}
                        activeTab={activeTab}
                        setActiveTab={setActiveTab}
                        loading={loading}
                        dqStatus={dqStatus}
                    />
                </div>

                {/* Right Side Container */}
                <div className="flex-1 flex flex-col min-w-0 bg-white h-full">

                    {/* 2. Header (Pane B) - Sticky Top */}
                    <div className="h-16 shrink-0 border-b border-gray-100 flex items-center justify-between px-6 bg-white z-10">
                        <DossierHeader
                            activeTab={activeTab}
                            appData={appData}
                            companyProfile={companyProfile}
                            currentStatus={currentStatus}
                            onClose={onClose}
                            onStatusUpdate={handleStatusUpdate}
                            canEdit={canEdit}
                        />
                    </div>

                    {/* 3. Content (Pane C) - Scrollable */}
                    <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 bg-white relative">
                        {loading ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-20">
                                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                            </div>
                        ) : error ? (
                            <div className="p-8 text-center text-red-500">
                                <p>Error loading application details.</p>
                                <p className="text-sm mt-2 text-gray-400">{error}</p>
                            </div>
                        ) : (
                            <DossierContent
                                activeTab={activeTab}
                                appData={appData}
                                driverId={driverId}
                                companyId={companyId}
                                collectionName={collectionName}
                                isEditing={isEditing}
                                setIsEditing={setIsEditing}
                                handleSaveEdit={handleSaveEdit}
                                isSaving={isSaving}
                                fileUrls={fileUrls}
                                canEdit={canEdit}
                            />
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
