import React, { useState, useEffect } from 'react';
import { db } from '@lib/firebase';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import {
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Upload,
    Eye
} from 'lucide-react';
import { formatDate } from '@shared/utils/helpers';
import { useToast } from '@shared/components/feedback/ToastProvider';

export function DQFileTab({ companyId, applicationId, collectionName, canEdit }) {
    const { showInfo } = useToast();
    const [dqFiles, setDqFiles] = useState([]);
    const [loading, setLoading] = useState(true);

    // Fetch DQ Files
    useEffect(() => {
        const fetchFiles = async () => {
            if (!companyId || !applicationId) return;
            try {
                const collName = collectionName || 'applications';
                const filesRef = collection(db, 'companies', companyId, collName, applicationId, 'dq_files');
                const q = query(filesRef, orderBy('createdAt', 'desc'));
                const snap = await getDocs(q);
                setDqFiles(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (err) {
                console.error("DQ Fetch error", err);
            } finally {
                setLoading(false);
            }
        };
        fetchFiles();
    }, [companyId, applicationId, collectionName]);

    // Requirements Helpers
    const requirements = [
        { id: 'mvr', label: 'Motor Vehicle Record (MVR)', keywords: ['mvr', 'motor vehicle'] },
        { id: 'psp', label: 'PSP Report', keywords: ['psp'] },
        { id: 'medical', label: 'Medical Card', keywords: ['medical', 'med card'] },
        { id: 'ssn_trace', label: 'SSN Trace / Background', keywords: ['ssn', 'background'] },
    ];

    const getStatus = (req) => {
        const match = dqFiles.find(f => {
            const name = (f.fileName || f.name || '').toLowerCase();
            const type = (f.fileType || f.type || '').toLowerCase();
            return req.keywords.some(k => name.includes(k) || type.includes(k));
        });

        if (match) {
            return { status: 'complete', file: match };
        }
        return { status: 'missing', file: null };
    };

    const handleUploadClick = () => {
        showInfo("Document upload coming in Phase 5", "This feature is part of the next update.");
    };

    if (loading) return <div className="p-10 text-center text-gray-400">Loading DQ Files...</div>;

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                    <h3 className="font-bold text-gray-800">Compliance Checklist</h3>
                    <span className="text-xs font-medium text-gray-500 bg-gray-200 px-2 py-1 rounded">
                        {dqFiles.length} Files Found
                    </span>
                </div>

                <div className="divide-y divide-gray-100">
                    {requirements.map(req => {
                        const { status, file } = getStatus(req);
                        return (
                            <div key={req.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition">
                                <div className="flex items-center gap-4">
                                    <div className="shrink-0">
                                        {status === 'complete' ? (
                                            <CheckCircle2 className="text-green-500" size={24} />
                                        ) : (
                                            <XCircle className="text-red-400" size={24} />
                                        )}
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-gray-900">{req.label}</h4>
                                        <p className="text-xs text-gray-400">
                                            {status === 'complete'
                                                ? `Uploaded ${formatDate(file.createdAt)}`
                                                : 'Required for compliance'}
                                        </p>
                                    </div>
                                </div>

                                <div>
                                    {status === 'complete' ? (
                                        <a
                                            href={file.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg flex items-center gap-2 transition"
                                        >
                                            <Eye size={14} /> View
                                        </a>
                                    ) : (
                                        canEdit && (
                                            <button
                                                onClick={handleUploadClick}
                                                className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-2 transition"
                                            >
                                                <Upload size={14} /> Upload
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Other Files Section */}
            {dqFiles.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h3 className="font-bold text-gray-800 mb-4">All DQ Files</h3>
                    <div className="space-y-2">
                        {dqFiles.map(file => (
                            <div key={file.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="w-8 h-8 rounded bg-white border border-gray-200 flex items-center justify-center text-gray-400">
                                        <Eye size={16} />
                                    </div>
                                    <div className="truncate">
                                        <p className="text-sm font-medium text-gray-900 truncate">{file.fileName || file.name || 'Untitled'}</p>
                                        <p className="text-[10px] text-gray-400">{formatDate(file.createdAt)}</p>
                                    </div>
                                </div>
                                <a href={file.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">View</a>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
