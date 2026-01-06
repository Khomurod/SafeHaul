import React, { useState, useMemo, useEffect } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    flexRender,
    createColumnHelper,
} from '@tanstack/react-table';
import {
    ChevronLeft, ChevronRight, CheckSquare, Square,
    MoreVertical, Phone, Calendar, User, Briefcase,
    Maximize2, Minimize2, ArrowUpDown
} from 'lucide-react';

import { DashboardToolbar } from './DashboardToolbar';

// --- CELL RENDERERS (Extracted for V2) ---
const StatusBadge = ({ status }) => {
    let colorClass = "bg-gray-100 text-gray-800";
    if (status === 'New Application' || status === 'New Lead') colorClass = "bg-blue-100 text-blue-800";
    if (status === 'Contacted') colorClass = "bg-yellow-100 text-yellow-800";
    if (status === 'Hired' || status === 'Active') colorClass = "bg-green-100 text-green-800";
    if (status === 'Rejected' || status === 'Archived') colorClass = "bg-red-100 text-red-800";

    return (
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colorClass} border-opacity-20`}>
            {status}
        </span>
    );
};

export function DashboardTableV2({
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
    // --- STATE ---
    const [rowSelection, setRowSelection] = useState({});
    const [columnSizing, setColumnSizing] = useState({});
    const [density, setDensity] = useState('comfortable'); // 'comfortable' | 'compact'

    // --- COLUMNS ---
    const columnHelper = createColumnHelper();

    const columns = useMemo(() => {
        const cols = [
            // Checkbox Column
            canAssign ? {
                id: 'select',
                header: ({ table }) => (
                    <div
                        className="cursor-pointer"
                        onClick={table.getToggleAllRowsSelectedHandler()}
                    >
                        {table.getIsAllRowsSelected() ? (
                            <CheckSquare size={18} className="text-blue-600" />
                        ) : (
                            <Square size={18} className="text-gray-400" />
                        )}
                    </div>
                ),
                cell: ({ row }) => (
                    <div
                        className="cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); row.getToggleSelectedHandler()(e); }}
                    >
                        {row.getIsSelected() ? (
                            <CheckSquare size={18} className="text-blue-600" />
                        ) : (
                            <Square size={18} className="text-gray-400" />
                        )}
                    </div>
                ),
                size: 50,
                enableResizing: false,
            } : null,

            columnHelper.accessor('name', {
                header: 'Driver / Contact',
                cell: info => {
                    const original = info.row.original;
                    const phone = original.phone;
                    return (
                        <div className="flex flex-col">
                            <span className="font-bold text-gray-900">{info.getValue()}</span>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-gray-500">{original.email || 'No Email'}</span>
                                {phone && (
                                    <button
                                        onClick={(e) => onPhoneClick(e, original)}
                                        className="p-1 hover:bg-green-50 text-green-600 rounded-full transition-colors"
                                        title="Call Driver"
                                    >
                                        <Phone size={12} fill="currentColor" />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                },
                size: 250,
            }),

            columnHelper.accessor('status', {
                header: 'Status',
                cell: info => <div className="flex justify-center"><StatusBadge status={info.getValue()} /></div>,
                size: 140,
            }),

            columnHelper.accessor('lastCall', {
                header: 'Last Call',
                cell: info => {
                    const val = info.getValue();
                    return (
                        <div className="text-center text-xs text-gray-600">
                            {val ? new Date(val.toDate ? val.toDate() : val).toLocaleDateString() : '-'}
                        </div>
                    )
                },
                size: 140,
            }),

            columnHelper.accessor(row => row.position || row.type || 'General', {
                id: 'qualifications',
                header: 'Position / Type',
                cell: info => (
                    <div className="flex items-center gap-1.5 text-xs text-gray-700">
                        <Briefcase size={14} className="text-gray-400" />
                        <span className="truncate max-w-[150px]">{info.getValue()}</span>
                    </div>
                ),
                size: 180,
            }),

            columnHelper.accessor('assigneeName', {
                header: 'Recruiter',
                cell: info => (
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                        <User size={14} className="text-gray-400" />
                        <span>{info.getValue() || 'Unassigned'}</span>
                    </div>
                ),
                size: 150,
            }),

            columnHelper.accessor('createdAt', {
                header: 'Date',
                cell: info => {
                    const date = info.getValue() ? (info.getValue().toDate ? info.getValue().toDate() : new Date(info.getValue())) : new Date();
                    return (
                        <div className="flex flex-col items-end text-xs">
                            <span className="font-medium text-gray-900">{date.toLocaleDateString()}</span>
                            <span className="text-gray-400">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    )
                },
                size: 130,
            }),
        ];

        return cols.filter(Boolean); // Remove nulls (if !canAssign)
    }, [columnHelper, canAssign, onPhoneClick]);


    // --- TABLE INSTANCE ---
    const table = useReactTable({
        data,
        columns,
        state: {
            rowSelection,
            columnSizing,
        },
        pageCount: totalPages,
        manualPagination: true, // We handle pagination via props (server-side)
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        onRowSelectionChange: setRowSelection,
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getRowId: row => row.id, // Important for selection
    });

    // Handle Selection Logic for Parent
    useEffect(() => {
        // If parent wants selection data on Apply
        // But here we are passing `onAssignLeads` which takes IDs directly when clicked.
        // Wait, existing DashboardTable passed selection via `dashboardToolbar`.
        // Let's stick to valid dashboard toolbar usage
    }, [rowSelection]);

    // Helper to get selected IDs
    const getSelectedIds = () => Object.keys(rowSelection);


    // --- RENDER ---
    return (
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden h-full">

            <DashboardToolbar
                activeTab={activeTab}
                dataCount={data.length}
                totalCount={totalCount}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                filters={filters}
                setFilters={(key, val) => setFilters(prev => ({ ...prev, [key]: val }))}
                clearFilters={() => {
                    setFilters({ state: '', driverType: '', dob: '', assignee: '' });
                    setSearchQuery('');
                }}
                onShowSafeHaulInfo={onShowSafeHaulInfo}
                latestBatchTime={latestBatchTime}

                // Note: visibleColumns handling is complex with TanStack, skipping for this MVP or using column visibility API
                visibleColumns={[]}
                setVisibleColumns={() => { }}

                // Pass Selection Data
                selectedCount={Object.keys(rowSelection).length}
                canAssign={canAssign}
                onAssignLeads={() => onAssignLeads(getSelectedIds())}
            >
                {/* Extra Toolbar Actions: Density Toggle */}
                <button
                    onClick={() => setDensity(d => d === 'comfortable' ? 'compact' : 'comfortable')}
                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors ml-2"
                    title="Toggle Density"
                >
                    {density === 'comfortable' ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
            </DashboardToolbar>

            <div className="flex-1 overflow-auto min-h-0 bg-white relative w-full scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
                <table
                    className="w-full text-left border-collapse"
                    style={{ width: table.getTotalSize() }}
                >
                    <thead className="bg-gray-50 sticky top-0 z-20 shadow-sm border-b border-gray-200">
                        {table.getHeaderGroups().map(headerGroup => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map(header => (
                                    <th
                                        key={header.id}
                                        colSpan={header.colSpan}
                                        style={{ width: header.getSize() }}
                                        className="relative px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider group"
                                    >
                                        {header.isPlaceholder ? null : (
                                            <div className="flex items-center justify-between">
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                                {/* Resizer Handle */}
                                                <div
                                                    onMouseDown={header.getResizeHandler()}
                                                    onTouchStart={header.getResizeHandler()}
                                                    className={`absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 touch-none select-none
                                                        ${header.column.getIsResizing() ? 'bg-blue-600 opacity-100' : 'bg-transparent'}
                                                    `}
                                                />
                                            </div>
                                        )}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {loading ? (
                            Array.from({ length: 5 }).map((_, idx) => (
                                <tr key={idx} className="animate-pulse border-b border-gray-100">
                                    {columns.map((col, i) => (
                                        <td key={i} className="px-6 py-4">
                                            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : table.getRowModel().rows.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} className="px-6 py-12 text-center text-gray-500">
                                    No records found.
                                </td>
                            </tr>
                        ) : (
                            table.getRowModel().rows.map(row => (
                                <tr
                                    key={row.id}
                                    onClick={() => onSelect(row.original)}
                                    className={`
                                        border-b border-gray-100 transition-colors cursor-pointer group
                                        ${row.original.id === selectedId ? 'bg-blue-50/60' : 'hover:bg-gray-50'}
                                        ${density === 'compact' ? 'text-xs' : 'text-sm'}
                                    `}
                                >
                                    {row.getVisibleCells().map(cell => (
                                        <td
                                            key={cell.id}
                                            style={{ width: cell.column.getSize() }}
                                            className={`
                                                ${density === 'compact' ? 'px-6 py-2' : 'px-6 py-4'}
                                                align-middle text-gray-700
                                                ${cell.column.id === 'select' ? 'w-12 px-2 text-center' : ''}
                                            `}
                                        >
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination Footer */}
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
}
