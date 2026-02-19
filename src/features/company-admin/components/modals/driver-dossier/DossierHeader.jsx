import React from 'react';
import { X, Check, XCircle, ArrowRight, Download } from 'lucide-react';
import { generateApplicationPDF } from '@shared/utils/pdfGenerator';

export function DossierHeader({
    activeTab,
    appData,
    companyProfile,
    currentStatus,
    onClose,
    onStatusUpdate,
    canEdit
}) {
    // Dynamic Title based on Active Tab
    const getTitle = () => {
        switch (activeTab) {
            case 'application': return 'Application Review';
            case 'documents': return 'Document Gallery';
            case 'dq': return 'Driver Qualification File';
            case 'activity': return 'Activity Timeline';
            case 'notes': return 'Internal Notes';
            case 'pev': return 'Previous Employment Verification';
            default: return 'Driver Dossier';
        }
    };

    const handleDownload = () => {
        if (appData) {
            generateApplicationPDF({
                applicant: appData,
                company: companyProfile,
                agreements: [] // Agreements are fetched inside generator if needed, or passed here
            });
        }
    };

    // Actions
    const handleAction = (action) => {
        if (!onStatusUpdate) return;

        // This is a simplified version - typically you'd open a confirmation modal
        // or call the status update directly.
        // For now, we'll assume direct update for this shell implementation
        // but integrating with the existing logic is key in Phase 3.
        if (action === 'approve') onStatusUpdate('Approved');
        if (action === 'reject') onStatusUpdate('Rejected');
    };

    return (
        <>
            {/* Left: Title */}
            <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold text-gray-800">{getTitle()}</h2>

                {activeTab === 'application' && (
                    <span className="text-xs text-gray-400 font-medium px-2 py-1 bg-gray-50 rounded-md border border-gray-100">
                        {appData ? `App ID: ${appData.id?.slice(0, 8)}` : 'Loading...'}
                    </span>
                )}
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-3">
                {/* Download Button - Always Visible */}
                <button
                    onClick={handleDownload}
                    className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors mr-2 border border-transparent hover:border-blue-100"
                    title="Download PDF"
                >
                    <Download size={20} />
                </button>

                {canEdit && (
                    <>
                        <button
                            onClick={() => handleAction('reject')}
                            className="px-3 py-2 text-sm font-semibold text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2"
                        >
                            <XCircle size={16} />
                            <span className="hidden sm:inline">Reject</span>
                        </button>

                        <div className="h-6 w-px bg-gray-200 mx-1" />

                        <button
                            onClick={() => handleAction('approve')}
                            className="px-4 py-2 text-sm font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow-sm hover:shadow transition-all flex items-center gap-2"
                        >
                            <Check size={16} />
                            <span>Approve Application</span>
                        </button>
                    </>
                )}

                <div className="h-6 w-px bg-gray-200 mx-2" />

                <button
                    onClick={onClose}
                    className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
                >
                    <X size={24} />
                </button>
            </div>
        </>
    );
}
