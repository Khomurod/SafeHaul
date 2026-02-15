import React, { useState } from 'react';
import {
    ArrowLeft, Calendar, Users, MessageSquare,
    BarChart3, Clock, CheckCircle2, AlertCircle, RefreshCw,
    Pause, XCircle
} from 'lucide-react';
import { CampaignResultsTable } from './CampaignResultsTable';
import { useParams } from 'react-router-dom';
import { functions } from '@lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { useData } from '@/context/DataContext';

export function CampaignDetails({ campaign, onClose }) {
    const { companyId: routeCompanyId } = useParams();
    const { currentCompanyProfile } = useData();
    const [retrying, setRetrying] = useState(false);

    // Fallback: Use campaign.companyId -> context -> route
    const effectiveCompanyId = campaign?.companyId || currentCompanyProfile?.id || routeCompanyId;
    const [pausing, setPausing] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const { showSuccess, showError } = useToast();

    if (!campaign) return null;

    const getStatusColor = (status) => {
        switch (status) {
            case 'active': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
            case 'draft': return 'bg-slate-100 text-slate-600 border-slate-200';
            case 'completed': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'scheduled': return 'bg-amber-100 text-amber-700 border-amber-200';
            case 'queued': return 'bg-purple-100 text-purple-700 border-purple-200';
            case 'failed': return 'bg-red-100 text-red-700 border-red-200';
            case 'paused': return 'bg-orange-100 text-orange-700 border-orange-200';
            case 'cancelled': return 'bg-gray-100 text-gray-700 border-gray-200';
            default: return 'bg-slate-100 text-slate-600 border-slate-200';
        }
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString();
    };

    const handleRetry = async () => {
        if (!confirm("Start a new campaign for FAILED recipients only? This will retry permanent errors too.")) return;

        try {
            setRetrying(true);
            const retryFn = httpsCallable(functions, 'retryFailedAttempts');
            const result = await retryFn({
                companyId: effectiveCompanyId,
                originalSessionId: campaign.id
            });

            if (result.data.success) {
                showSuccess(`Retry session started with ${result.data.targetCount} targets.`);
                onClose(); // Close details to see the new session in dashboard
            } else {
                showError(result.data.message || "Retry failed to start.");
            }
        } catch (err) {
            console.error(err);
            showError(err.message);
        } finally {
            setRetrying(false);
        }
    };

    const handlePause = async () => {
        try {
            setPausing(true);
            const pauseFn = httpsCallable(functions, 'pauseBulkSession');
            await pauseFn({ companyId: effectiveCompanyId, sessionId: campaign.id });
            showSuccess("Campaign paused.");
            onClose();
        } catch (err) {
            showError(err.message);
        } finally {
            setPausing(false);
        }
    };

    const handleCancel = async () => {
        if (!confirm("Are you sure you want to cancel this campaign? This action cannot be undone.")) return;
        try {
            setCancelling(true);
            const cancelFn = httpsCallable(functions, 'cancelBulkSession');
            await cancelFn({ companyId: effectiveCompanyId, sessionId: campaign.id });
            showSuccess("Campaign cancelled.");
            onClose();
        } catch (err) {
            showError(err.message);
        } finally {
            setCancelling(false);
        }
    };

    const progressPercent = campaign.progress
        ? (campaign.progress.processedCount / (campaign.progress.totalCount || 1)) * 100
        : 0;

    const hasFailures = campaign.progress?.failedCount > 0;
    const isActive = ['active', 'queued', 'scheduled'].includes(campaign.status);
    const isPaused = campaign.status === 'paused';

    return (
        <div className="flex flex-col h-screen bg-slate-50 overflow-hidden animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-8 border-b border-slate-200 bg-white">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onClose}
                        className="p-2 -ml-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-all"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-xl font-black text-slate-900 leading-none">{campaign.name || 'Untitled Campaign'}</h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${getStatusColor(campaign.status)}`}>
                                {campaign.status}
                            </span>
                            <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                                <Clock size={12} /> {formatDate(campaign.createdAt)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                    {/* Pause Button */}
                    {isActive && (
                        <button
                            onClick={handlePause}
                            disabled={pausing}
                            className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 text-orange-600 rounded-lg text-xs font-bold uppercase tracking-widest border border-orange-200 hover:bg-orange-100 transition-colors disabled:opacity-50"
                        >
                            <Pause size={14} className={pausing ? "animate-pulse" : ""} />
                            {pausing ? 'Pausing...' : 'Pause'}
                        </button>
                    )}

                    {/* Resume Button (Basic implementation using retry Logic or future resume endpoint) */}
                    {/* Note: Resume usually requires valid resume endpoint, using retry for now if user wants to restart failed */}

                    {/* Cancel Button */}
                    {(isActive || isPaused) && (
                        <button
                            onClick={handleCancel}
                            disabled={cancelling}
                            className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 text-slate-600 rounded-lg text-xs font-bold uppercase tracking-widest border border-slate-200 hover:bg-slate-100 transition-colors disabled:opacity-50"
                        >
                            <XCircle size={14} className={cancelling ? "animate-pulse" : ""} />
                            {cancelling ? 'Cancelling...' : 'Details & Cancel'}
                        </button>
                    )}

                    {hasFailures && !isActive && (
                        <button
                            onClick={handleRetry}
                            disabled={retrying}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold uppercase tracking-widest border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={14} className={retrying ? "animate-spin" : ""} />
                            {retrying ? 'Starting...' : 'Retry Failed'}
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-5xl mx-auto space-y-6">

                    {/* Stats Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                                    <Users size={20} />
                                </div>
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Audience</span>
                            </div>
                            <div className="text-2xl font-black text-slate-900">
                                {campaign.progress ? campaign.progress.totalCount : campaign.matchCount || 0}
                            </div>
                        </div>

                        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                                    <CheckCircle2 size={20} />
                                </div>
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Sent</span>
                            </div>
                            <div className="text-2xl font-black text-slate-900">
                                {campaign.progress ? campaign.progress.successCount : 0}
                            </div>
                        </div>

                        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-red-50 text-red-600 rounded-lg">
                                    <AlertCircle size={20} />
                                </div>
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Failed</span>
                            </div>
                            <div className="text-2xl font-black text-slate-900">
                                {campaign.progress ? campaign.progress.failedCount : 0}
                            </div>
                        </div>
                    </div>

                    {/* Progress Section */}
                    {campaign.progress && (
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <BarChart3 size={16} className="text-blue-500" /> Campaign Progress
                            </h3>
                            <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden mb-2">
                                <div
                                    className="h-full bg-blue-500 transition-all duration-1000 ease-out"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                            <div className="flex justify-between text-xs font-medium text-slate-500">
                                <span>{Math.round(progressPercent)}% Complete</span>
                                <span>{campaign.progress.processedCount} / {campaign.progress.totalCount} leads processed</span>
                            </div>
                        </div>
                    )}

                    {/* Message Configuration */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <MessageSquare size={16} className="text-purple-500" /> Message Content
                        </h3>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-slate-600 font-medium whitespace-pre-wrap">
                            {campaign.messageConfig?.message || 'No message content defined.'}
                        </div>
                        <div className="mt-4 flex gap-2">
                            <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold uppercase tracking-widest">
                                {campaign.messageConfig?.method || 'SMS'}
                            </span>
                        </div>
                    </div>

                    {/* Technical Details */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest mb-4">Details</h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="block text-slate-400 text-xs font-bold uppercase mb-1">Campaign ID</span>
                                <span className="font-mono text-slate-600">{campaign.id}</span>
                            </div>
                            <div>
                                <span className="block text-slate-400 text-xs font-bold uppercase mb-1">Created At</span>
                                <span className="text-slate-600">{formatDate(campaign.createdAt)}</span>
                            </div>
                            <div>
                                <span className="block text-slate-400 text-xs font-bold uppercase mb-1">Updated At</span>
                                <span className="text-slate-600">{formatDate(campaign.updatedAt)}</span>
                            </div>
                            {campaign.scheduledFor && (
                                <div>
                                    <span className="block text-slate-400 text-xs font-bold uppercase mb-1">Scheduled For</span>
                                    <span className="text-slate-600">{formatDate(campaign.scheduledFor)}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* NEW: Individual Results Table */}
                    <CampaignResultsTable companyId={campaign.companyId} campaignId={campaign.id} />

                </div>
            </div>
        </div>
    );
}
