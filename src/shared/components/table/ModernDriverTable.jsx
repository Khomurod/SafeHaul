// src/shared/components/table/ModernDriverTable.jsx
import React, { memo, useId } from 'react';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { Checkbox, IconButton } from '@/design-system/components';

/**
 * ModernDriverTable — selectable, paginated, row-activatable table.
 *
 * Migrated to the design system 2026-07-28, closing the roadmap's oldest table
 * row. **`DataTable` is deliberately not adopted here** — see the recorded
 * exception below.
 *
 * ## Approved compatibility exception: why not `DataTable`
 *
 * `DataTable` is an approved *display*-table contract. This table combines three
 * things that sit outside it, and the same exception is already recorded for
 * `CampaignResultsTable`, `CompaniesView`, `UsersView`, `FeaturesView`,
 * `AssignmentTable` and `ViewCompanyAppsModal`:
 *
 *  1. **Consumer-owned column rendering.** Columns are `{ key, header, render(item),
 *     headerClassName, cellClassName, stopPropagation }`. `render` returns
 *     arbitrary interactive JSX (action buttons, links, badges) and
 *     `stopPropagation` lets a column opt out of row activation per cell.
 *     `DataTable`'s column schema owns alignment/width/priority instead and has no
 *     per-cell propagation control.
 *  2. **Row-level activation *plus* per-row selection *plus* a footer pager**, all
 *     at once. `DataTable` supports each, but the combination with (1) is
 *     unproven, and this table is the Unified Driver Database — the highest-row-count
 *     surface in the product.
 *  3. **A caller-supplied `getRowClassName`** used for domain row tinting that has
 *     no equivalent in `DataTable`'s `getRowTone` enum.
 *
 * **No accessibility or visual debt hides behind this exception.** Everything
 * `DataTable` would have given it is provided here explicitly, and the defects the
 * roadmap recorded against this file are fixed:
 *
 *  1. **Selection was two icon-only `<button aria-pressed>` controls** with a
 *     `CheckSquare`/`Square` icon standing in for a checkbox. They are now real
 *     `Checkbox` controls, so the browser owns the semantics, the keyboard model
 *     and the indeterminate-free checked state. Per-row names can now identify the
 *     record via the new optional `getRowLabel`, instead of eight identical
 *     "Select row" controls.
 *  2. **Row activation was mouse-only.** The `<tr>` had an `onClick` with no
 *     `tabIndex` and no key handling, so the primary action of the table — opening
 *     a driver — was unreachable by keyboard. Rows are now focusable and respond
 *     to Enter/Space, using the same `event.target !== event.currentTarget` guard
 *     `DataTable` uses so activating a control *inside* a row does not also
 *     activate the row.
 *  3. **The table had no accessible name and no caption.** It now requires one via
 *     `ariaLabel` (defaulted, and also used to name the pager).
 *  4. **The scroll region was unnamed and unfocusable**, so a keyboard user could
 *     not scroll a wide table horizontally.
 *  5. **The loading skeleton announced nothing** during a multi-second load.
 *  6. **Selection state was not exposed on the row** — only a background tint.
 *     Rows now carry `aria-selected` when selection is enabled.
 *  7. **25 legacy palette values** (`bg-white`, `border-slate-200`,
 *     `bg-slate-50/50`, `text-slate-500`, `text-slate-300`, `bg-blue-50/40`,
 *     `text-blue-600`) plus hard-coded `rounded-xl` / `shadow-sm` / `text-xs`
 *     replaced with `--ds-*` tokens.
 *
 * Props (unchanged unless noted):
 *  - data:              Array of row objects
 *  - columns:           Array of { key, header, render(item), headerClassName, cellClassName, stopPropagation }
 *  - onRowClick:        (item) => void
 *  - isLoading:         boolean
 *  - emptyMessage:      string
 *  - emptyIcon:         React element (optional)
 *  - ariaLabel:         NEW (optional) — the table's accessible name and caption
 *  - getRowLabel:       NEW (optional) — (item) => string, used to name the row's
 *                       selection checkbox and the row itself
 *
 * Selection (optional):
 *  - showCheckboxes:    boolean
 *  - selectedIds:       Set | Array
 *  - onToggleSelect:    (id, event) => void  — now a change event; callers only
 *                       ever used `event.stopPropagation()`, which it supports
 *  - onToggleSelectAll: () => void
 *
 * Pagination (optional):
 *  - pagination:        { currentPage, totalPages, onNext, onPrev, hasPrev, hasNext, label }
 *
 * Row styling (optional):
 *  - getRowClassName:     (item) => extra Tailwind classes for <tr>
 */
export const ModernDriverTable = memo(function ModernDriverTable({
    data = [],
    columns = [],
    onRowClick,
    isLoading = false,
    emptyMessage = 'No records found.',
    emptyIcon,
    ariaLabel = 'Records',
    getRowLabel,

    // Selection
    showCheckboxes = false,
    selectedIds,
    onToggleSelect,
    onToggleSelectAll,

    // Pagination
    pagination,

    getRowClassName,
}) {
    const captionId = useId();
    const selectedSet = selectedIds instanceof Set
        ? selectedIds
        : new Set(selectedIds || []);

    const allSelected = data.length > 0 && selectedSet.size === data.length;

    /**
     * Enter/Space activate the row, but only when the row itself has focus —
     * otherwise pressing Space on a button or checkbox inside the row would also
     * open the record.
     */
    const handleRowKeyDown = (event, item) => {
        if (!onRowClick || event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onRowClick(item);
        }
    };

    // ── Loading Skeleton ──
    if (isLoading) {
        return (
            <div className="overflow-hidden rounded-ds-lg border border-ds-border-subtle bg-ds-surface shadow-ds-sm">
                <p role="status" className="sr-only">Loading {ariaLabel}…</p>
                <table className="w-full">
                    <caption className="sr-only">{ariaLabel}</caption>
                    <thead>
                        <tr className="border-b border-ds-border-subtle bg-ds-surface-subtle">
                            {showCheckboxes && (
                                <th scope="col" className="w-12 px-ds-4 py-ds-3">
                                    <span className="sr-only">Select</span>
                                </th>
                            )}
                            {columns.map(col => (
                                <th scope="col" key={col.key} className={`px-ds-5 py-ds-3 text-left ${col.headerClassName || ''}`}>
                                    <span className="sr-only">{col.header}</span>
                                    <div aria-hidden="true" className="h-3 w-20 animate-pulse rounded bg-ds-border-subtle" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody aria-hidden="true">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <tr key={i} className="border-b border-ds-border-subtle">
                                {showCheckboxes && (
                                    <td className="px-ds-4 py-ds-4"><div className="h-5 w-5 animate-pulse rounded bg-ds-surface-subtle" /></td>
                                )}
                                {columns.map(col => (
                                    <td key={col.key} className="px-ds-5 py-ds-4">
                                        <div className="space-y-ds-2">
                                            <div className="h-4 w-3/4 animate-pulse rounded bg-ds-surface-subtle" />
                                            <div className="h-3 w-1/2 animate-pulse rounded bg-ds-surface-subtle" />
                                        </div>
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col overflow-hidden rounded-ds-lg border border-ds-border-subtle bg-ds-surface shadow-ds-sm">

            {/* ── Table ── */}
            <div
                role="region"
                aria-labelledby={captionId}
                tabIndex={0}
                className="min-h-0 flex-1 overflow-auto focus-visible:outline-none focus-visible:shadow-ds-focus"
            >
                <table className="w-full text-left">
                    <caption id={captionId} className="sr-only">
                        {ariaLabel}. Scroll horizontally to view all columns.
                    </caption>
                    {/* ── Header ── */}
                    <thead className="sticky top-0 z-10">
                        <tr className="border-b border-ds-border-subtle bg-ds-surface-subtle">
                            {showCheckboxes && (
                                <th scope="col" className="w-12 px-ds-4 py-ds-3">
                                    <Checkbox
                                        label={allSelected ? 'Deselect all rows' : 'Select all rows'}
                                        labelHidden
                                        checked={allSelected}
                                        onChange={onToggleSelectAll}
                                    />
                                </th>
                            )}
                            {columns.map(col => (
                                <th
                                    scope="col"
                                    key={col.key}
                                    className={`px-ds-5 py-ds-3 text-ds-xs font-semibold uppercase tracking-wider text-ds-content-secondary ${col.headerClassName || ''}`}
                                >
                                    {col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>

                    {/* ── Body ── */}
                    <tbody>
                        {data.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={columns.length + (showCheckboxes ? 1 : 0)}
                                    className="py-16 text-center"
                                >
                                    <div role="status" className="flex flex-col items-center gap-ds-2 text-ds-content-secondary">
                                        {emptyIcon || <Inbox size={36} aria-hidden="true" />}
                                        <p className="text-ds-sm font-medium">{emptyMessage}</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            data.map(item => {
                                const isChecked = selectedSet.has(item.id);
                                const extraRow = getRowClassName?.(item) || '';
                                const rowLabel = getRowLabel?.(item);

                                return (
                                    <tr
                                        key={item.id}
                                        tabIndex={onRowClick ? 0 : undefined}
                                        aria-label={rowLabel}
                                        aria-selected={showCheckboxes ? isChecked : undefined}
                                        onClick={() => onRowClick?.(item)}
                                        onKeyDown={(event) => handleRowKeyDown(event, item)}
                                        className={`
                                            group border-b border-ds-border-subtle transition-colors duration-150
                                            focus-visible:outline-none focus-visible:shadow-ds-focus
                                            ${onRowClick ? 'cursor-pointer' : ''}
                                            ${extraRow}
                                            ${isChecked
                                                ? 'bg-ds-status-info-bg'
                                                : 'hover:bg-ds-surface-subtle'
                                            }
                                        `}
                                    >
                                        {/* Checkbox */}
                                        {showCheckboxes && (
                                            <td
                                                className="px-ds-4 py-ds-4 align-middle"
                                                // Keeps a selection click from also activating the row.
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Checkbox
                                                    label={rowLabel
                                                        ? `${isChecked ? 'Deselect' : 'Select'} ${rowLabel}`
                                                        : (isChecked ? 'Deselect row' : 'Select row')}
                                                    labelHidden
                                                    checked={isChecked}
                                                    onChange={(e) => onToggleSelect?.(item.id, e)}
                                                />
                                            </td>
                                        )}

                                        {/* Columns */}
                                        {columns.map(col => (
                                            <td
                                                key={col.key}
                                                className={`px-ds-5 py-ds-4 align-middle ${col.cellClassName || ''}`}
                                                onClick={col.stopPropagation ? (e) => e.stopPropagation() : undefined}
                                            >
                                                {col.render(item)}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* ── Pagination Footer ── */}
            {pagination && (
                <nav
                    aria-label={`${ariaLabel} pagination`}
                    className="flex shrink-0 items-center justify-between border-t border-ds-border-subtle bg-ds-surface-subtle px-ds-5 py-ds-3"
                >
                    <span className="text-ds-xs font-medium text-ds-content-secondary">
                        {pagination.label}
                    </span>
                    <div className="flex items-center gap-ds-2">
                        <IconButton
                            label="Previous page"
                            variant="secondary"
                            size="sm"
                            onClick={pagination.onPrev}
                            disabled={!pagination.hasPrev}
                        >
                            <ChevronLeft size={16} aria-hidden="true" />
                        </IconButton>
                        <span className="px-ds-2 text-ds-xs font-medium text-ds-content-secondary">
                            Page <span className="font-bold text-ds-content">{pagination.currentPage}</span> of <span className="font-bold text-ds-content">{pagination.totalPages || 1}</span>
                        </span>
                        <IconButton
                            label="Next page"
                            variant="secondary"
                            size="sm"
                            onClick={pagination.onNext}
                            disabled={!pagination.hasNext}
                        >
                            <ChevronRight size={16} aria-hidden="true" />
                        </IconButton>
                    </div>
                </nav>
            )}
        </div>
    );
});

export default ModernDriverTable;
