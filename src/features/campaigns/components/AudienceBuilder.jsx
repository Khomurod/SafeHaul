import React, { useState, useEffect } from 'react';
import { useCampaignTargeting } from '../hooks/useCampaignTargeting';
import { useCompanyTeam } from '@/shared/hooks/useCompanyTeam';
import { useData } from '@/context/DataContext';
import { APPLICATION_STATUSES, LAST_CALL_RESULTS } from '../constants/campaignConstants';
import { Filter, Users, RefreshCw, CheckCircle2, UploadCloud, FileSpreadsheet } from 'lucide-react';
import { useBulkImport } from '@/shared/hooks/useBulkImport';
import VirtualLeadList from './VirtualLeadList';

export function AudienceBuilder({ companyId, filters, onChange }) {
    const { currentUser } = useData();
    const { team } = useCompanyTeam(companyId);

    // Local UI State — restore tab from filters if user already set up an import
    const [activeTab, setActiveTab] = useState(filters?.leadType === 'import' ? 'upload' : 'crm');

    // We maintain a local copy of filters to drive the UI immediately
    // but we only push changes up via onChange
    const [localFilters, setLocalFilters] = useState(filters || {
        leadType: 'applications',
        status: ['new'],
        recruiterId: 'all'
    });

    // 1. CRM COUNT HOOK (Stateless now)
    const { matchCount, isLoading: isCountLoading, excludedPhones } = useCampaignTargeting(companyId, localFilters, currentUser);

    // 2. IMPORT HOOK
    const {
        csvData,
        processingSheet,
        handleFileChange,
        handleSheetImport,
        sheetUrl,
        setSheetUrl,
        reset: resetImport
    } = useBulkImport();

    // Effect: Keep localFilters in sync with active tab and imported data
    useEffect(() => {
        if (activeTab === 'upload') {
            setLocalFilters(prev => ({ ...prev, leadType: 'import', rawData: csvData }));
        } else {
            // Switching back to CRM: clear import-specific keys
            setLocalFilters(prev => {
                const { rawData, ...rest } = prev;
                return { ...rest, leadType: prev.leadType === 'import' ? 'applications' : prev.leadType };
            });
        }
    }, [activeTab, csvData]);

    // Effect: Sync filters + count to parent
    useEffect(() => {
        onChange(localFilters, matchCount);
    }, [localFilters, matchCount]);



    // Handler for Filter Inputs
    const handleFilterChange = (key, value) => {
        setLocalFilters(prev => ({ ...prev, [key]: value }));
    };

    // Handler for Exclusions
    const handleToggleExclusion = (leadId) => {
        const currentExcluded = localFilters.excludedLeadIds || [];
        const newExcluded = currentExcluded.includes(leadId)
            ? currentExcluded.filter(id => id !== leadId)
            : [...currentExcluded, leadId];

        handleFilterChange('excludedLeadIds', newExcluded);
    };

    // Calculated View State
    const isUploadMode = activeTab === 'upload';
    // For upload mode, matchCount is already the filtered count (from checkImportPhones)
    const displayCount = matchCount;
    const manualExcludedCount = localFilters.excludedLeadIds?.length || 0;
    const phoneExcludedCount = isUploadMode ? excludedPhones.size : 0;

    // Ensure final count doesn't go below zero
    const finalCount = Math.max(0, displayCount - manualExcludedCount);

    return (
        <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-900 mb-2">Target Audience</h2>
                    <p className="text-slate-500">Define criteria or upload a custom list.</p>
                </div>
                <div className="flex bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
                    <button
                        onClick={() => setActiveTab('crm')}
                        className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'crm' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        CRM Filters
                    </button>
                    <button
                        onClick={() => setActiveTab('upload')}
                        className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'upload' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <FileSpreadsheet size={16} /> Upload List
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

                {/* LEFT COLUMN: FILTERS */}
                <div className="lg:col-span-4 space-y-6">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full">
                        {activeTab === 'crm' ? (
                            <>
                                <h3 className="flex items-center gap-2 font-bold text-slate-900 mb-6 pb-4 border-b border-slate-100">
                                    <Filter size={18} className="text-blue-600" /> Filter Criteria
                                </h3>
                                <div className="space-y-6">
                                    {/* Source */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Source</label>
                                        <select
                                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                            value={localFilters.leadType || 'applications'}
                                            onChange={(e) => handleFilterChange('leadType', e.target.value)}
                                        >
                                            <option value="applications">Applicants</option>
                                            <option value="leads">My Leads</option>
                                            <option value="global">Global Pool</option>
                                        </select>
                                    </div>

                                    {/* Recruiter */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Owner</label>
                                        <select
                                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                            value={localFilters.recruiterId || 'all'}
                                            onChange={(e) => handleFilterChange('recruiterId', e.target.value)}
                                        >
                                            <option value="all">All Team Members</option>
                                            <option value="my_leads">Current User Only</option>
                                            {team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    </div>

                                    {/* Status Pills */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Status</label>
                                        <div className="flex flex-wrap gap-2">
                                            {APPLICATION_STATUSES.map((status) => {
                                                const isActive = localFilters.status?.includes(status.id);
                                                return (
                                                    <button
                                                        key={status.id}
                                                        onClick={() => {
                                                            const current = localFilters.status || [];
                                                            const newVal = isActive ? current.filter(s => s !== status.id) : [...current, status.id];
                                                            handleFilterChange('status', newVal);
                                                        }}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${isActive ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
                                                    >
                                                        {status.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Exclude Previously Messaged */}
                                    <div className="pt-4 border-t border-slate-100">
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Exclude Previously Messaged</label>
                                        <select
                                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                            value={localFilters.excludeRecentDays || 'off'}
                                            onChange={(e) => handleFilterChange('excludeRecentDays', e.target.value)}
                                        >
                                            <option value="off">No Exclusion</option>
                                            <option value="7">Last 7 Days</option>
                                            <option value="30">Last 30 Days</option>
                                            <option value="forever">All Time (Never Re-send)</option>
                                        </select>
                                        <p className="text-[10px] text-slate-400 mt-1">Skip numbers that already received a message.</p>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Limit Volume</label>
                                        <input
                                            type="number"
                                            placeholder="No Limit"
                                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                                            value={localFilters.campaignLimit || ''}
                                            onChange={(e) => handleFilterChange('campaignLimit', e.target.value)}
                                        />
                                        <p className="text-[10px] text-slate-400 mt-1">Leave empty to message all matches.</p>
                                    </div>
                                </div>
                            </>
                        ) : (
                            /* UPLOAD MODE UI (Simplified for brevity, logic maintained) */
                            <div className="text-center py-8">
                                <div className="max-w-md mx-auto">
                                    <div className="flex gap-2 justify-center mb-6">
                                        <button
                                            onClick={() => setLocalFilters(p => ({ ...p, _importTab: 'file' }))}
                                            className={`px-4 py-2 rounded-lg text-sm font-bold ${(!localFilters._importTab || localFilters._importTab === 'file') ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}
                                        >
                                            File Upload (CSV/XLSX)
                                        </button>
                                        <button
                                            onClick={() => setLocalFilters(p => ({ ...p, _importTab: 'sheet' }))}
                                            className={`px-4 py-2 rounded-lg text-sm font-bold ${localFilters._importTab === 'sheet' ? 'bg-green-50 text-green-700' : 'text-slate-500'}`}
                                        >
                                            Google Sheets
                                        </button>
                                    </div>

                                    {(!localFilters._importTab || localFilters._importTab === 'file') ? (
                                        <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 hover:bg-slate-50 transition-colors relative">
                                            <UploadCloud className="mx-auto text-blue-300 mb-4" size={48} />
                                            <h3 className="font-bold text-slate-900 mb-1">Click to Upload</h3>
                                            <p className="text-xs text-slate-400 mb-4">Support: .csv, .xlsx, .xls</p>
                                            <input
                                                type="file"
                                                onChange={handleFileChange}
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                                accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                                            />
                                        </div>
                                    ) : (
                                        <div className="border border-slate-200 rounded-2xl p-8">
                                            <FileSpreadsheet className="mx-auto text-green-500 mb-4" size={48} />
                                            <h3 className="font-bold text-slate-900 mb-4">Paste Sheet URL</h3>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    placeholder="https://docs.google.com/spreadsheets/d/..."
                                                    className="flex-1 p-2 border border-slate-200 rounded-lg text-sm"
                                                    value={sheetUrl}
                                                    onChange={(e) => setSheetUrl(e.target.value)}
                                                />
                                                <button
                                                    onClick={handleSheetImport}
                                                    disabled={processingSheet}
                                                    className="px-4 py-2 bg-green-600 text-white rounded-lg font-bold text-sm disabled:opacity-50"
                                                >
                                                    {processingSheet ? 'Loading...' : 'Import'}
                                                </button>
                                            </div>
                                            <p className="text-[10px] text-slate-400 mt-2 text-left">
                                                Make sure the sheet is accessible to "Anyone with the link" or public.
                                            </p>
                                        </div>
                                    )}

                                    {/* Exclude Previously Messaged for Uploads */}
                                    <div className="pt-4 mt-4 border-t border-slate-100">
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Exclude Previously Messaged</label>
                                        <select
                                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                            value={localFilters.excludeRecentDays || '7'}
                                            onChange={(e) => handleFilterChange('excludeRecentDays', e.target.value)}
                                        >
                                            <option value="off">No Exclusion</option>
                                            <option value="7">Last 7 Days</option>
                                            <option value="30">Last 30 Days</option>
                                            <option value="forever">All Time (Never Re-send)</option>
                                        </select>
                                        <p className="text-[10px] text-slate-400 mt-1">Skip numbers that already received a message.</p>
                                    </div>
                                </div>
                            </div>

                        )}
                    </div>
                </div>

                {/* RIGHT COLUMN: PREVIEW */}
                <div className="lg:col-span-8">
                    <div className="bg-slate-900 text-white p-1 rounded-2xl shadow-xl border border-slate-800 overflow-hidden flex flex-col h-[650px]">
                        {/* Preview Header */}
                        <div className="p-6 bg-slate-900 border-b border-slate-800 z-10">
                            <div className="flex justify-between items-end">
                                <div>
                                    <div className="text-sm font-bold text-blue-400 mb-1 tracking-wide uppercase">
                                        {isUploadMode ? 'Import Manifest' : 'Live Database Query'}
                                    </div>
                                    <div className="text-4xl font-black tracking-tight text-white flex items-baseline gap-2">
                                        {finalCount}
                                        <span className="text-lg font-medium text-slate-500">recipients</span>
                                    </div>
                                </div>
                                {isCountLoading && <RefreshCw className="animate-spin text-blue-500" />}
                            </div>

                            <div className="mt-2 flex flex-wrap gap-2">
                                {manualExcludedCount > 0 && (
                                    <div className="text-xs font-medium text-red-400 bg-red-500/10 inline-block px-2 py-1 rounded">
                                        {manualExcludedCount} manually excluded
                                    </div>
                                )}
                                {phoneExcludedCount > 0 && (
                                    <div className="text-xs font-medium text-amber-400 bg-amber-500/10 inline-block px-2 py-1 rounded">
                                        {phoneExcludedCount} already messaged
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* VIRTUAL LIST AREA */}
                        <div className="flex-1 bg-black/20 min-h-0 relative">
                            {/* Smart Infinite List (Handles both CRM and Import) */}
                            <VirtualLeadList
                                companyId={companyId}
                                filters={localFilters}
                                excludedIds={localFilters.excludedLeadIds}
                                onToggleExclusion={handleToggleExclusion}
                                localData={isUploadMode ? (csvData.length > 0 ? csvData : localFilters.rawData || []) : null}
                                excludedPhones={isUploadMode ? excludedPhones : null}
                            />
                        </div>

                        {/* Footer Action */}
                        <div className="p-4 bg-slate-900 border-t border-slate-800">
                            <button
                                className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-lg shadow-lg shadow-blue-900/20 transition-all flex items-center justify-center gap-3"
                                onClick={() => onChange(localFilters, finalCount)}
                            >
                                <CheckCircle2 size={20} />
                                Confirm Audience ({finalCount})
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
