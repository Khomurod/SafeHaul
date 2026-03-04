import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase/config';
import { Loader2, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';

export default function VirtualLeadList({ companyId, filters, excludedIds = [], onToggleExclusion, localData = null, excludedPhones = null }) {
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(false);
    const [lastDocId, setLastDocId] = useState(null);
    const [hasMore, setHasMore] = useState(true);
    const [error, setError] = useState(null);

    // Prevent double-fetching in React.StrictMode
    const fetchingRef = useRef(false);

    const loadMore = useCallback(async (reset = false) => {
        if (localData) return; // No loading needed for local data
        if (fetchingRef.current) return;
        if (!reset && !hasMore) return;

        fetchingRef.current = true;
        setLoading(true);
        if (reset) setError(null);

        try {
            const getLeadsFn = httpsCallable(functions, 'getFilteredLeadsPage');

            // Backend-compatible filter mapping
            const backendFilters = {
                ...filters,
                excludeRecentDays: (filters.excludeRecentDays && filters.excludeRecentDays !== 'off')
                    ? filters.excludeRecentDays
                    : null,
                campaignLimit: filters.campaignLimit ? parseInt(filters.campaignLimit) : null
            };

            const result = await getLeadsFn({
                companyId,
                filters: backendFilters,
                pageSize: 50,
                lastDocId: reset ? null : lastDocId
            });

            const newLeads = result.data.leads || [];
            const newLastId = result.data.lastDocId;

            setLeads(prev => reset ? newLeads : [...prev, ...newLeads]);
            setLastDocId(newLastId);

            // If we got fewer than requested, we hit the end
            setHasMore(!!newLastId && newLeads.length === 50);

        } catch (err) {
            console.error("Failed to load leads:", err);
            setError(err.message);
        } finally {
            setLoading(false);
            fetchingRef.current = false;
        }
    }, [companyId, filters, lastDocId, hasMore, localData]);

    // Reset and load when filters change
    useEffect(() => {
        if (localData) {
            // Local Mode
            setLeads(localData);
            setLoading(false);
            setHasMore(false);
        } else {
            // Remote Mode
            setLeads([]);
            setLastDocId(null);
            setHasMore(true);
            fetchingRef.current = false;
            loadMore(true);
        }
    }, [filters, companyId, localData]);

    // Row Renderer
    const rowContent = (index, user) => {
        const safeId = user.id || `import_${index}`;
        const isExcluded = excludedIds.includes(safeId);
        // Check if this row is excluded by the phone filter (import mode only)
        const isPhoneExcluded = excludedPhones instanceof Set && user.normalizedPhone
            ? excludedPhones.has(user.normalizedPhone)
            : false;
        const name = user.firstName ? `${user.firstName} ${user.lastName || ''}` : (user.name || 'Unknown');
        const contact = user.phone || user.normalizedPhone || user.email || 'No Contact Info';

        return (
            <div className="pb-2 pr-2">
                <div
                    onClick={() => !isPhoneExcluded && onToggleExclusion && onToggleExclusion(safeId)}
                    className={`
                        p-3 rounded-xl flex items-center gap-4 border transition-all
                        ${isPhoneExcluded
                            ? 'bg-amber-900/10 border-amber-800/30 opacity-50 cursor-not-allowed'
                            : isExcluded
                                ? 'bg-slate-900/50 border-slate-800 opacity-60 cursor-pointer'
                                : 'bg-slate-800 border-transparent hover:border-slate-700 cursor-pointer group'}
                    `}
                >
                    {/* Selection Indicator */}
                    <div className={`
                        w-5 h-5 rounded-full flex items-center justify-center border transition-all
                        ${isPhoneExcluded
                            ? 'border-amber-600 bg-transparent text-amber-600'
                            : isExcluded
                                ? 'border-slate-600 bg-transparent text-slate-600'
                                : 'border-blue-500 bg-blue-500 text-white'}
                    `}>
                        {isPhoneExcluded ? <XCircle size={14} /> : isExcluded ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                    </div>

                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-sm text-slate-300 shrink-0">
                        {name[0] || '?'}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <div className={`text-sm font-semibold truncate ${isPhoneExcluded || isExcluded ? 'text-slate-500 line-through' : 'text-white'}`}>
                            {name}
                        </div>
                        <div className="text-xs text-slate-400 truncate">{contact}</div>
                    </div>

                    {/* Status Badge */}
                    {isPhoneExcluded ? (
                        <span className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-500">
                            Already Messaged
                        </span>
                    ) : (
                        <span className={`
                            px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider
                            ${user.status === 'new' ? 'bg-blue-500/10 text-blue-400' :
                                user.status === 'hired' ? 'bg-emerald-500/10 text-emerald-400' :
                                    'bg-slate-700/50 text-slate-500'}
                        `}>
                            {user.status || 'Lead'}
                        </span>
                    )}
                </div>
            </div>
        );
    };

    if (error) {
        return (
            <div className="h-[400px] flex flex-col items-center justify-center text-red-400 p-4 text-center bg-slate-900/50 rounded-xl border border-red-500/10">
                <AlertCircle className="mb-2" />
                <p className="text-sm">Failed to load preview</p>
                <button
                    onClick={() => loadMore(true)}
                    className="mt-4 px-4 py-2 bg-white/5 rounded-lg hover:bg-white/10 text-white text-xs font-bold transition-colors"
                >
                    Retry Connection
                </button>
            </div>
        );
    }

    return (
        <div className="h-[500px] w-full bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-inner">
            {leads.length === 0 && loading ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3">
                    <Loader2 className="animate-spin text-blue-600" size={24} />
                    <span className="text-xs font-medium uppercase tracking-widest">Scanning Database...</span>
                </div>
            ) : leads.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                    <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center text-slate-700 mb-2">
                        <AlertCircle size={24} />
                    </div>
                    <p className="font-medium">No leads match these filters.</p>
                    <p className="text-xs text-slate-600">Try adjusting your criteria.</p>
                </div>
            ) : (
                <Virtuoso
                    style={{ height: '100%' }}
                    data={leads}
                    endReached={() => hasMore && loadMore(false)}
                    itemContent={rowContent}
                    className="custom-scrollbar"
                    components={{
                        Footer: () => (
                            loading ? (
                                <div className="p-4 flex justify-center text-slate-500 text-xs gap-2 items-center">
                                    <Loader2 className="w-3 h-3 animate-spin" /> Fetching more...
                                </div>
                            ) : <div className="h-4" />
                        )
                    }}
                />
            )}
        </div>
    );
}
