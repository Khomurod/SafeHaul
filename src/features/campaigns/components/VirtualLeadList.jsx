import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase/config';
import { Loader2, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { Badge, Button } from '@/design-system/components';

/**
 * Feature-owned domain → visual mapping for a recipient's lifecycle status.
 * The design system only knows generic Badge tones; the campaigns feature owns
 * which status maps to which tone. Tones preserve the previous appearance:
 * new=info (blue), hired=success (emerald), everything else neutral (slate).
 */
const STATUS_TONE = {
    new: 'info',
    hired: 'success',
};

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
            setHasMore(Boolean(newLastId) && newLeads.length > 0);

        } catch (err) {
            // Never log recipient rows or contact details — only the failure reason.
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

        // State is conveyed by an icon plus text (never colour alone).
        const StateIcon = isPhoneExcluded || isExcluded ? XCircle : CheckCircle2;
        const stateText = isPhoneExcluded
            ? 'Already messaged — cannot be selected'
            : isExcluded
                ? 'Excluded from this campaign'
                : 'Included in this campaign';

        const rowBody = (
            <>
                {/* Selection Indicator */}
                <span
                    aria-hidden="true"
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all ${isPhoneExcluded
                        ? 'border-amber-400 bg-transparent text-amber-300'
                        : isExcluded
                            ? 'border-slate-400 bg-transparent text-slate-300'
                            : 'border-blue-400 bg-blue-500 text-white'}`}
                >
                    <StateIcon size={14} />
                </span>

                {/* Avatar */}
                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-700 text-ds-sm font-bold text-slate-200">
                    {name[0] || '?'}
                </span>

                {/* Info */}
                <span className="min-w-0 flex-1">
                    <span className={`block truncate text-ds-sm font-semibold ${isPhoneExcluded || isExcluded ? 'text-slate-400 line-through' : 'text-white'}`}>
                        {name}
                    </span>
                    <span className="block truncate text-ds-xs text-slate-300">{contact}</span>
                </span>

                {/* Status Badge */}
                {isPhoneExcluded ? (
                    <Badge tone="warning">Already Messaged</Badge>
                ) : (
                    <Badge tone={STATUS_TONE[user.status] || 'neutral'}>{user.status || 'Lead'}</Badge>
                )}

                <span className="ds-visually-hidden">{stateText}</span>
            </>
        );

        const rowClass = 'flex w-full items-center gap-ds-4 rounded-ds-lg border p-ds-3 text-left transition-all';

        // Already-messaged rows stay non-toggleable, so they are not exposed as a
        // control at all — only the toggleable rows become buttons.
        if (isPhoneExcluded) {
            return (
                <div className="pb-2 pr-2">
                    <div className={`${rowClass} border-amber-700/50 bg-amber-900/20`}>
                        {rowBody}
                    </div>
                </div>
            );
        }

        return (
            <div className="pb-2 pr-2">
                <button
                    type="button"
                    aria-pressed={!isExcluded}
                    onClick={() => onToggleExclusion && onToggleExclusion(safeId)}
                    className={`${rowClass} focus-visible:outline-none focus-visible:shadow-ds-focus ${isExcluded
                        ? 'border-slate-700 bg-slate-900/50'
                        : 'group border-transparent bg-slate-800 hover:border-slate-600'}`}
                >
                    {rowBody}
                </button>
            </div>
        );
    };

    if (error) {
        return (
            <div
                role="alert"
                className="flex h-[400px] flex-col items-center justify-center gap-ds-2 rounded-ds-lg border border-red-500/40 bg-slate-900/50 p-ds-4 text-center text-red-200"
            >
                <AlertCircle aria-hidden="true" />
                <p className="text-ds-sm">Failed to load preview</p>
                <Button variant="secondary" size="sm" onClick={() => loadMore(true)}>
                    Retry Connection
                </Button>
            </div>
        );
    }

    return (
        // Documented feature-level exception: this preview keeps a dark surface
        // (literal slate colours rather than `--ds-*`) because the campaign editor
        // renders it as an inverted "device/console" panel. The design system has
        // no approved dark-surface tokens yet; rather than expand the token set
        // for one surface, the exception is scoped to this container and the
        // contrast of every piece of text on it is verified.
        <div className="h-[500px] w-full overflow-hidden rounded-ds-xl border border-slate-800 bg-slate-950 shadow-inner">
            {leads.length === 0 && loading ? (
                <div role="status" className="flex h-full flex-col items-center justify-center gap-ds-3 text-slate-300">
                    <Loader2 className="animate-spin text-blue-400" size={24} aria-hidden="true" />
                    <span className="text-ds-xs font-medium uppercase tracking-widest">Scanning Database...</span>
                </div>
            ) : leads.length === 0 ? (
                <div role="status" className="flex h-full flex-col items-center justify-center gap-ds-2 text-slate-300">
                    <span aria-hidden="true" className="mb-ds-2 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-slate-400">
                        <AlertCircle size={24} />
                    </span>
                    <p className="font-medium">No leads match these filters.</p>
                    <p className="text-ds-xs text-slate-400">Try adjusting your criteria.</p>
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
                                <div role="status" className="flex items-center justify-center gap-ds-2 p-ds-4 text-ds-xs text-slate-300">
                                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Fetching more...
                                </div>
                            ) : <div className="h-4" />
                        )
                    }}
                />
            )}
        </div>
    );
}
