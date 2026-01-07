import React, { useState, useMemo } from 'react';
import { Section } from '../application/ApplicationUI';
import {
    Briefcase, ChevronRight, FileText, CheckCircle, AlertCircle,
    Mail, ShieldCheck, Clock, CheckCircle2, AlertTriangle, Send,
    ExternalLink, Printer, Plus, Info, RefreshCcw
} from 'lucide-react';
import { getFieldValue } from '@shared/utils/helpers';
import { logActivity } from '@shared/utils/activityLogger';
import { useToast } from '@shared/components/feedback/ToastProvider';

import { VOEPreviewModal } from '../modals/VOEPreviewModal';
import { PEVRequestModal } from '../modals/PEVRequestModal';

export function PEVTab({ companyId, applicationId, appData }) {
    const { showSuccess, showError } = useToast();
    const [selectedEmployer, setSelectedEmployer] = useState(null);
    const [showInitiateModal, setShowInitiateModal] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);

    // Local state for demonstration - in production this would come from Firestore
    // This simulates the 'status' and 'history' of verifications per employer
    const [verificationStatuses, setVerificationStatuses] = useState(() => {
        const initial = {};
        (appData?.employers || []).forEach((_, idx) => {
            initial[idx] = { status: 'Not Started', lastAction: null };
        });
        return initial;
    });

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

            // Log Activity with Detailed Recipient Info
            await logActivity(
                companyId,
                applicationId,
                'PEV_REQUEST',
                `Initiated ${method} verification for ${getFieldValue(emp.name)} (Sent to: ${recipient})`,
                'applications'
            );

            // Update local state (simulate DB update including correction persistence)
            setVerificationStatuses(prev => ({
                ...prev,
                [emp.index]: {
                    status: 'Sent',
                    lastAction: new Date().toISOString(),
                    method,
                    recipient
                }
            }));

            showSuccess(`Verification request sent to ${getFieldValue(emp.name)} via ${method} (${recipient})`);
            setShowPreviewModal(false);
            setSelectedEmployer(null);
        } catch (error) {
            console.error("PEV Send Error:", error);
            showError("Failed to initiate verification.");
        }
    };

    const getStatusStyles = (status) => {
        switch (status) {
            case 'Completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
            case 'Sent':
            case 'Requested': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'Discrepancy': return 'bg-red-100 text-red-700 border-red-200';
            default: return 'bg-slate-100 text-slate-600 border-slate-200';
        }
    };

    const StatusIcon = ({ status }) => {
        switch (status) {
            case 'Completed': return <CheckCircle2 size={14} />;
            case 'Sent':
            case 'Requested': return <Clock size={14} className="animate-pulse" />;
            case 'Discrepancy': return <AlertTriangle size={14} />;
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
                                                        <h4 className="font-bold text-slate-900 leading-tight">{getFieldValue(emp.name)}</h4>
                                                        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${getStatusStyles(vStatus.status)}`}>
                                                            <StatusIcon status={vStatus.status} />
                                                            {vStatus.status}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                                                        <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                                                            <Clock size={12} /> {getFieldValue(emp.dates)}
                                                        </span>
                                                        <span className="text-xs font-medium text-slate-500">
                                                            {getFieldValue(emp.city)}, {getFieldValue(emp.state)}
                                                        </span>
                                                        {vStatus.method && (
                                                            <span className="text-xs font-bold text-blue-600 flex items-center gap-1">
                                                                <Send size={12} /> Sent via {vStatus.method}
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
                                                        <button
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
        </div>
    );
}

