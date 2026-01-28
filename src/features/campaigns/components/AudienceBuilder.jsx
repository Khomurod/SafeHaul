import React from 'react';
import { useCampaignTargeting } from '../hooks/useCampaignTargeting';
import { useCompanyTeam } from '@/shared/hooks/useCompanyTeam';
import { useData } from '@/context/DataContext';
import { APPLICATION_STATUSES, LAST_CALL_RESULTS } from '../constants/campaignConstants';
import { Filter, Users, RefreshCw, CheckCircle2 } from 'lucide-react';

export function AudienceBuilder({ companyId, filters, onChange }) {
    const { currentUser } = useData();
    const { team } = useCompanyTeam(companyId);

    // We lift the state up, but the hook manages logic
    const {
        previewLeads, isPreviewLoading, matchCount, previewError,
        setFilters
    } = useCampaignTargeting(companyId, currentUser, false);

    // Sync external filters prop to internal hook state
    React.useEffect(() => {
        if (filters) setFilters(prev => ({ ...prev, ...filters }));
    }, [filters]);

    // Handle filter changes
    const handleChange = (key, value) => {
        const newFilters = { ...filters, [key]: value };
        // If changing main criteria, we might want to reset exclusions?
        // For now, keep them.
        setFilters(newFilters);
        onChange(newFilters, matchCount);
    };

    const handleToggleExclusion = (leadId) => {
        const currentExcluded = filters.excludedLeadIds || [];
        const newExcluded = currentExcluded.includes(leadId)
            ? currentExcluded.filter(id => id !== leadId)
            : [...currentExcluded, leadId];

        // Update parent immediately
        // Note: This causes prop update -> useEffect -> setFilters -> re-fetch
        // UNLESS useCampaignTargeting is optimized to ignore excludedLeadIds.
        onChange({ ...filters, excludedLeadIds: newExcluded }, matchCount);
    };

    const excludedCount = filters.excludedLeadIds?.length || 0;
    const finalCount = Math.max(0, matchCount - excludedCount);

    return (
        <div className="max-w-4xl mx-auto">
            <div className="mb-8">
                <h2 className="text-2xl font-black text-slate-900 mb-2">Target Audience</h2>
                <p className="text-slate-500">Define who receives this message. Results are calculated in real-time.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left: Filters */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <h3 className="flex items-center gap-2 font-bold text-slate-900 mb-6 pb-4 border-b border-slate-100">
                            <Filter size={18} className="text-slate-400" /> Filter Criteria
                        </h3>

                        <div className="space-y-6">
                            {/* Lead Source */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Lead Source</label>
                                <select
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-100"
                                    value={filters.leadType || 'applications'}
                                    onChange={(e) => handleChange('leadType', e.target.value)}
                                >
                                    <option value="applications">Direct Applications</option>
                                    <option value="leads">Assigned Leads (SafeHaul & Imported)</option>
                                    <option value="global">Global Pool (Cold)</option>
                                </select>
                            </div>

                            {/* Recruiter Filter */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Assigned Recruiter</label>
                                <select
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-100"
                                    value={filters.recruiterId || 'all'}
                                    onChange={(e) => handleChange('recruiterId', e.target.value)}
                                >
                                    <option value="all">All Recruiters</option>
                                    <option value="my_leads">My Leads Only</option>
                                    {team.map(member => (
                                        <option key={member.id} value={member.id}>{member.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Status */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Application Status</label>
                                <div className="flex flex-wrap gap-2">
                                    {APPLICATION_STATUSES.map((status) => {
                                        const isSelected = filters.status?.includes(status.id);
                                        return (
                                            <button
                                                key={status.id}
                                                onClick={() => {
                                                    const current = filters.status || [];
                                                    const newVal = isSelected
                                                        ? current.filter(s => s !== status.id)
                                                        : [...current, status.id];
                                                    handleChange('status', newVal);
                                                }}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${isSelected ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
                                            >
                                                {status.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Last Call Outcome */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Last Call Outcome</label>
                                <select
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-100"
                                    value={filters.lastCallOutcome || 'all'}
                                    onChange={(e) => handleChange('lastCallOutcome', e.target.value)}
                                >
                                    <option value="all">Any Outcome</option>
                                    {LAST_CALL_RESULTS.map((result) => (
                                        <option key={result.id} value={result.id}>{result.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right: Results Preview */}
                <div className="lg:col-span-1">
                    <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl sticky top-8 max-h-[calc(100vh-100px)] flex flex-col">
                        <div className="flex items-center justify-between mb-6 shrink-0">
                            <h3 className="font-bold flex items-center gap-2">
                                <Users size={18} className="text-slate-400" /> Matched Leads
                            </h3>
                            {isPreviewLoading && <RefreshCw size={14} className="animate-spin text-slate-400" />}
                        </div>

                        <div className="text-center py-6 border-b border-slate-800 mb-6 shrink-0">
                            <div className="text-5xl font-black tracking-tighter mb-1">
                                {finalCount}
                            </div>
                            <div className="text-sm text-slate-400 font-medium">Recipients Selected</div>
                            {excludedCount > 0 && (
                                <div className="text-xs text-red-400 mt-2">
                                    {excludedCount} excluded manually
                                </div>
                            )}
                        </div>

                        {previewError && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg mb-4 shrink-0">
                                {previewError}
                            </div>
                        )}

                        <div className="flex-1 min-h-0 flex flex-col">
                            <p className="text-xs font-bold text-slate-500 uppercase mb-3 flex justify-between shrink-0">
                                <span>Preview List</span>
                                <span>{previewLeads.length} Loaded</span>
                            </p>

                            {/* Confirmation Button */}
                            <div className="mb-4 shrink-0">
                                <button
                                    className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                                    onClick={() => onChange(filters, finalCount)} // Pass internal filters (with defaults) up
                                >
                                    <CheckCircle2 size={18} /> Confirm {finalCount} Recipients
                                </button>
                            </div>

                            <div className="space-y-2 overflow-y-auto pr-1 custom-scrollbar flex-1">
                                {previewLeads.map(lead => {
                                    const isExcluded = filters.excludedLeadIds?.includes(lead.id);
                                    return (
                                        <div
                                            key={lead.id}
                                            role="checkbox"
                                            aria-checked={!isExcluded}
                                            tabIndex={0}
                                            className={`p-3 rounded-xl flex items-center gap-3 border transition-all cursor-pointer group ${isExcluded ? 'bg-slate-900 border-slate-700 opacity-60' : 'bg-slate-800 border-transparent hover:border-slate-600'}`}
                                            onClick={() => handleToggleExclusion(lead.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    handleToggleExclusion(lead.id);
                                                }
                                            }}
                                        >
                                            <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${!isExcluded ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-800 border-slate-600'}`}>
                                                {!isExcluded && <CheckCircle2 size={12} />}
                                            </div>

                                            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
                                                {(lead.firstName?.[0] || 'D')}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-bold truncate text-white group-hover:text-blue-200 transition-colors">
                                                    {lead.firstName || 'Driver'} {lead.lastName}
                                                </div>
                                                <div className="text-xs text-slate-400 truncate">{lead.phone || lead.email}</div>
                                            </div>
                                        </div>
                                    );
                                })}

                                {previewLeads.length === 0 && !isPreviewLoading && (
                                    <div className="text-xs text-slate-500 italic text-center py-8">
                                        Adjust filters to see matches
                                    </div>
                                )}

                                {matchCount > previewLeads.length && (
                                    <div className="text-xs text-slate-500 text-center py-4 border-t border-slate-800 mt-2">
                                        + {matchCount - previewLeads.length} more not shown
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
