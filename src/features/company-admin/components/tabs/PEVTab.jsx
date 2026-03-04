import React, { useState, useMemo } from 'react';
import { Section } from '../application/ApplicationUI';
import {
    Briefcase, ChevronRight, FileText, CheckCircle, AlertCircle,
    Mail, ShieldCheck, Clock, CheckCircle2, AlertTriangle, Send,
    ExternalLink, Printer, Plus, Info, RefreshCcw, Loader2
} from 'lucide-react';
import { getFieldValue } from '@shared/utils/helpers';
import { logActivity } from '@shared/utils/activityLogger';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { useData } from '@/context/DataContext';

import { VOEPreviewModal } from '../modals/VOEPreviewModal';
import { PEVRequestModal } from '../modals/PEVRequestModal';
import { db, storage, functions } from '@lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';

export function PEVTab({ companyId, applicationId, appData, collectionName = 'applications' }) {
    const { showSuccess, showError } = useToast();
    const { currentCompanyProfile } = useData();
    const [selectedEmployer, setSelectedEmployer] = useState(null);
    const [showInitiateModal, setShowInitiateModal] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);

    // Base statuses derived from Firestore data (reactive to parent appData refreshes)
    const baseStatuses = useMemo(() => {
        const result = {};
        (appData?.employers || []).forEach((emp, idx) => {
            result[idx] = emp.verification || { status: 'Not Started', history: [] };
        });
        return result;
    }, [appData]);

    // Local overrides for instant optimistic UI updates (merged over base)
    const [localOverrides, setLocalOverrides] = useState({});

    // Merged view: base from Firestore + any local optimistic changes
    const verificationStatuses = useMemo(() => ({
        ...baseStatuses,
        ...localOverrides
    }), [baseStatuses, localOverrides]);

    const [uploadingResult, setUploadingResult] = useState(false);
    const fileRef = React.useRef(null);
    const [uploadTargetIndex, setUploadTargetIndex] = useState(null);
    const [historyTargetIndex, setHistoryTargetIndex] = useState(null);

    const employers = useMemo(() => appData?.employers || [], [appData]);

    const stats = useMemo(() => {
        const total = employers.length;
        const completed = Object.values(verificationStatuses).filter(s => s.status === 'Completed').length;
        const pending = Object.values(verificationStatuses).filter(s => ['Sent', 'Requested'].includes(s.status)).length;
        return { total, completed, pending };
    }, [employers, verificationStatuses]);

    const handleInitiate = (employer, index) => {
        setSelectedEmployer({ ...employer, index });
        setShowInitiateModal(true);
    };

    const handleProceedToPreview = (method, contactInfo) => {
        setShowInitiateModal(false);
        setSelectedEmployer(prev => ({ ...prev, deliveryMethod: method, contactInfo }));
        setShowPreviewModal(true);
    };

    const handleFinalSend = async () => {
        try {
            const emp = selectedEmployer;
            const method = emp.deliveryMethod === 'email' ? 'Email' : emp.deliveryMethod === 'fax' ? 'Fax' : 'Manual';
            const recipient = emp.contactInfo?.email || emp.contactInfo?.fax || 'Manual Download';

            const applicantName = `${getFieldValue(appData?.firstName)} ${getFieldValue(appData?.lastName)}`.trim();
            const employerName = getFieldValue(emp.companyName || emp.name);
            const startDate = getFieldValue(emp.startDate);
            const endDate = getFieldValue(emp.endDate);

            // Use the new token-based verification system
            const sendVerificationFn = httpsCallable(functions, 'sendVerificationRequest');
            const result = await sendVerificationFn({
                companyId,
                applicationId,
                collectionName,
                employerIndex: emp.index,
                employerName,
                employerEmail: emp.deliveryMethod === 'email' ? emp.contactInfo?.email : null,
                applicantName,
                employmentStartDate: startDate,
                employmentEndDate: endDate,
                deliveryMethod: emp.deliveryMethod,
            });

            if (!result.data?.success) {
                showError(`Verification request failed: ${result.data?.error || 'Unknown error'}. Please check your email settings.`);
                return;
            }

            const verificationUrl = result.data.verificationUrl;
            const logEntry = `Initiated ${method} verification for ${employerName} (Sent to: ${recipient})${verificationUrl ? ` | Portal: ${verificationUrl}` : ''}`;

            // Log Activity
            await logActivity(
                companyId,
                collectionName,
                applicationId,
                'PEV_REQUEST',
                logEntry,
                'pev'
            );

            // Update appData directly since verifications are usually stored alongside employers
            const updatedEmployers = [...employers];
            if (!updatedEmployers[emp.index].verification) {
                updatedEmployers[emp.index].verification = { history: [] };
            }
            updatedEmployers[emp.index].verification.status = 'Sent';
            updatedEmployers[emp.index].verification.method = method;
            updatedEmployers[emp.index].verification.token = result.data.token;
            updatedEmployers[emp.index].verification.verificationUrl = verificationUrl;
            updatedEmployers[emp.index].verification.history.push({
                action: 'Sent via Portal',
                method,
                recipient,
                verificationUrl,
                token: result.data.token,
                timestamp: new Date().toISOString()
            });

            const appRef = doc(db, 'companies', companyId, collectionName, applicationId);
            await updateDoc(appRef, { employers: updatedEmployers });

            setLocalOverrides(prev => ({
                ...prev,
                [emp.index]: updatedEmployers[emp.index].verification
            }));

            showSuccess(`Verification request sent to ${getFieldValue(emp.companyName || emp.name)} via ${method} (${recipient})`);
            setShowPreviewModal(false);
            setSelectedEmployer(null);
        } catch (error) {
            console.error("PEV Send Error:", error);
            showError("Failed to initiate verification.");
        }
    };

    const handleUploadResult = async (e, index) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadingResult(true);
        try {
            const storagePath = `companies/${companyId}/${collectionName}/${applicationId}/pev_results/${Date.now()}_${file.name}`;
            const fileRefObj = ref(storage, storagePath);
            await uploadBytes(fileRefObj, file);
            const downloadUrl = await getDownloadURL(fileRefObj);

            // Update DB
            const updatedEmployers = [...employers];
            if (!updatedEmployers[index].verification) {
                updatedEmployers[index].verification = { history: [] };
            }
            updatedEmployers[index].verification.status = 'Completed';
            updatedEmployers[index].verification.resultUrl = downloadUrl;
            updatedEmployers[index].verification.history.push({
                action: 'Result Uploaded',
                fileName: file.name,
                url: downloadUrl,
                timestamp: new Date().toISOString()
            });

            const appRef = doc(db, 'companies', companyId, collectionName, applicationId);
            await updateDoc(appRef, { employers: updatedEmployers });

            setLocalOverrides(prev => ({
                ...prev,
                [index]: updatedEmployers[index].verification
            }));

            showSuccess('Verification result uploaded successfully.');
        } catch (error) {
            console.error("Upload Error:", error);
            showError("Failed to upload verification result.");
        } finally {
            setUploadingResult(false);
            if (fileRef.current) fileRef.current.value = null;
            setUploadTargetIndex(null);
        }
    };

    const getStatusStyles = (status) => {
        switch (status) {
            case 'Completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
            case 'Sent':
            case 'Requested': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'Discrepancy': return 'bg-red-100 text-red-700 border-red-200';
            case 'No Response (Good Faith Documented)': return 'bg-amber-100 text-amber-700 border-amber-200';
            default: return 'bg-slate-100 text-slate-600 border-slate-200';
        }
    };

    const StatusIcon = ({ status }) => {
        switch (status) {
            case 'Completed': return <CheckCircle2 size={14} />;
            case 'Sent':
            case 'Requested': return <Clock size={14} className="animate-pulse" />;
            case 'Discrepancy': return <AlertTriangle size={14} />;
            case 'No Response (Good Faith Documented)': return <AlertTriangle size={14} />;
            default: return <Plus size={14} />;
        }
    };

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                        <Briefcase size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Employers</p>
                        <p className="text-2xl font-black text-slate-900">{stats.total}</p>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                        <CheckCircle2 size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Completed</p>
                        <p className="text-2xl font-black text-slate-900">{stats.completed}</p>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
                        <ShieldCheck size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Compliance Status</p>
                        <p className="text-sm font-bold text-amber-700">Audit in Progress</p>
                    </div>
                </div>
            </div>

            {/* Verification Center */}
            <Section title="Verification Center (DOT Compliance)">
                <div className="space-y-4">
                    <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-100 rounded-lg text-xs font-medium text-slate-500">
                        <Info size={14} className="text-blue-500" />
                        FMCSA 391.23(a)(2) requires investigation of employment history for the previous 3 years from the date of the application.
                    </div>

                    {employers.length === 0 ? (
                        <div className="p-12 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                            <Briefcase size={40} className="mx-auto text-slate-200 mb-3" />
                            <p className="text-slate-400 italic">No historical employers detected in this application.</p>
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {employers.map((emp, index) => {
                                const vStatus = verificationStatuses[index] || { status: 'Not Started' };
                                return (
                                    <div
                                        key={index}
                                        className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-blue-300 hover:shadow-md transition-all relative overflow-hidden"
                                    >
                                        {/* Status Sidebar Decor */}
                                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${vStatus.status === 'Completed' ? 'bg-emerald-500' :
                                            vStatus.status === 'Sent' ? 'bg-blue-500' : 'bg-slate-200'
                                            }`} />

                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                            <div className="flex items-start gap-4">
                                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors ${vStatus.status === 'Completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600'
                                                    }`}>
                                                    <Briefcase size={24} />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <h4 className="font-bold text-slate-900 leading-tight">{getFieldValue(emp.companyName || emp.name)}</h4>
                                                        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${getStatusStyles(vStatus.status)}`}>
                                                            <StatusIcon status={vStatus.status} />
                                                            {vStatus.status}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                                                        <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                                                            <Clock size={12} /> {getFieldValue(emp.startDate)} to {getFieldValue(emp.endDate)}
                                                        </span>
                                                        <span className="text-xs font-medium text-slate-500">
                                                            {getFieldValue(emp.city)}, {getFieldValue(emp.state)}
                                                        </span>
                                                        {vStatus.method && (
                                                            <span className="text-xs font-bold text-blue-600 flex items-center gap-1">
                                                                <Send size={12} /> Sent via {vStatus.method}
                                                            </span>
                                                        )}
                                                        {vStatus.respondentName && (
                                                            <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                                                                <CheckCircle2 size={12} /> Responded by: {vStatus.respondentName}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                {vStatus.status === 'Not Started' ? (
                                                    <button
                                                        onClick={() => handleInitiate(emp, index)}
                                                        className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-100 transition-all flex items-center gap-2 active:scale-95"
                                                    >
                                                        <ShieldCheck size={14} /> Initiate PEV
                                                    </button>
                                                ) : (
                                                    <>
                                                        {vStatus.resultUrl && (
                                                            <a
                                                                href={vStatus.resultUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="px-4 py-2 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-xl hover:bg-emerald-100 transition-all flex items-center gap-2"
                                                            >
                                                                <FileText size={14} /> View Result
                                                            </a>
                                                        )}
                                                        {vStatus.verificationUrl && vStatus.status !== 'Completed' && (
                                                            <button
                                                                onClick={() => {
                                                                    navigator.clipboard.writeText(vStatus.verificationUrl);
                                                                    showSuccess('Verification link copied to clipboard!');
                                                                }}
                                                                className="px-4 py-2 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-xl hover:bg-indigo-100 transition-all flex items-center gap-2"
                                                                title="Copy verification portal link"
                                                            >
                                                                <ExternalLink size={14} /> Copy Link
                                                            </button>
                                                        )}
                                                        {vStatus.status === 'Sent' && (
                                                            <button
                                                                onClick={() => {
                                                                    setUploadTargetIndex(index);
                                                                    if (fileRef.current) fileRef.current.click();
                                                                }}
                                                                disabled={uploadingResult}
                                                                className="px-4 py-2 bg-purple-50 text-purple-700 text-xs font-bold rounded-xl hover:bg-purple-100 transition-all flex items-center gap-2 disabled:opacity-50"
                                                            >
                                                                {uploadingResult && uploadTargetIndex === index ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                                                                Upload Result
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => setHistoryTargetIndex(index)}
                                                            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 transition-all flex items-center gap-2"
                                                        >
                                                            <FileText size={14} /> View History
                                                        </button>
                                                        <button
                                                            onClick={() => handleInitiate(emp, index)}
                                                            className="p-2 bg-slate-100 text-slate-400 rounded-xl hover:text-blue-600 hover:bg-blue-50 transition-all"
                                                            title="Resend Request"
                                                        >
                                                            <RefreshCcw size={16} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </Section>

            {/* VOE Modals */}
            {showInitiateModal && selectedEmployer && (
                <PEVRequestModal
                    employer={selectedEmployer}
                    applicant={appData}
                    onClose={() => {
                        setShowInitiateModal(false);
                        setSelectedEmployer(null);
                    }}
                    onProceed={handleProceedToPreview}
                />
            )}

            {showPreviewModal && selectedEmployer && (
                <VOEPreviewModal
                    employer={selectedEmployer}
                    applicant={appData}
                    onClose={() => {
                        setShowPreviewModal(false);
                        setShowInitiateModal(true); // Go back to choice
                    }}
                    onSend={handleFinalSend}
                />
            )}

            {/* Hidden File Input for Result Upload */}
            <input
                type="file"
                ref={fileRef}
                className="hidden"
                accept=".pdf,image/*"
                onChange={(e) => handleUploadResult(e, uploadTargetIndex)}
            />

            {/* History Modal */}
            {historyTargetIndex !== null && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                        <div className="p-4 bg-slate-100 border-b border-slate-200 flex justify-between items-center">
                            <h3 className="font-bold text-slate-800">Verification History</h3>
                            <button onClick={() => setHistoryTargetIndex(null)} className="text-slate-500 hover:text-slate-800">
                                <Plus size={20} className="rotate-45" />
                            </button>
                        </div>
                        <div className="p-6">
                            <h4 className="font-bold text-lg mb-4">{getFieldValue(employers[historyTargetIndex]?.companyName)}</h4>
                            <div className="space-y-4">
                                {verificationStatuses[historyTargetIndex]?.history?.length > 0 ? (
                                    verificationStatuses[historyTargetIndex].history.map((log, i) => (
                                        <div key={i} className="flex gap-3 text-sm">
                                            <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                                            <div>
                                                <p className="font-bold text-slate-800">{log.action}</p>
                                                <p className="text-slate-500 text-xs">
                                                    {new Date(log.timestamp).toLocaleString()}
                                                </p>
                                                {log.recipient && <p className="text-slate-600 text-xs mt-1">Sent to: {log.recipient} ({log.method})</p>}
                                                {log.url && <a href={log.url} target="_blank" rel="noreferrer" className="text-blue-600 text-xs mt-1 hover:underline">View Uploaded Document</a>}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-slate-500 italic">No history available yet.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

