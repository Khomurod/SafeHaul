import React, { useState, useEffect, memo } from 'react';
import { motion } from 'framer-motion';
import { Handle, Position } from 'reactflow';
import { Users, ChevronDown, Search, Check, X } from 'lucide-react';
import { collection, getDocs, query, where, orderBy, limit, getCountFromServer } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { APPLICATION_STATUSES, getDbValue } from '@/features/campaigns/constants/campaignConstants';

/**
 * AudienceNode - ReactFlow node for selecting campaign targets
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase/config';
import VirtualLeadList from '@/features/campaigns/components/VirtualLeadList';
import { createPortal } from 'react-dom';

/**
 * AudienceNode - ReactFlow node for selecting campaign targets
 */
const AudienceNode = memo(({ data, selected }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [filters, setFilters] = useState({
        source: 'applications', // applications | leads | global
        statuses: [],
        recruiterId: 'all',
        campaignLimit: '', // Part 3: Cap & Slice
        excludeRecentDays: false, // Part 4: Exclusion
    });
    const [targetCount, setTargetCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [recruiters, setRecruiters] = useState([]);

    // Fetch recruiters for dropdown
    useEffect(() => {
        const fetchRecruiters = async () => {
            if (!data.companyId) return;
            try {
                const usersRef = collection(db, 'companies', data.companyId, 'companyUsers');
                const snapshot = await getDocs(usersRef);
                const users = snapshot.docs.map(doc => ({
                    id: doc.id,
                    name: doc.data().displayName || doc.data().email,
                }));
                setRecruiters(users);
            } catch (err) {
                console.error('Error fetching recruiters:', err);
            }
        };
        fetchRecruiters();
    }, [data.companyId]);

    // Calculate target count when filters change
    useEffect(() => {
        const fetchCount = async () => {
            if (!data.companyId) return;
            setIsLoading(true);
            try {
                // PART 2: Server-Side Aggregation
                const getCountFn = httpsCallable(functions, 'getFilterCount');

                // Construct clean filters for the backend
                const backendFilters = {
                    ...filters,
                    // Convert boolean to days integer if checked
                    excludeRecentDays: filters.excludeRecentDays ? 7 : null
                };

                const result = await getCountFn({
                    companyId: data.companyId,
                    filters: backendFilters
                });

                // Apply limit cap to displayed count if set
                let count = result.data.count || 0;
                if (filters.campaignLimit && !isNaN(parseInt(filters.campaignLimit))) {
                    count = Math.min(count, parseInt(filters.campaignLimit));
                }

                setTargetCount(count);

                // Update node data (pass everything needed for launch)
                if (data.onUpdate) {
                    data.onUpdate({
                        filters: backendFilters,
                        campaignLimit: filters.campaignLimit ? parseInt(filters.campaignLimit) : null,
                        targetCount: count
                    });
                }
            } catch (err) {
                console.error('Error fetching count:', err);
                setTargetCount(0);
            } finally {
                setIsLoading(false);
            }
        };

        // Debounce slightly to prevent rapid API calls
        const timer = setTimeout(fetchCount, 500);
        return () => clearTimeout(timer);
    }, [data.companyId, filters]);

    const toggleStatus = (statusId) => {
        setFilters(prev => ({
            ...prev,
            statuses: prev.statuses.includes(statusId)
                ? prev.statuses.filter(s => s !== statusId)
                : [...prev.statuses, statusId],
        }));
    };

    const sourceOptions = [
        { id: 'applications', label: '📋 Company Applicants', desc: 'Drivers who applied to your company' },
        { id: 'leads', label: '🌐 Marketplace Leads', desc: 'Leads from SafeHaul marketplace' },
    ];

    const currentStatuses = APPLICATION_STATUSES;

    return (
        <div
            className={`
        min-w-[320px] rounded-2xl overflow-hidden
        bg-gradient-to-br from-blue-600/20 to-blue-500/10
        border-2 ${selected ? 'border-blue-400' : 'border-blue-500/30'}
        shadow-xl shadow-blue-500/10
        transition-all duration-200
      `}
        >
            {/* Header */}
            <div className="p-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/30 flex items-center justify-center">
                        <Users className="w-5 h-5 text-blue-300" />
                    </div>
                    <div className="flex-1">
                        <div className="text-white font-bold">Select Audience</div>
                        <div className="text-blue-300 text-sm">
                            {isLoading ? 'Calculating...' : `${targetCount.toLocaleString()} drivers`}
                        </div>
                    </div>
                    <motion.button
                        className="p-2 rounded-lg hover:bg-white/10"
                        onClick={() => setIsExpanded(!isExpanded)}
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                    >
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                    </motion.button>
                </div>
            </div>

            {/* Expanded Content */}
            {isExpanded && (
                <motion.div
                    className="p-4 space-y-4 nodrag"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                >
                    {/* Source Selection */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                            Data Source
                        </label>
                        <div className="space-y-2">
                            {sourceOptions.map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => setFilters(prev => ({ ...prev, source: opt.id, statuses: [] }))}
                                    className={`
                    w-full p-3 rounded-xl text-left transition-all
                    ${filters.source === opt.id
                                            ? 'bg-blue-500/30 border border-blue-400/50'
                                            : 'bg-white/5 border border-transparent hover:border-white/10'
                                        }
                  `}
                                >
                                    <div className="text-white font-medium text-sm">{opt.label}</div>
                                    <div className="text-slate-400 text-xs">{opt.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Status Filter */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                            Status Filter
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {currentStatuses.slice(0, 6).map(status => (
                                <button
                                    key={status.id}
                                    onClick={() => toggleStatus(status.id)}
                                    className={`
                    px-3 py-1.5 rounded-full text-xs font-medium transition-all
                    ${filters.statuses.includes(status.id)
                                            ? 'bg-blue-500 text-white'
                                            : 'bg-white/5 text-slate-300 hover:bg-white/10'
                                        }
                  `}
                                >
                                    {status.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Recruiter Filter */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                            Assigned Recruiter
                        </label>
                        <select
                            value={filters.recruiterId}
                            onChange={(e) => setFilters(prev => ({ ...prev, recruiterId: e.target.value }))}
                            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm focus:border-blue-500 outline-none"
                        >
                            <option value="all">All Recruiters</option>
                            {recruiters.map(r => (
                                <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* PART 3 & 4: SCALABILITY CONTROLS */}
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10">
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">
                                Volume Limit
                            </label>
                            <input
                                type="number"
                                placeholder="Max leads (e.g. 50)"
                                value={filters.campaignLimit}
                                onChange={(e) => setFilters(prev => ({ ...prev, campaignLimit: e.target.value }))}
                                className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white text-xs focus:border-blue-500 outline-none"
                            />
                        </div>
                        <div className="flex items-end">
                            <label className="flex items-center gap-2 cursor-pointer pb-2">
                                <input
                                    type="checkbox"
                                    checked={filters.excludeRecentDays}
                                    onChange={(e) => setFilters(prev => ({ ...prev, excludeRecentDays: e.target.checked }))}
                                    className="w-4 h-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-offset-0 focus:ring-0"
                                />
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-tight">
                                    Exclude 7-Day Spam
                                </span>
                            </label>
                        </div>
                    </div>

                    {/* PREVIEW BUTTON */}
                    <button
                        onClick={() => setShowPreview(true)}
                        className="w-full py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
                    >
                        <Search size={14} /> Preview List
                    </button>

                    {/* PREVIEW MODAL */}
                    {showPreview && createPortal(
                        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8">
                            <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col">
                                <div className="p-4 border-b border-white/10 flex justify-between items-center">
                                    <h3 className="text-white font-bold text-lg">Target Audience Preview</h3>
                                    <button onClick={() => setShowPreview(false)} className="p-2 hover:bg-white/10 rounded-full">
                                        <X size={20} className="text-slate-400" />
                                    </button>
                                </div>
                                <div className="p-4 bg-slate-900">
                                    <VirtualLeadList
                                        companyId={data.companyId}
                                        filters={{
                                            ...filters,
                                            excludeRecentDays: filters.excludeRecentDays ? 7 : null
                                        }}
                                    />
                                </div>
                                <div className="p-4 bg-slate-900 border-t border-white/10 text-center">
                                    <span className="text-slate-400 text-xs">
                                        Showing paginated results. Scroll to load more.
                                    </span>
                                </div>
                            </div>
                        </div>,
                        document.body
                    )}
                </motion.div>
            )}

            {/* Handles for connections */}
            <Handle
                type="source"
                position={Position.Right}
                className="!w-4 !h-4 !bg-blue-500 !border-2 !border-blue-300"
            />
        </div>
    );
});

AudienceNode.displayName = 'AudienceNode';

export default AudienceNode;
