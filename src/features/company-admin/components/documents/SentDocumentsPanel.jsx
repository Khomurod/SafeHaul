import React, { useMemo, useState } from 'react';
import EnvelopeHistory from '@features/signing/components/EnvelopeHistory';
import { Button, Card, FormField, Notice, Select } from '@/design-system/components';
import { ListToolbar } from '@/design-system/patterns';
import { useLoadMoreFocus } from '@shared/hooks/useLoadMoreFocus';
import {
    DATE_FILTERS,
    DELIVERY_FILTERS,
    STATUS_FILTERS,
    filterDocuments,
    isDefaultFilters,
    supportsDateFilter,
} from '@features/company-admin/utils/documentsWorkspace';

/** The fields behind Filters, each back to "all" when cleared. */
const FILTER_FIELDS = Object.freeze({ status: 'all', delivery: 'all', date: 'all' });

/**
 * What the table says when nothing is listed. "Needs attention only" on its own
 * says what it looks for, which the switch has no room to explain.
 */
function emptyStateFor(filters) {
    if (isDefaultFilters(filters)) return { title: 'No documents sent yet.' };
    if (isDefaultFilters({ ...filters, needsAttention: false })) {
        return {
            title: 'Nothing needs attention.',
            description: 'This lists failed deliveries and failed seals. A document waiting for a signature is not one.',
        };
    }
    return {
        title: 'No documents match these filters.',
        description: 'Try clearing the search or the filters.',
    };
}

const format = (n) => n.toLocaleString('en-US');

/** What the notice says about the active list: all documents, or those that need attention. */
const LIST_COPY = {
    all: {
        shown: (n, total) => (total === null
            ? `Showing the newest ${format(n)} sent documents. Search and filters look at these only.`
            : `Showing the newest ${format(n)} of ${format(total)} sent documents. Search and filters look at these ${format(n)}.`),
        action: 'Load older documents',
        done: (total) => `All ${format(total)} sent documents are loaded.`,
    },
    attention: {
        shown: (n, total) => (total === null
            ? `Showing the newest ${format(n)} documents that need attention.`
            : `Showing the newest ${format(n)} of ${format(total)} documents that need attention.`),
        action: 'Load more',
        done: (total) => `All ${format(total)} documents that need attention are loaded.`,
    },
};

/**
 * Where the loaded part of a long list ends: "Showing the newest N of M …" with
 * a Load button while more remain, the failure of the last load beside it, and
 * "All M … are loaded." once the user has loaded the last page. Focus stays on
 * the button, then on that line (`useLoadMoreFocus`).
 */
function LoadedListNotice({ copy, rows, source, focus }) {
    const { buttonRef, doneRef, showDone, press } = focus;
    if (source.complete && !showDone) return null;
    const total = source.total ?? null;
    return (
        <div className="flex flex-col gap-ds-2 p-ds-4">
            {!source.complete && (
                <Notice
                    tone="info"
                    size="sm"
                    actions={(
                        <Button ref={buttonRef} variant="secondary" size="sm" loading={source.isLoadingMore} onClick={press(source.loadMore)}>
                            {copy.action}
                        </Button>
                    )}
                >
                    {copy.shown(rows, total)}
                </Notice>
            )}
            {!source.complete && source.loadMoreFailed && (
                <p role="alert" className="text-ds-sm text-ds-status-danger-fg">Older documents could not be loaded.</p>
            )}
            {source.complete && showDone && (
                <Notice ref={doneRef} tabIndex={-1} tone="info" size="sm">
                    {copy.done(total ?? rows)}
                </Notice>
            )}
        </div>
    );
}

/**
 * Documents workspace — Sent Documents, a list page in the workspace's tab.
 *
 * Owns the controls only, in the list-page standard's one row (`ListToolbar`):
 * the search, "Needs attention only", and Filters for status, delivery method
 * and sent date, in a strip inside the table's card. The count is the Sent
 * Documents tab's (`DocumentsManager`). The
 * live listener, the row actions (Copy Link, Correct, Void, Download) and the
 * details dialog stay in `EnvelopeHistory`, so filtering can never change what a
 * row can do. `companyName` fills a corrected document as the editor would.
 *
 * The date filter is only offered when the loaded documents actually carry
 * usable `createdAt` timestamps — offering a filter that silently matches
 * everything would be worse than not offering it.
 *
 * `list` and `attention` (from `useDocumentsWorkspaceData`) say whether every
 * document, and every one that needs attention, is loaded; missing, both are.
 * "Needs attention only" lists `attention.documents`, with its loading and
 * failure. Search and filters look at the loaded documents, and while the
 * active list is not complete a notice says so and offers to load more.
 */
export function SentDocumentsPanel({
    companyId,
    companyName,
    documents,
    isLoading,
    loadError,
    onRetry,
    onCorrect,
    filters,
    setFilters,
    list,
    attention,
}) {
    const useAttention = Boolean(filters.needsAttention && attention);
    const source = useAttention ? attention.documents : documents;
    const visibleDocuments = useMemo(() => filterDocuments(source, filters), [source, filters]);
    const dateFilterAvailable = useMemo(() => supportsDateFilter(source), [source]);
    const allList = list ?? { complete: true };
    const attentionList = attention ?? { complete: true };
    const allFocus = useLoadMoreFocus({
        resetKey: companyId,
        hasMore: !allList.complete,
        isLoadingMore: Boolean(allList.isLoadingMore),
        loadMoreFailed: Boolean(allList.loadMoreFailed),
        loadedCount: documents.length,
    });
    const attentionFocus = useLoadMoreFocus({
        resetKey: companyId,
        hasMore: !attentionList.complete,
        isLoadingMore: Boolean(attentionList.isLoadingMore),
        loadMoreFailed: Boolean(attentionList.loadMoreFailed),
        loadedCount: attention?.documents.length ?? 0,
    });
    const activeCount = ['status', 'delivery', ...(dateFilterAvailable ? ['date'] : [])]
        .filter((key) => (filters[key] || 'all') !== 'all').length;
    // Open from the start when a filter already applies, so what narrows the
    // list is in view.
    const [filtersOpen, setFiltersOpen] = useState(activeCount > 0);

    const update = (patch) => setFilters((prev) => ({ ...prev, ...patch }));

    return (
        // Clipped to its rounded corners, as a table card is: the strip's white
        // would otherwise square off the top ones.
        <Card padding="none" elevation="soft" className="overflow-hidden">
            <ListToolbar
                toggle={{
                    label: 'Needs attention only',
                    checked: Boolean(filters.needsAttention),
                    onChange: (next) => update({ needsAttention: next }),
                }}
                search={{
                    label: 'Search documents or recipients',
                    placeholder: 'Title, name, email or phone',
                    value: filters.search,
                    onChange: (search) => update({ search }),
                }}
                filters={{
                    open: filtersOpen,
                    onOpenChange: setFiltersOpen,
                    activeCount,
                    onClear: () => update(FILTER_FIELDS),
                    children: (
                        <>
                            <FormField label="Status">
                                <Select value={filters.status} onChange={(event) => update({ status: event.target.value })}>
                                    {STATUS_FILTERS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </Select>
                            </FormField>

                            <FormField label="Delivery method">
                                <Select value={filters.delivery} onChange={(event) => update({ delivery: event.target.value })}>
                                    {DELIVERY_FILTERS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </Select>
                            </FormField>

                            {dateFilterAvailable && (
                                <FormField label="Sent date">
                                    <Select value={filters.date} onChange={(event) => update({ date: event.target.value })}>
                                        {DATE_FILTERS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </Select>
                                </FormField>
                            )}
                        </>
                    ),
                }}
            />

            {useAttention ? (
                <LoadedListNotice copy={LIST_COPY.attention} rows={attention.documents.length} source={attentionList} focus={attentionFocus} />
            ) : (
                <LoadedListNotice copy={LIST_COPY.all} rows={documents.length} source={allList} focus={allFocus} />
            )}

            <EnvelopeHistory
                embedded
                companyId={companyId}
                companyName={companyName}
                onCorrect={onCorrect}
                documents={visibleDocuments}
                // The documents that need attention have their own read once there are more than one window.
                isLoading={Boolean(isLoading || (useAttention && attention.isLoading))}
                loadError={loadError || (useAttention ? attention.error : null) || null}
                onRetry={!loadError && useAttention && attention.error ? attention.retry : onRetry}
                emptyState={emptyStateFor(filters)}
            />
        </Card>
    );
}

export default SentDocumentsPanel;
