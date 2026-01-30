import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Users, MessageSquare, ChevronRight, MoreVertical, Trash2 } from 'lucide-react';

export function CampaignCard({ campaign, onClick, onDelete, onViewReport }) {
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setShowMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const getStatusColor = (status) => {
        switch (status) {
            case 'active': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
            case 'draft': return 'bg-slate-100 text-slate-600 border-slate-200';
            case 'completed': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'scheduled': return 'bg-amber-100 text-amber-700 border-amber-200';
            default: return 'bg-slate-100 text-slate-600 border-slate-200';
        }
    };

    return (
        <div
            onClick={onClick}
            className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-blue-300 hover:shadow-lg hover:shadow-blue-500/5 transition-all cursor-pointer"
        >
            <div className="flex justify-between items-start mb-4">
                <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${getStatusColor(campaign.status)}`}>
                    {campaign.status}
                </div>
                <div className="relative" ref={menuRef}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                        className={`p-1 rounded-lg transition-colors ${showMenu ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        <MoreVertical size={18} />
                    </button>

                    {showMenu && (
                        <div className="absolute right-0 top-8 w-48 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-10 animate-in fade-in zoom-in-95 duration-200">
                            <button
                                onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete && onDelete(campaign); }}
                                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 font-medium text-left"
                            >
                                <Trash2 size={14} /> Delete Campaign
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <h3 className="text-lg font-black text-slate-900 group-hover:text-blue-600 transition-colors truncate mb-1">
                {campaign.name || 'Untitled Campaign'}
            </h3>
            <p className="text-slate-500 text-sm font-medium mb-6 line-clamp-2">
                {campaign.messageConfig?.message || 'No content defined...'}
            </p>

            <div className="border-t border-slate-100 pt-5">
                {campaign.progress ? (
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Progress</span>
                            <span className="text-[10px] font-bold text-slate-600">
                                {campaign.progress.processedCount} / {campaign.progress.totalCount}
                            </span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-500 transition-all duration-500"
                                style={{ width: `${(campaign.progress.processedCount / (campaign.progress.totalCount || 1)) * 100}%` }}
                            />
                        </div>
                        <div className="mt-3 flex gap-4">
                            {campaign.progress.failedCount > 0 && (
                                <span className="text-[10px] font-bold text-red-500">
                                    {campaign.progress.failedCount} Failed
                                </span>
                            )}
                            <span className="text-[10px] font-bold text-slate-400 ml-auto uppercase">
                                {campaign.messageConfig?.method || 'SMS'}
                            </span>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex items-center gap-2 text-slate-400">
                            <Users size={16} />
                            <span className="text-xs font-bold text-slate-600">{campaign.matchCount || 0} leads</span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-400">
                            <MessageSquare size={16} />
                            <span className="text-xs font-bold text-slate-600 uppercase">{campaign.messageConfig?.method || 'SMS'}</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="mt-4 flex items-center justify-between text-[10px] uppercase tracking-widest font-black">
                <span className="flex items-center gap-1.5 text-slate-400">
                    <Calendar size={12} />
                    {campaign.updatedAt?.toDate() ? new Date(campaign.updatedAt.toDate()).toLocaleDateString() : 'Just now'}
                </span>

                <div className="flex items-center gap-3">
                    {onViewReport && campaign.status !== 'draft' && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onViewReport(); }}
                            className="text-blue-500 hover:text-blue-700 hover:underline"
                        >
                            View Report
                        </button>
                    )}
                    <span className="flex items-center gap-0.5 text-slate-400 group-hover:text-blue-500 transition-all">
                        Details <ChevronRight size={12} />
                    </span>
                </div>
            </div>
        </div>
    );
}
