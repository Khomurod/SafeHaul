import React from 'react';
import {
    ArrowLeft, Calendar, Users, MessageSquare,
    BarChart3, Clock, CheckCircle2, AlertCircle
} from 'lucide-react';
import { CampaignResultsTable } from './CampaignResultsTable';
import { useParams } from 'react-router-dom';

export function CampaignDetails({ campaign, onClose }) {
    // If used in dashboard, campaign object is passed.
    // If we were using routing, we'd use useParams.
    // Since this is a modal-like view in Dashboard, we expect `campaign`.
    // However, we need `companyId` for the table. It's usually in the campaign doc ref path
    // but better to pass it or extract it.
    // The Dashboard passes `campaign` which is from state.
    // We can assume we have access to context or need to pass companyId.

    // Let's assume the parent passes companyId if possible, or we extract from campaign data if stored?
    // Firestore docs don't store parent ID by default in data unless we put it there.
    // The Dashboard has `companyId`. We should pass it.

    // Wait, the current signature is ({ campaign, onClose }).
    // I need to update Dashboard to pass companyId or use context.
    // Let's rely on props update in Dashboard.

    if (!campaign) return null;

    // Fallback if companyId not in campaign (it likely isn't)
    // We will update Dashboard to pass `companyId` as a prop to CampaignDetails.

    const getStatusColor = (status) => {
        switch (status) {
            case 'active': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
            case 'draft': return 'bg-slate-100 text-slate-600 border-slate-200';
            case 'completed': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'scheduled': return 'bg-amber-100 text-amber-700 border-amber-200';
            case 'queued': return 'bg-purple-100 text-purple-700 border-purple-200';
            case 'failed': return 'bg-red-100 text-red-700 border-red-200';
            default: return 'bg-slate-100 text-slate-600 border-slate-200';
        }
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        // Handle Firestore Timestamp or Date object or string
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString();
    };

    const progressPercent = campaign.progress
        ? (campaign.progress.processedCount / (campaign.progress.totalCount || 1)) * 100
        : 0;

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
