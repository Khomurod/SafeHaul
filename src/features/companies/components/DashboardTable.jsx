// src/features/companies/components/DashboardTable.jsx
import React, { useState, useEffect, useMemo, memo } from 'react';
import { ChevronLeft, ChevronRight, CheckSquare, Square } from 'lucide-react';

import { DashboardToolbar } from './DashboardToolbar';
import { DashboardBody } from './DashboardBody';
import { ALL_COLUMNS, DEFAULT_VISIBLE_COLUMNS } from './tableConfig';

export const DashboardTable = memo(function DashboardTable({
    activeTab,
    loading,
    data,
    totalCount,
    selectedId,
    onSelect,
    onPhoneClick,
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,

    currentPage,
    itemsPerPage,
    setItemsPerPage,
    nextPage,
    prevPage,
    totalPages,

    latestBatchTime,
    onShowSafeHaulInfo,

    // NEW PROPS
    canAssign,
    onAssignLeads
}) {

    const [visibleColumns, setVisibleColumns] = useState(() => {
        try {
            const saved = localStorage.getItem('dashboardColumns');
            return saved ? JSON.parse(saved) : DEFAULT_VISIBLE_COLUMNS;
        } catch (e) {
            return DEFAULT_VISIBLE_COLUMNS;
        }
    });

    // Selection State
    const [selectedRowIds, setSelectedRowIds] = useState([]);

    useEffect(() => {
        localStorage.setItem('dashboardColumns', JSON.stringify(visibleColumns));
    }, [visibleColumns]);

    // Reset selection on tab change or page change
    useEffect(() => {
        setSelectedRowIds([]);
    }, [activeTab, currentPage, searchQuery]);

    // Calculate effective columns based on active tab
    const effectiveVisibleColumns = useMemo(() => {
        if (activeTab === 'find_driver') {
            return visibleColumns.filter(col => col !== 'status' && col !== 'lastCall');
        }
        return visibleColumns;
    }, [visibleColumns, activeTab]);

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const clearFilters = () => {
        setFilters({ state: '', driverType: '', dob: '', assignee: '' });
        setSearchQuery('');
    };

    const toggleRowSelection = (id) => {
        setSelectedRowIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const toggleSelectAllPage = () => {
        if (selectedRowIds.length === data.length) {
            setSelectedRowIds([]);
        } else {
            setSelectedRowIds(data.map(d => d.id));
        }
    };

    return (
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden h-full">

            <DashboardToolbar
                activeTab={activeTab}
                dataCount={data.length}
                totalCount={totalCount}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                filters={filters}
                setFilters={handleFilterChange}
                clearFilters={clearFilters}
                onShowSafeHaulInfo={onShowSafeHaulInfo}
                latestBatchTime={latestBatchTime}

                visibleColumns={visibleColumns}
                setVisibleColumns={setVisibleColumns}

                // Pass Selection Data
                selectedCount={selectedRowIds.length}
                canAssign={canAssign}
                onAssignLeads={() => onAssignLeads(selectedRowIds)}
            />

            <div className="flex-1 overflow-auto min-h-0 bg-white relative">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 sticky top-0 z-20 shadow-sm text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                        <tr>
                            {/* Checkbox Header */}
                            {canAssign && (
                                <th className="px-6 py-4 w-12 cursor-pointer hover:bg-gray-100" onClick={toggleSelectAllPage}>
                                    {data.length > 0 && selectedRowIds.length === data.length ?
                                        <CheckSquare size={20} className="text-blue-600" /> :
                                        <Square size={20} className="text-gray-400" />
                                    }
                                </th>
                            )}

                            {ALL_COLUMNS.map((col) => {
                                if (!effectiveVisibleColumns.includes(col.key)) return null;

                                return (
                                    <th
                                        key={col.key}
                                        className={`px-6 py-4 font-semibold text-gray-600 ${col.widthClass} ${col.className || ''}`}
                                    >
                                        {col.label}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>

                    <DashboardBody
                        data={data}
                        loading={loading}
                        totalCount={totalCount}
                        selectedId={selectedId}
                        onSelect={onSelect}
                        onPhoneClick={onPhoneClick}
                        visibleColumns={effectiveVisibleColumns}

                        // Pass Selection
                        showCheckboxes={canAssign}
                        selectedRowIds={selectedRowIds}
                        onToggleRow={toggleRowSelection}
                    />
                </table>
            </div>

            <div className="border-t border-gray-200 p-3 bg-gray-50 flex flex-col sm:flex-row justify-between items-center gap-4 shrink-0 z-20">
                <div className="flex items-center gap-3 text-xs font-medium text-gray-600">
                    <span>Rows per page:</span>
                    <select
                        value={itemsPerPage}
                        onChange={(e) => setItemsPerPage(Number(e.target.value))}
                        className="border-gray-300 rounded-md text-xs py-1.5 pl-2 pr-6 bg-white focus:ring-blue-500 focus:border-blue-500 shadow-sm outline-none cursor-pointer"
                    >
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </select>
                </div>

                <div className="flex items-center gap-4">
                    <span className="text-xs text-gray-500 font-medium">
                        Page <span className="text-gray-900 font-bold">{currentPage}</span> of <span className="text-gray-900 font-bold">{totalPages || 1}</span>
                    </span>

                    <div className="flex gap-2">
                        <button
                            onClick={prevPage}
                            disabled={currentPage === 1 || loading}
                            className="p-2 rounded-md bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-white transition-all shadow-sm"
                            title="Previous Page"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            onClick={nextPage}
                            disabled={currentPage >= totalPages || loading}
                            className="p-2 rounded-md bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-white transition-all shadow-sm"
                            title="Next Page"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});