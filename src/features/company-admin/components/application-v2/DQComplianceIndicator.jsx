import React from 'react';
import { FileCheck, FileX, Clock, AlertCircle, CheckCircle2, Upload } from 'lucide-react';

/**
 * DQComplianceIndicator - Inline document compliance status
 * Shows required DOT documents and their status at a glance
 */
export function DQComplianceIndicator({ dqFiles = [], onViewDQFile }) {

    // Required DQ documents for DOT compliance
    const requiredDocs = [
        { key: 'mvr', label: 'MVR', fullLabel: 'Motor Vehicle Record (Annual)' },
        { key: 'medical', label: 'Med Card', fullLabel: 'Medical Examiner\'s Certificate' },
        { key: 'roadtest', label: 'Road Test', fullLabel: 'Road Test Certificate' },
        { key: 'psp', label: 'PSP', fullLabel: 'Pre-Employment Screening Program' },
        { key: 'clearinghouse', label: 'CH Full', fullLabel: 'Clearinghouse Report (Full Query)' },
        { key: 'clearinghouse_annual', label: 'CH Annual', fullLabel: 'Clearinghouse Report (Annual)' },
        { key: 'violations', label: 'Violations', fullLabel: 'Certificate of Violations (Annual)' }
    ];

    // Map uploaded files to their doc types
    const getDocStatus = (docKey) => {
        // Check if any uploaded file matches this doc type
        const matches = dqFiles.filter(f => {
            const type = (f.fileType || f.type || f.docType || '').toLowerCase();
            const name = (f.fileName || f.name || '').toLowerCase();

            // Updated to match actual DQ_FILE_TYPES from DQFileTab
            const keyMappings = {
                'mvr': ['mvr', 'mvr (annual)', 'motor vehicle record'],
                'medical': ['medical', 'med card', 'medical card', 'medical examiner'],
                'roadtest': ['road test', 'roadtest', 'road test certificate'],
                'psp': ['psp', 'psp report', 'pre-employment screening'],
                'clearinghouse': ['clearinghouse report (full)', 'clearinghouse full', 'ch full'],
                'clearinghouse_annual': ['clearinghouse report (annual)', 'clearinghouse annual', 'ch annual'],
                'violations': ['certificate of violations', 'violations', 'certificate of violations (annual)']
            };

            const keywords = keyMappings[docKey] || [docKey];
            return keywords.some(kw => type.includes(kw) || name.includes(kw));
        });

        if (matches.length === 0) {
            return { status: 'missing', file: null };
        }

        // Check expiration if available
        const latestFile = matches[0];
        if (latestFile.expirationDate) {
            const expDate = new Date(latestFile.expirationDate);
            const now = new Date();
            const daysUntilExpiry = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));

            if (daysUntilExpiry < 0) {
                return { status: 'expired', file: latestFile, daysUntilExpiry };
            } else if (daysUntilExpiry <= 30) {
                return { status: 'expiring', file: latestFile, daysUntilExpiry };
            }
        }

        return { status: 'valid', file: latestFile };
    };

    // Calculate completion counts
    const docStatuses = requiredDocs.map(doc => ({
        ...doc,
        ...getDocStatus(doc.key)
    }));

    const completeCount = docStatuses.filter(d => d.status === 'valid').length;
    const expiringCount = docStatuses.filter(d => d.status === 'expiring').length;
    const expiredCount = docStatuses.filter(d => d.status === 'expired').length;
    const missingCount = docStatuses.filter(d => d.status === 'missing').length;

    const getStatusIcon = (status) => {
        switch (status) {
            case 'valid': return <CheckCircle2 size={14} className="text-green-500" />;
            case 'expiring': return <Clock size={14} className="text-yellow-500" />;
            case 'expired': return <AlertCircle size={14} className="text-red-500" />;
            default: return <FileX size={14} className="text-gray-300" />;
        }
    };

    const getStatusBg = (status) => {
        switch (status) {
            case 'valid': return 'bg-green-50 border-green-200';
            case 'expiring': return 'bg-yellow-50 border-yellow-200';
            case 'expired': return 'bg-red-50 border-red-200';
            default: return 'bg-gray-50 border-gray-200';
        }
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Header with progress */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
                        <FileCheck size={18} className="text-indigo-600" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-gray-800">DQ File Compliance</h3>
                        <p className="text-xs text-gray-500">
                            {completeCount}/{requiredDocs.length} documents uploaded
                        </p>
                    </div>
                </div>

                {/* Progress Ring */}
                <div className="relative w-14 h-14">
                    <svg className="w-14 h-14 -rotate-90">
                        <circle
                            cx="28"
                            cy="28"
                            r="22"
                            className="fill-none stroke-gray-200"
                            strokeWidth="4"
                        />
                        <circle
                            cx="28"
                            cy="28"
                            r="22"
                            className={`fill-none ${completeCount === requiredDocs.length ? 'stroke-green-500' : 'stroke-indigo-500'}`}
                            strokeWidth="4"
                            strokeDasharray={`${(completeCount / requiredDocs.length) * 138} 138`}
                            strokeLinecap="round"
                        />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-bold text-gray-700">
                            {Math.round((completeCount / requiredDocs.length) * 100)}%
                        </span>
                    </div>
                </div>
            </div>

            {/* Status Summary */}
            {(expiringCount > 0 || expiredCount > 0) && (
                <div className="px-5 py-2 bg-yellow-50 border-b border-yellow-100 flex items-center gap-4 text-sm">
                    {expiredCount > 0 && (
                        <span className="flex items-center gap-1 text-red-700">
                            <AlertCircle size={14} />
                            {expiredCount} expired
                        </span>
                    )}
                    {expiringCount > 0 && (
                        <span className="flex items-center gap-1 text-yellow-700">
                            <Clock size={14} />
                            {expiringCount} expiring soon
                        </span>
                    )}
                </div>
            )}

            {/* Document Grid */}
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {docStatuses.map((doc) => (
                    <button
                        key={doc.key}
                        onClick={() => onViewDQFile && onViewDQFile(doc)}
                        className={`p-3 rounded-lg border text-left transition-all hover:shadow-sm ${getStatusBg(doc.status)}`}
                        title={doc.fullLabel}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            {getStatusIcon(doc.status)}
                            <span className="text-xs font-semibold text-gray-700 truncate">{doc.label}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 truncate">
                            {doc.status === 'valid' && 'Complete'}
                            {doc.status === 'expiring' && `${doc.daysUntilExpiry}d left`}
                            {doc.status === 'expired' && 'Expired'}
                            {doc.status === 'missing' && 'Missing'}
                        </p>
                    </button>
                ))}
            </div>

            {/* Action */}
            {onViewDQFile && (
                <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
                    <button
                        onClick={() => onViewDQFile()}
                        className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                    >
                        <Upload size={14} />
                        Manage DQ File Documents
                    </button>
                </div>
            )}
        </div>
    );
}

export default DQComplianceIndicator;
