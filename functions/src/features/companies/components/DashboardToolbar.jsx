// src/features/companies/components/DashboardToolbar.jsx

import React, { useState, useMemo, useEffect, useRef, memo } from 'react';
import { Search, Filter, X, Zap, Briefcase, Info, Clock, Eye, CheckSquare, Square, RefreshCw, Users } from 'lucide-react';
import { ALL_COLUMNS } from './tableConfig';

// --- CONFIGURATION ---
const DRIVER_TYPE_OPTIONS = [
    "Dry Van", "Reefer", "Flatbed", "Tanker", "Box Truck",
    "Car Hauler", "Step Deck", "Lowboy", "Conestoga",
    "Intermodal", "Power Only", "Hotshot"
];

// --- SECTION TIMER COMPONENT ---
function BatchTimer({ startTime }) {
    const [timeLeft, setTimeLeft] = useState('--:--:--');
    const [isUrgent, setIsUrgent] = useState(false);
    const [status, setStatus] = useState('pending'); // pending, active, expired

    useEffect(() => {
        const calculate = () => {
            const now = new Date();

            // 1. Get current time parts in CT
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Chicago',
                year: 'numeric', month: 'numeric', day: 'numeric',
                hour: 'numeric', minute: 'numeric', second: 'numeric',
                hour12: false
            });

            const parts = formatter.formatToParts(now);
            const getPart = (type) => {
                const part = parts.find(p => p.type === type);
                return part ? parseInt(part.value) : 0;
            };

            const ctYear = getPart('year');
            const ctMonth = getPart('month');
            const ctDay = getPart('day');
            const ctHour = getPart('hour');
            const ctMin = getPart('minute');
            const ctSec = getPart('second');

            // 2. Construct "Next 7 AM" in CT
            // We treat the CT parts as if they were local to calculate the diff
            const ctNowAsLocal = new Date(ctYear, ctMonth - 1, ctDay, ctHour, ctMin, ctSec);
            const ctTargetAsLocal = new Date(ctYear, ctMonth - 1, ctDay, 7, 0, 0);

            if (ctHour >= 7) {
                ctTargetAsLocal.setDate(ctTargetAsLocal.getDate() + 1);
            }

            const diff = ctTargetAsLocal.getTime() - ctNowAsLocal.getTime();

            if (diff <= 0) {
                setTimeLeft("00:00:00");
                setIsUrgent(true);
                setStatus('expired');
            } else {
                setStatus('active');
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((diff % (1000 * 60)) / 1000);

                const h = hours.toString().padStart(2, '0');
                const m = minutes.toString().padStart(2, '0');
                const s = seconds.toString().padStart(2, '0');
                setTimeLeft(`${h}:${m}:${s}`);
                setIsUrgent(hours < 4);
            }
        };

        calculate();
        const interval = setInterval(calculate, 1000);
        return () => clearInterval(interval);
    }, []);

    // Render based on status
    if (status === 'pending') {
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-500 text-xs font-medium" title="Waiting for Super Admin to trigger distribution">
                <Clock size={14} />
                <span>Next Batch: Pending</span>
            </div>
        );
    }

    if (status === 'expired') {
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50 text-orange-700 text-xs font-bold animate-pulse">
                <RefreshCw size={14} className="animate-spin" />
                <span>Rotation In Progress...</span>
            </div>
        );
    }

    return (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-mono font-bold shadow-sm transition-colors duration-500
            ${isUrgent ? 'bg-red-50 text-red-600 border-red-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}
            title="Time remaining until these leads rotate to another company"
        >
            <Clock size={16} className={isUrgent ? "animate-pulse" : ""} />
            <span>{timeLeft}</span>
        </div>
    );
}

export const DashboardToolbar = memo(function DashboardToolbar({
    activeTab,
    dataCount,
    totalCount,
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
    clearFilters,
    onShowSafeHaulInfo,
    latestBatchTime,
    visibleColumns,
    setVisibleColumns,

    // NEW PROPS
    selectedCount = 0,
    onAssignLeads,
    canAssign
}) {
    const [showFilters, setShowFilters] = useState(false);
    const [showViewMenu, setShowViewMenu] = useState(false);
    const menuRef = useRef(null);

    // Helper: Dynamic Tab Title
    const getTabTitle = () => {
        switch (activeTab) {
            case 'applications': return 'Direct Applications';
            case 'find_driver': return 'SafeHaul Network Leads';
            case 'company_leads': return 'Imported Company Leads';
            case 'my_leads': return 'My Assigned Drivers';
            default: return 'Drivers';
        }
    };

    const handleFilterChange = (key, value) => {
        setFilters(key, value);
    };

    const hasActiveFilters = useMemo(() => {
        return filters && (filters.state || filters.driverType || filters.dob || filters.assignee);
    }, [filters]);

    // Handle toggling columns
    const toggleColumn = (key) => {
        if (visibleColumns.includes(key)) {
            // Prevent hiding the last column
            if (visibleColumns.length <= 1) return;
            setVisibleColumns(visibleColumns.filter(c => c !== key));
        } else {
            // Restore original order based on config
            const newSet = new Set([...visibleColumns, key]);
            const newOrder = ALL_COLUMNS.filter(col => newSet.has(col.key)).map(col => col.key);
            setVisibleColumns(newOrder);
        }
    };

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setShowViewMenu(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="p-4 border-b border-gray-200 bg-white z-30 flex flex-col gap-3 shrink-0 relative">

            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4 flex-wrap">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            {activeTab === 'find_driver' && <Zap size={18} className="text-purple-600 fill-purple-100" />}
                            {activeTab === 'company_leads' && <Briefcase size={18} className="text-orange-600" />}
                            {getTabTitle()}
                        </h2>
                        <p className="text-xs text-gray-500 font-medium">
                            Showing {dataCount} of {totalCount} records
                        </p>
                    </div>

                    {/* Info Button & Timer for SafeHaul Leads Tab */}
                    {activeTab === 'find_driver' && (
                        <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
                            <BatchTimer startTime={latestBatchTime} />

                            <button
                                onClick={onShowSafeHaulInfo}
                                className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-full transition-colors"
                                title="How SafeHaul Leads Work"
                            >
                                <Info size={18} />
                            </button>
                        </div>
                    )}

                    {/* NEW ASSIGN BUTTON */}
                    {canAssign && selectedCount > 0 && (
                        <div className="animate-in fade-in slide-in-from-left-2 pl-4 border-l border-gray-200">
                            <button
                                onClick={onAssignLeads}
                                className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 text-white text-sm font-bold rounded-lg shadow-sm hover:bg-blue-700 transition-colors"
                            >
                                <Users size={16} /> Assign ({selectedCount})
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                    {/* Search Bar */}
                    <div className="relative flex-1 sm:w-64">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search size={16} className="text-gray-400" />
                        </div>
                        <input
                            type="text"
                            placeholder="Search name, phone, email..."
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* View / Column Toggle */}
                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={() => setShowViewMenu(!showViewMenu)}
                            className={`p-2 rounded-lg border transition-all flex items-center gap-2 text-sm font-medium ${showViewMenu
                                ? 'bg-blue-50 border-blue-200 text-blue-700'
                                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                }`}
                            title="Customize Columns"
                        >
                            <Eye size={16} />
                            <span className="hidden sm:inline">View</span>
                        </button>

                        {/* Dropdown Menu */}
                        {showViewMenu && (
                            <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                                <div className="p-3 border-b border-gray-100 bg-gray-50">
                                    <span className="text-xs font-bold text-gray-500 uppercase">Show Columns</span>
                                </div>
                                <div className="p-2 space-y-1">
                                    {ALL_COLUMNS.map(col => {
                                        const isVisible = visibleColumns.includes(col.key);
                                        return (
                                            <button
                                                key={col.key}
                                                onClick={() => toggleColumn(col.key)}
                                                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors text-left"
                                            >
                                                {isVisible ?
                                                    <CheckSquare size={16} className="text-blue-600" /> :
                                                    <Square size={16} className="text-gray-400" />
                                                }
                                                {col.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Filter Toggle Button */}
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`p-2 rounded-lg border transition-all flex items-center gap-2 text-sm font-medium ${showFilters || hasActiveFilters
                            ? 'bg-blue-50 border-blue-200 text-blue-700'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                    >
                        <Filter size={16} />
                        <span className="hidden sm:inline">Filters</span>
                        {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-blue-600"></span>}
                    </button>
                </div>
            </div>

            {/* --- Filter Panel --- */}
            {showFilters && (
                <div className="pt-3 pb-1 border-t border-dashed border-gray-200 animate-in slide-in-from-top-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">

                        {/* Filter: Driver Type */}
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Freight Type</label>
                            <select
                                className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                value={filters?.driverType || ''}
                                onChange={(e) => handleFilterChange('driverType', e.target.value)}
                            >
                                <option value="">All Types</option>
                                {DRIVER_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>

                        {/* Filter: State */}
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">State</label>
                            <input
                                type="text"
                                placeholder="e.g. IL, TX"
                                className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                value={filters?.state || ''}
                                onChange={(e) => handleFilterChange('state', e.target.value)}
                                maxLength={2}
                            />
                        </div>

                        {/* Filter: Assignee */}
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Assigned To</label>
                            <input
                                type="text"
                                placeholder="Search recruiter..."
                                className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                value={filters?.assignee || ''}
                                onChange={(e) => handleFilterChange('assignee', e.target.value)}
                            />
                        </div>

                        {/* Clear Button */}
                        <div className="flex items-end">
                            <button
                                onClick={clearFilters}
                                className="w-full p-2 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                            >
                                <X size={14} /> Clear Filters
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});