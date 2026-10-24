import React, { useMemo, useState } from 'react';
import EnvelopeHistory from '@features/signing/components/EnvelopeHistory';
import { Card, FormField, Select } from '@/design-system/components';
import { ListToolbar } from '@/design-system/patterns';
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

/**
 * Documents workspace — Sent Documents, a list page in the workspace's tab.
 *
 * Owns the controls only, in the list-page standard's one row (`ListToolbar`):
 * the search, "Needs attention only", and Filters for status, delivery method
 * and sent date. The count is the workspace heading's (`DocumentsManager`). The
 * live listener, the row actions (Copy Link, Correct, Void, Download) and the
 * details dialog stay in `EnvelopeHistory`, so filtering can never change what a
 * row can do.
 *
 * The date filter is only offered when the loaded documents actually carry
 * usable `createdAt` timestamps — offering a filter that silently matches
 * everything would be worse than not offering it.
 */
export function SentDocumentsPanel({
    companyId,
    documents,
    isLoading,
    loadError,
    onRetry,
    onCorrect,
    filters,
    setFilters,
}) {
    const visibleDocuments = useMemo(() => filterDocuments(documents, filters), [documents, filters]);
    const dateFilterAvailable = useMemo(() => supportsDateFilter(documents), [documents]);
    const activeCount = ['status', 'delivery', ...(dateFilterAvailable ? ['date'] : [])]
        .filter((key) => (filters[key] || 'all') !== 'all').length;
    // Open from the start when a filter already applies, so what narrows the
    // list is in view.
    const [filtersOpen, setFiltersOpen] = useState(activeCount > 0);

    const update = (patch) => setFilters((prev) => ({ ...prev, ...patch }));

    return (
        <Card padding="none">
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

            <EnvelopeHistory
                embedded
                companyId={companyId}
                onCorrect={onCorrect}
                documents={visibleDocuments}
                isLoading={isLoading}
                loadError={loadError}
                onRetry={onRetry}
                emptyState={emptyStateFor(filters)}
            />
        </Card>
    );
}

export default SentDocumentsPanel;
