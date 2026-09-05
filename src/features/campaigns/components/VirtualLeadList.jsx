import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase/config';
import { CheckCircle2, Inbox, Loader2, XCircle } from 'lucide-react';
import { Avatar, Badge, Button, SelectableCard } from '@/design-system/components';
import { EmptyState, ErrorState, LoadingState } from '@/design-system/patterns';

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

/**
 * The preview panel is an inverse ("console") surface, which the token contract
 * supports directly — `--ds-color-surface-inverse` and its on-inverse content
 * and status roles. It used to be literal slate values under a comment saying
 * the design system had no dark-surface tokens; it has had them since the
 * inverse roles were added, and `SystemHealthView`'s log console already uses
 * the same three.
 *
 * The failure state reuses this exact class so the panel does not resize when a
 * fetch fails — it previously shrank from 500px to 400px, moving everything
 * below it up the page.
 */
const PANEL_CLASS = 'h-[500px] w-full overflow-hidden rounded-ds-xl border border-ds-border-inverse bg-ds-surface-inverse';

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
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-ds-full border transition-all ${isPhoneExcluded
                        ? 'border-ds-status-warning-fg-on-inverse bg-transparent text-ds-status-warning-fg-on-inverse'
                        : isExcluded
                            ? 'border-ds-content-on-inverse-muted bg-transparent text-ds-content-on-inverse-muted'
                            : 'border-ds-action-primary bg-ds-action-primary text-ds-content-inverse'}`}
                >
                    <StateIcon size={14} />
                </span>

                {/* Monogram. A ring rather than a filled disc: the row behind it is
                    `surface-inverse-subtle` when the recipient is included and the bare
                    panel when they are not, so any single fill is invisible against one
                    of the two. The ring reads on both, and matches the selection
                    indicator beside it. */}
                <Avatar size="md" tone="inverse" bordered>
                    {name[0] || '?'}
                </Avatar>

                {/* Info */}
                <span className="min-w-0 flex-1">
                    <span className={`block truncate text-ds-sm font-semibold ${isPhoneExcluded || isExcluded ? 'text-ds-content-on-inverse-muted line-through' : 'text-ds-content-on-inverse'}`}>
                        {name}
                    </span>
                    <span className="block truncate text-ds-xs text-ds-content-on-inverse-muted">{contact}</span>
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

        // Already-messaged rows stay non-toggleable, so they are not exposed as a
        // control at all — `as="div"` is the twin `SelectableCard` has for exactly
        // this, and it refuses a state or a handler rather than accepting one and
        // rendering something unclickable that looks clickable.
        if (isPhoneExcluded) {
            return (
                <div className="pb-ds-2 pr-ds-2">
                    <SelectableCard as="div" surface="inverse" tone="warning">
                        {rowBody}
                    </SelectableCard>
                </div>
            );
        }

        return (
            <div className="pb-ds-2 pr-ds-2">
                <SelectableCard
                    surface="inverse"
                    selected={!isExcluded}
                    className="group"
                    onSelect={() => onToggleExclusion && onToggleExclusion(safeId)}
                >
                    {rowBody}
                </SelectableCard>
            </div>
        );
    };

    if (error) {
        return (
            <div className={`${PANEL_CLASS} flex items-center justify-center`}>
                <ErrorState
                    surface="inverse"
                    headingLevel={3}
                    title="Failed to load preview"
                    description="The recipient preview could not be reached. Your filters are unchanged."
                    actions={(
                        <Button variant="secondary" onClick={() => loadMore(true)}>
                            Retry Connection
                        </Button>
                    )}
                />
            </div>
        );
    }

    return (
        <div className={PANEL_CLASS}>
            {leads.length === 0 && loading ? (
                <div className="flex h-full items-center justify-center">
                    <LoadingState
                        surface="inverse"
                        headingLevel={3}
                        title="Scanning Database..."
                        description="Counting the recipients that match these filters."
                    />
                </div>
            ) : leads.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                    <EmptyState
                        surface="inverse"
                        headingLevel={3}
                        icon={Inbox}
                        title="No leads match these filters."
                        description="Try adjusting your criteria."
                    />
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
                                <div role="status" className="flex items-center justify-center gap-ds-2 p-ds-4 text-ds-xs text-ds-content-on-inverse-muted">
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
