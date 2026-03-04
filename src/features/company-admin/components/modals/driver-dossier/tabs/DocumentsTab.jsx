import React, { useState } from 'react';
import {
    FileText,
    Calendar,
    Eye,
    Download,
    X,
    Image
} from 'lucide-react';
import { formatDate } from '@shared/utils/helpers';

export function DocumentsTab({ fileUrls = {}, appData }) {
    const [previewDoc, setPreviewDoc] = useState(null);

    // Combine standard keys + uploads
    // This logic mimics InlineDocumentsStrip but formatted for a grid
    const allDocs = [];

    // 1. Helper to push docs — checks fileUrls (resolved URLs), then appData direct (file objects with .url)
    const addDoc = (key, label, date = null) => {
        const resolvedUrl = fileUrls[key];
        const appDirectUrl = appData?.[key]?.url;
        const uploadedUrl = appData?.uploadedDocuments?.[key];
        const url = resolvedUrl || appDirectUrl || uploadedUrl;

        if (url) {
            allDocs.push({
                id: key,
                label: label,
                url: url,
                date: date || appData?.updatedAt,
                type: 'pdf/image'
            });
        }
    };

    // 2. Add Standard Docs (keys match applicationSchema.js)
    addDoc('cdl-front', 'CDL Front');
    addDoc('cdl-back', 'CDL Back');
    addDoc('medical-card-upload', 'Medical Card');
    addDoc('ssc-upload', 'SSN Card');
    addDoc('twic-card-upload', 'TWIC Card');
    addDoc('mvr-upload', 'MVR Report');
    addDoc('mvr-consent-upload', 'MVR Consent');
    addDoc('drug-test-consent-upload', 'Drug Test Consent');

    // 3. Add Dynamic Uploads (if any exist in appData that aren't above)
    // For now, we'll stick to the core ones to match the prompt's simplicity, 
    // but in a real app might iterate over keys.

    if (allDocs.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <FileText size={48} className="mb-4 text-gray-300" />
                <p>No documents found for this applicant.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h3 className="text-lg font-bold text-gray-800 px-1">Uploaded Documents</h3>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {allDocs.map((doc) => (
                    <div
                        key={doc.id}
                        className="group relative bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-all cursor-pointer aspect-[3/4] flex flex-col"
                        onClick={() => setPreviewDoc(doc)}
                    >
                        {/* Thumbnail Preview (Fake for PDF, Real for Image if possible) */}
                        <div className="flex-1 bg-gray-50 flex items-center justify-center p-4">
                            <FileText size={40} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
                        </div>

                        {/* Footer Info */}
                        <div className="p-3 bg-white border-t border-gray-100">
                            <p className="font-bold text-xs text-gray-700 truncate" title={doc.label}>{doc.label}</p>
                            <p className="text-[10px] text-gray-400 mt-1">{doc.date ? formatDate(doc.date) : 'Unknown Date'}</p>
                        </div>

                        {/* Overlay on Hover */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <div className="bg-white p-2 rounded-full text-gray-800 shadow-lg">
                                <Eye size={16} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Lightbox Modal */}
            {previewDoc && (
                <div
                    className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm"
                    onClick={() => setPreviewDoc(null)}
                >
                    <div className="relative w-full h-full max-w-5xl flex flex-col" onClick={e => e.stopPropagation()}>
                        {/* Toolbar */}
                        <div className="flex items-center justify-between text-white mb-4">
                            <h2 className="text-lg font-bold">{previewDoc.label}</h2>
                            <div className="flex items-center gap-4">
                                <a
                                    href={previewDoc.url}
                                    download
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-2 hover:bg-white/10 rounded-full transition"
                                >
                                    <Download size={24} />
                                </a>
                                <button
                                    onClick={() => setPreviewDoc(null)}
                                    className="p-2 hover:bg-white/10 rounded-full transition"
                                >
                                    <X size={24} />
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 bg-gray-900 rounded-lg overflow-hidden flex items-center justify-center border border-gray-700">
                            <iframe
                                src={previewDoc.url}
                                className="w-full h-full"
                                title={previewDoc.label}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
