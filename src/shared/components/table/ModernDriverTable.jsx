// src/shared/components/table/ModernDriverTable.jsx
import React, { memo } from 'react';
import { CheckSquare, Square, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

/**
 * ModernDriverTable — "Invisible UI" reusable table component.
 *
 * Props:
 *  - data:              Array of row objects
 *  - columns:           Array of { key, header, render(item), headerClassName, cellClassName }
 *  - onRowClick:        (item) => void
 *  - isLoading:         boolean
 *  - emptyMessage:      string
 *  - emptyIcon:         React element (optional)
 *
 * Selection (optional):
 *  - showCheckboxes:    boolean
 *  - selectedIds:       Set | Array
 *  - onToggleSelect:    (id, event) => void
 *  - onToggleSelectAll: () => void
 *
 * Pagination (optional):
 *  - pagination:        { currentPage, totalPages, onNext, onPrev, label }
 */
export const ModernDriverTable = memo(function ModernDriverTable({
    data = [],
    columns = [],
    onRowClick,
    isLoading = false,
    emptyMessage = 'No records found.',
    emptyIcon,

    // Selection
    showCheckboxes = false,
    selectedIds,
    onToggleSelect,
    onToggleSelectAll,

    // Pagination
    pagination,
}) {
    const selectedSet = selectedIds instanceof Set
        ? selectedIds
        : new Set(selectedIds || []);

    const allSelected = data.length > 0 && selectedSet.size === data.length;

    // ── Loading Skeleton ──
    if (isLoading) {
        return (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-100">
                            {showCheckboxes && (
                                <th className="w-12 px-4 py-3.5" />
                            )}
                            {columns.map(col => (
                                <th key={col.key} className={`px-5 py-3.5 text-left ${col.headerClassName || ''}`}>
                                    <div className="h-3 bg-slate-200 rounded w-20 animate-pulse" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: 6 }).map((_, i) => (
                            <tr key={i} className="border-b border-slate-50">
                                {showCheckboxes && (
                                    <td className="px-4 py-4"><div className="w-5 h-5 bg-slate-100 rounded animate-pulse" /></td>
                                )}
                                {columns.map(col => (
                                    <td key={col.key} className="px-5 py-4">
                                        <div className="space-y-2">
                                            <div className="h-4 bg-slate-100 rounded w-3/4 animate-pulse" />
                                            <div className="h-3 bg-slate-50 rounded w-1/2 animate-pulse" />
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">

            {/* ── Table ── */}
            <div className="flex-1 overflow-auto min-h-0">
                <table className="w-full text-left">
                    {/* ── Header ── */}
                    <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-50/50 border-b border-slate-100">
                            {showCheckboxes && (
                                <th className="w-12 px-4 py-3.5">
                                    <button
                                        onClick={onToggleSelectAll}
                                        className="p-0.5 text-slate-400 hover:text-blue-600 transition-colors"
                                    >
                                        {allSelected
                                            ? <CheckSquare size={18} className="text-blue-600" />
                                            : <Square size={18} />
                                        }
                                    </button>
                                </th>
                            )}
                            {columns.map(col => (
                                <th
                                    key={col.key}
                                    className={`px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 ${col.headerClassName || ''}`}
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
                                    <div className="flex flex-col items-center gap-2 text-slate-400">
                                        {emptyIcon || <Inbox size={36} className="opacity-30" />}
                                        <p className="text-sm font-medium">{emptyMessage}</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            data.map(item => {
                                const isChecked = selectedSet.has(item.id);

                                return (
                                    <tr
                                        key={item.id}
                                        onClick={() => onRowClick?.(item)}
                                        className={`
                                            group cursor-pointer transition-colors duration-150
                                            border-b border-slate-50
                                            ${isChecked
                                                ? 'bg-blue-50/40'
                                                : 'hover:bg-slate-50'
                                            }
                                        `}
                                    >
                                        {/* Checkbox */}
                                        {showCheckboxes && (
                                            <td
                                                className="px-4 py-4 align-middle"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onToggleSelect?.(item.id, e);
                                                }}
                                            >
                                                <button className="p-0.5 text-slate-400 hover:text-blue-600 transition-colors">
                                                    {isChecked
                                                        ? <CheckSquare size={18} className="text-blue-600" />
                                                        : <Square size={18} className="text-slate-300" />
                                                    }
                                                </button>
                                            </td>
                                        )}

                                        {/* Columns */}
                                        {columns.map(col => (
                                            <td
                                                key={col.key}
                                                className={`px-5 py-4 align-middle ${col.cellClassName || ''}`}
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
                <div className="border-t border-slate-100 px-5 py-3 bg-slate-50/50 flex justify-between items-center shrink-0">
                    <span className="text-xs font-medium text-slate-500">
                        {pagination.label}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={pagination.onPrev}
                            disabled={!pagination.hasPrev}
                            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <span className="text-xs text-slate-500 font-medium px-2">
                            Page <span className="text-slate-900 font-bold">{pagination.currentPage}</span> of <span className="text-slate-900 font-bold">{pagination.totalPages || 1}</span>
                        </span>
                        <button
                            onClick={pagination.onNext}
                            disabled={!pagination.hasNext}
                            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});

export default ModernDriverTable;
