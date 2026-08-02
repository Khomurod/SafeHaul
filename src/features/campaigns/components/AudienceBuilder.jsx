import React, { useState, useEffect, useId, useRef } from 'react';
import { useCampaignTargeting } from '../hooks/useCampaignTargeting';
import { useCompanyTeam } from '@/shared/hooks/useCompanyTeam';
import { useData } from '@/context/DataContext';
import { APPLICATION_STATUSES, LAST_CALL_RESULTS } from '../constants/campaignConstants';
import { Filter, Users, RefreshCw, CheckCircle2, UploadCloud, FileSpreadsheet, Check } from 'lucide-react';
import { useBulkImport } from '@/shared/hooks/useBulkImport';
import { useToast } from '@shared/components/feedback/ToastProvider';
import VirtualLeadList from './VirtualLeadList';
import { Button, Card, FormField, Input, Select } from '@/design-system/components';

const getUploadFingerprint = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return 'empty';
    const sample = rows.slice(0, 5).map((row) => [
        row.normalizedPhone || row.phone || '',
        row.email || '',
        row.firstName || '',
        row.lastName || '',
    ].join('|')).join('||');
    return `${rows.length}:${sample}`;
};

// Feature-owned tab models. The design system has no tab primitive yet, so the
// audience builder renders accessible WAI-ARIA tablists here. The values are the
// frozen state contract ('crm' | 'upload' for the source, and the saved
// `_importTab` filter key); labels/icons are presentation only.
const SOURCE_TABS = [
    { value: 'crm', label: 'CRM Filters', icon: null },
    { value: 'upload', label: 'Upload List', icon: FileSpreadsheet },
];

const IMPORT_TABS = [
    { value: 'file', label: 'File Upload (CSV/XLSX)' },
    { value: 'sheet', label: 'Google Sheets' },
];

// Shared option list for both the CRM and upload "exclude previously messaged"
// selects. Values are the frozen filter contract; only the defaults differ.
const EXCLUDE_RECENT_OPTIONS = [
    { value: 'off', label: 'No Exclusion' },
    { value: '7', label: 'Last 7 Days' },
    { value: '30', label: 'Last 30 Days' },
    { value: 'forever', label: 'All Time (Never Re-send)' },
];

/**
 * Moves focus (and selection) across a roving-tabindex tablist. Presentation
 * only — the selected values themselves are unchanged.
 */
function moveTabFocus(event, tabs, index, container, idPrefix, onSelect) {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    onSelect(nextTab.value);
    container.current?.querySelector(`#${idPrefix}-${nextTab.value}`)?.focus();
}

export function AudienceBuilder({ companyId, filters, onChange, campaignScopeKey = 'default' }) {
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

    const { showError } = useToast();

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
        // `useBulkImport` used to fall back to a blocking `alert()` when no
        // `onError` was supplied, and this was the one consumer that supplied none —
        // so every CSV/Sheet import failure here froze the tab with a native prompt.
        // The hook's messages are unchanged; they are now announced through the
        // toast live region.
    } = useBulkImport({ onError: showError });
    const lastUploadFingerprintRef = useRef('empty');
    const lastCampaignScopeRef = useRef(campaignScopeKey);

    const sourceTablistRef = useRef(null);
    const importTablistRef = useRef(null);
    const fileInputRef = useRef(null);
    const rawId = useId().replace(/:/g, '');
    const statusLabelId = `audience-status-label-${rawId}`;
    const fileInputId = `audience-file-input-${rawId}`;
    const fileHelpId = `audience-file-help-${rawId}`;

    useEffect(() => {
        if (lastCampaignScopeRef.current === campaignScopeKey) return;
        lastCampaignScopeRef.current = campaignScopeKey;
        lastUploadFingerprintRef.current = 'empty';
        setLocalFilters(prev => ({ ...prev, excludedLeadIds: [] }));
    }, [campaignScopeKey]);

    // Effect: Keep localFilters in sync with active tab and imported data
    useEffect(() => {
        if (activeTab === 'upload') {
            const uploadFingerprint = getUploadFingerprint(csvData);
            const shouldResetExclusions = uploadFingerprint !== lastUploadFingerprintRef.current;
            if (shouldResetExclusions) lastUploadFingerprintRef.current = uploadFingerprint;
            setLocalFilters(prev => ({
                ...prev,
                leadType: 'import',
                rawData: csvData,
                excludedLeadIds: shouldResetExclusions ? [] : (prev.excludedLeadIds || [])
            }));
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
    }, [localFilters, matchCount, onChange]);



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

    const activeImportTab = localFilters._importTab === 'sheet' ? 'sheet' : 'file';

    const excludeRecentField = (defaultValue) => (
        <FormField
            label="Exclude Previously Messaged"
            description="Skip numbers that already received a message."
        >
            <Select
                value={localFilters.excludeRecentDays || defaultValue}
                onChange={(e) => handleFilterChange('excludeRecentDays', e.target.value)}
            >
                {EXCLUDE_RECENT_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </Select>
        </FormField>
    );

    return (
        <div className="mx-auto max-w-6xl">
            {/* Header */}
            <div className="mb-ds-8 flex flex-col gap-ds-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="mb-ds-2 text-ds-heading-lg font-bold text-ds-content">Target Audience</h2>
                    <p className="text-ds-body text-ds-content-secondary">Define criteria or upload a custom list.</p>
                </div>
                <div
                    ref={sourceTablistRef}
                    role="tablist"
                    aria-label="Audience source"
                    className="inline-flex flex-wrap gap-ds-1 self-start rounded-ds-lg border border-ds-border-subtle bg-ds-surface p-ds-1"
                >
                    {SOURCE_TABS.map((tab, index) => {
                        const selected = activeTab === tab.value;
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.value}
                                type="button"
                                role="tab"
                                id={`audience-source-tab-${tab.value}`}
                                aria-selected={selected}
                                aria-controls="audience-source-panel"
                                tabIndex={selected ? 0 : -1}
                                onClick={() => setActiveTab(tab.value)}
                                onKeyDown={(event) => moveTabFocus(
                                    event, SOURCE_TABS, index, sourceTablistRef, 'audience-source-tab', setActiveTab,
                                )}
                                className={`flex items-center gap-ds-2 rounded-ds-md px-ds-4 py-ds-2 text-ds-sm font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${
                                    selected
                                        ? 'bg-ds-action-primary text-ds-content-inverse shadow-ds-sm'
                                        : 'text-ds-content-muted hover:bg-ds-surface-subtle hover:text-ds-content'
                                }`}
                            >
                                {Icon && <Icon size={16} aria-hidden="true" />}
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-ds-8 lg:grid-cols-12">

                {/* LEFT COLUMN: FILTERS */}
                <div className="lg:col-span-4">
                    <Card
                        id="audience-source-panel"
                        role="tabpanel"
                        aria-labelledby={`audience-source-tab-${activeTab}`}
                        className="h-full"
                    >
                        {activeTab === 'crm' ? (
                            <>
                                <h3 className="mb-ds-6 flex items-center gap-ds-2 border-b border-ds-border-subtle pb-ds-4 font-bold text-ds-content">
                                    <Filter size={18} className="text-ds-action-primary" aria-hidden="true" /> Filter Criteria
                                </h3>
                                <div className="flex flex-col gap-ds-6">
                                    {/* Source */}
                                    <FormField label="Source">
                                        <Select
                                            value={localFilters.leadType || 'applications'}
                                            onChange={(e) => handleFilterChange('leadType', e.target.value)}
                                        >
                                            <option value="applications">Applicants</option>
                                            <option value="leads">My Leads</option>
                                        </Select>
                                    </FormField>

                                    {/* Recruiter */}
                                    <FormField label="Owner">
                                        <Select
                                            value={localFilters.recruiterId || 'all'}
                                            onChange={(e) => handleFilterChange('recruiterId', e.target.value)}
                                        >
                                            <option value="all">All Team Members</option>
                                            <option value="my_leads">Current User Only</option>
                                            {team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </Select>
                                    </FormField>

                                    {/* Status Pills */}
                                    <div role="group" aria-labelledby={statusLabelId}>
                                        <span id={statusLabelId} className="mb-ds-2 block text-ds-xs font-bold uppercase text-ds-content-secondary">
                                            Status
                                        </span>
                                        <div className="flex flex-wrap gap-ds-2">
                                            {APPLICATION_STATUSES.map((status) => {
                                                const isActive = localFilters.status?.includes(status.id);
                                                return (
                                                    <button
                                                        key={status.id}
                                                        type="button"
                                                        aria-pressed={isActive}
                                                        onClick={() => {
                                                            const current = localFilters.status || [];
                                                            const newVal = isActive ? current.filter(s => s !== status.id) : [...current, status.id];
                                                            handleFilterChange('status', newVal);
                                                        }}
                                                        className={`flex items-center gap-ds-1 rounded-ds-md border px-ds-3 py-ds-1 text-ds-xs font-bold transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${
                                                            isActive
                                                                ? 'border-ds-action-primary bg-ds-action-primary text-ds-content-inverse shadow-ds-xs'
                                                                : 'border-ds-border bg-ds-surface text-ds-content-secondary hover:border-ds-border hover:bg-ds-surface-subtle'
                                                        }`}
                                                    >
                                                        {/* Icon + pressed state so selection is never colour-only. */}
                                                        {isActive && <Check size={12} aria-hidden="true" />}
                                                        {status.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Exclude Previously Messaged */}
                                    <div className="border-t border-ds-border-subtle pt-ds-4">
                                        {excludeRecentField('off')}
                                    </div>

                                    <FormField label="Limit Volume" description="Leave empty to message all matches.">
                                        <Input
                                            type="number"
                                            placeholder="No Limit"
                                            value={localFilters.campaignLimit || ''}
                                            onChange={(e) => handleFilterChange('campaignLimit', e.target.value)}
                                        />
                                    </FormField>
                                </div>
                            </>
                        ) : (
                            /* UPLOAD MODE UI (Simplified for brevity, logic maintained) */
                            <div className="flex flex-col gap-ds-6">
                                <div
                                    ref={importTablistRef}
                                    role="tablist"
                                    aria-label="Import method"
                                    className="flex flex-wrap justify-center gap-ds-2"
                                >
                                    {IMPORT_TABS.map((tab, index) => {
                                        const selected = activeImportTab === tab.value;
                                        return (
                                            <button
                                                key={tab.value}
                                                type="button"
                                                role="tab"
                                                id={`audience-import-tab-${tab.value}`}
                                                aria-selected={selected}
                                                aria-controls="audience-import-panel"
                                                tabIndex={selected ? 0 : -1}
                                                onClick={() => setLocalFilters(p => ({ ...p, _importTab: tab.value }))}
                                                onKeyDown={(event) => moveTabFocus(
                                                    event, IMPORT_TABS, index, importTablistRef, 'audience-import-tab',
                                                    (value) => setLocalFilters(p => ({ ...p, _importTab: value })),
                                                )}
                                                className={`rounded-ds-md px-ds-4 py-ds-2 text-ds-sm font-bold transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${
                                                    selected
                                                        ? 'bg-ds-status-info-bg text-ds-status-info-fg'
                                                        : 'text-ds-content-muted hover:bg-ds-surface-subtle hover:text-ds-content'
                                                }`}
                                            >
                                                {tab.label}
                                            </button>
                                        );
                                    })}
                                </div>

                                <div
                                    id="audience-import-panel"
                                    role="tabpanel"
                                    aria-labelledby={`audience-import-tab-${activeImportTab}`}
                                >
                                    {activeImportTab === 'file' ? (
                                        <div className="flex flex-col items-center gap-ds-3 rounded-ds-lg border-2 border-dashed border-ds-border p-ds-6 text-center">
                                            <UploadCloud className="text-ds-action-primary" size={40} aria-hidden="true" />
                                            <h3 className="font-bold text-ds-content">Upload a recipient list</h3>
                                            {/* The design system has no approved file-input primitive yet, so this
                                                is a documented feature-level composition: a single visually hidden
                                                but labelled native input triggered by the approved Button — no
                                                nested interactive controls, and the accept list is unchanged. */}
                                            <input
                                                ref={fileInputRef}
                                                id={fileInputId}
                                                type="file"
                                                onChange={handleFileChange}
                                                className="ds-visually-hidden"
                                                tabIndex={-1}
                                                aria-label="Upload recipient list file"
                                                aria-describedby={fileHelpId}
                                                accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                                            />
                                            <Button
                                                variant="secondary"
                                                aria-describedby={fileHelpId}
                                                onClick={() => fileInputRef.current?.click()}
                                            >
                                                Choose file
                                            </Button>
                                            <p id={fileHelpId} className="text-ds-xs text-ds-content-secondary">
                                                Support: .csv, .xlsx, .xls
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-ds-3 rounded-ds-lg border border-ds-border-subtle p-ds-6">
                                            <FileSpreadsheet className="mx-auto text-ds-status-success-fg" size={40} aria-hidden="true" />
                                            <h3 className="text-center font-bold text-ds-content">Paste Sheet URL</h3>
                                            <FormField
                                                label="Google Sheet URL"
                                                description='Make sure the sheet is accessible to "Anyone with the link" or public.'
                                            >
                                                <Input
                                                    type="text"
                                                    placeholder="https://docs.google.com/spreadsheets/d/..."
                                                    value={sheetUrl}
                                                    onChange={(e) => setSheetUrl(e.target.value)}
                                                />
                                            </FormField>
                                            <Button
                                                variant="primary"
                                                onClick={handleSheetImport}
                                                loading={processingSheet}
                                            >
                                                {processingSheet ? 'Loading...' : 'Import'}
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                {/* Exclude Previously Messaged for Uploads */}
                                <div className="border-t border-ds-border-subtle pt-ds-4">
                                    {excludeRecentField('7')}
                                </div>
                            </div>

                        )}
                    </Card>
                </div>

                {/* RIGHT COLUMN: PREVIEW */}
                <div className="lg:col-span-8">
                    {/* Temporary exception: this preview surface stays dark because the
                        unmigrated `VirtualLeadList` (out of scope for this slice) renders
                        its own hard-coded dark list chrome. The dark treatment is removed
                        when that list is migrated — tracked in the roadmap. */}
                    <div className="flex h-[650px] flex-col overflow-hidden rounded-ds-xl border border-slate-800 bg-slate-900 p-1 text-white shadow-ds-lg">
                        {/* Preview Header */}
                        <div className="z-10 border-b border-slate-800 bg-slate-900 p-ds-6">
                            <div className="flex items-end justify-between gap-ds-4">
                                <div className="min-w-0">
                                    <div className="mb-ds-1 text-ds-sm font-bold uppercase tracking-wide text-blue-300">
                                        {isUploadMode ? 'Import Manifest' : 'Live Database Query'}
                                    </div>
                                    <p className="flex items-baseline gap-ds-2">
                                        <span className="text-ds-heading-xl font-bold tracking-tight text-white">{finalCount}</span>
                                        <span className="text-ds-body font-medium text-slate-300">recipients</span>
                                    </p>
                                </div>
                                {isCountLoading && <RefreshCw className="animate-spin text-blue-300" aria-hidden="true" />}
                            </div>

                            {/* Announce the recipient count and its loading state. */}
                            <p role="status" className="ds-visually-hidden">
                                {isCountLoading
                                    ? 'Updating recipient count…'
                                    : `${finalCount} recipients selected.`}
                            </p>

                            <div className="mt-ds-2 flex flex-wrap gap-ds-2">
                                {manualExcludedCount > 0 && (
                                    <span className="inline-block rounded-ds-sm bg-red-500/20 px-ds-2 py-ds-1 text-ds-xs font-medium text-red-200">
                                        {manualExcludedCount} manually excluded
                                    </span>
                                )}
                                {phoneExcludedCount > 0 && (
                                    <span className="inline-block rounded-ds-sm bg-amber-500/20 px-ds-2 py-ds-1 text-ds-xs font-medium text-amber-100">
                                        {phoneExcludedCount} already messaged
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* VIRTUAL LIST AREA */}
                        <div className="relative min-h-0 flex-1 bg-black/20" data-testid="audience-preview-list">
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
                        <div className="border-t border-slate-800 bg-slate-900 p-ds-4">
                            <Button
                                variant="primary"
                                size="lg"
                                fullWidth
                                onClick={() => onChange(localFilters, finalCount)}
                            >
                                <CheckCircle2 size={20} aria-hidden="true" />
                                Confirm Audience ({finalCount})
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
