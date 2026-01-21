/**
 * Draft Recovery Modal
 * 
 * Shows when a user has an existing draft application and gives them
 * the option to resume or start fresh.
 */

import React from 'react';
import { FileText, RefreshCw, ArrowRight, X } from 'lucide-react';

/**
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the modal is visible
 * @param {Object} props.draftData - The draft data (for displaying info)
 * @param {Function} props.onResume - Called when user wants to resume
 * @param {Function} props.onStartFresh - Called when user wants to start over
 * @param {Function} props.onClose - Called to close the modal
 */
export function DraftRecoveryModal({ isOpen, draftData, onResume, onStartFresh, onClose }) {
    if (!isOpen) return null;

    const lastStep = draftData?.lastStep || 0;
    const lastSaved = draftData?.lastSavedAt
        ? new Date(draftData.lastSavedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        })
        : 'Unknown';

    const firstName = draftData?.firstName || '';
    const stepNames = [
        'Personal Information',
        'Qualifications',
        'License Information',
        'Motor Vehicle Record',
        'Accident History',
        'Employment History',
        'General Questions',
        'Review',
        'Signature',
    ];
    const currentStepName = stepNames[lastStep] || `Step ${lastStep + 1}`;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-5 text-white">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-lg">
                            <FileText size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">Welcome Back{firstName ? `, ${firstName}` : ''}!</h2>
                            <p className="text-blue-100 text-sm mt-0.5">You have an unfinished application</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-1 text-white/70 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    <div className="bg-blue-50 rounded-lg p-4 mb-6">
                        <div className="text-sm text-blue-800">
                            <p><strong>Last saved:</strong> {lastSaved}</p>
                            <p><strong>Progress:</strong> {currentStepName}</p>
                        </div>
                    </div>

                    <p className="text-gray-600 text-sm mb-6">
                        Would you like to continue where you left off, or start a fresh application?
                    </p>

                    {/* Actions */}
                    <div className="space-y-3">
                        <button
                            onClick={onResume}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            <ArrowRight size={18} />
                            Continue Application
                        </button>

                        <button
                            onClick={onStartFresh}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors"
                        >
                            <RefreshCw size={18} />
                            Start Fresh
                        </button>
                    </div>

                    <p className="text-xs text-gray-400 text-center mt-4">
                        Starting fresh will permanently delete your saved progress.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default DraftRecoveryModal;
