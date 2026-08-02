import React, { useId, useMemo } from 'react';
import { Search } from 'lucide-react';
import EnvelopeHistory from '@features/signing/components/EnvelopeHistory';
import { Button, Checkbox, FormField, Input, Select } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import {
    DATE_FILTERS,
    DEFAULT_FILTERS,
    DELIVERY_FILTERS,
    STATUS_FILTERS,
    filterDocuments,
    isDefaultFilters,
    supportsDateFilter,
} from '@features/company-admin/utils/documentsWorkspace';

/**
 * Documents workspace — Sent Documents.
 *
 * Owns the filter controls only. The live listener, the row actions (Copy Link,
 * Correct, Void, Download) and the details dialog stay in `EnvelopeHistory`, so
 * filtering can never change what a row can do.
 *
 * The date filter is only rendered when the loaded documents actually carry
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
    const rawId = useId().replace(/:/g, '');
    const filtersHeadingId = `sent-documents-filters-${rawId}`;

    const visibleDocuments = useMemo(() => filterDocuments(documents, filters), [documents, filters]);
    const dateFilterAvailable = useMemo(() => supportsDateFilter(documents), [documents]);
    const filtersActive = !isDefaultFilters(filters);

    const update = (patch) => setFilters((prev) => ({ ...prev, ...patch }));

    return (
        <Stack gap="md">
            <section
                aria-labelledby={filtersHeadingId}
                className="rounded-ds-xl border border-ds-border bg-ds-surface p-ds-4"
            >
                <h2 id={filtersHeadingId} className="mb-ds-3 text-ds-body font-bold text-ds-content">
                    Filter documents
                </h2>

                <div className="grid grid-cols-1 gap-ds-3 sm:grid-cols-2 lg:grid-cols-4">
                    <FormField label="Search documents or recipients">
                        <Input
                            type="search"
                            value={filters.search}
                            placeholder="Title, name, email or phone"
                            onChange={(event) => update({ search: event.target.value })}
                        />
                    </FormField>

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
                </div>

                <div className="mt-ds-3 flex flex-wrap items-center justify-between gap-ds-3">
                    <Checkbox
                        id={`sent-documents-attention-${rawId}`}
                        label="Needs attention only"
                        description="Delivery or sealing failures. Documents waiting for a signature are not failures."
                        checked={filters.needsAttention}
                        onChange={() => update({ needsAttention: !filters.needsAttention })}
                    />
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={!filtersActive}
                        onClick={() => setFilters({ ...DEFAULT_FILTERS })}
                    >
                        Reset filters
                    </Button>
                </div>

                <p role="status" className="mt-ds-2 flex items-center gap-ds-1 text-ds-xs text-ds-content-secondary">
                    <Search size={12} aria-hidden="true" />
                    {isLoading
                        ? 'Loading documents…'
                        : `Showing ${visibleDocuments.length} of ${documents.length} document${documents.length === 1 ? '' : 's'}.`}
                </p>
            </section>

            <EnvelopeHistory
                companyId={companyId}
                onCorrect={onCorrect}
                documents={visibleDocuments}
                isLoading={isLoading}
                loadError={loadError}
                onRetry={onRetry}
                emptyState={
                    filtersActive
                        ? {
                            title: 'No documents match these filters.',
                            description: 'Try clearing the search or resetting the filters.',
                        }
                        : { title: 'No documents sent yet.' }
                }
            />
        </Stack>
    );
}

export default SentDocumentsPanel;
