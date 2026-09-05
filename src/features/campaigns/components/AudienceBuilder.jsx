import React, { useState, useEffect, useId, useRef } from 'react';
import { useCampaignTargeting } from '../hooks/useCampaignTargeting';
import { useCompanyTeam } from '@/shared/hooks/useCompanyTeam';
import { useData } from '@/context/DataContext';
import { APPLICATION_STATUSES, LAST_CALL_RESULTS } from '../constants/campaignConstants';
import { Filter, Users, RefreshCw, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { useBulkImport } from '@/shared/hooks/useBulkImport';
import { useToast } from '@shared/components/feedback/ToastProvider';
import VirtualLeadList from './VirtualLeadList';
import {
    Badge, Button, Card, Chip, ChipGroup, FileInput, FormField, Input, Select,
    TabList, TabPanel,
} from '@/design-system/components';

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
    { id: 'crm', label: 'CRM Filters' },
    { id: 'upload', label: 'Upload List', icon: FileSpreadsheet },
];

const IMPORT_TABS = [
    { id: 'file', label: 'File Upload (CSV/XLSX)' },
    { id: 'sheet', label: 'Google Sheets' },
];

// Shared option list for both the CRM and upload "exclude previously messaged"
// selects. Values are the frozen filter contract; only the defaults differ.
const EXCLUDE_RECENT_OPTIONS = [
    { value: 'off', label: 'No Exclusion' },
    { value: '7', label: 'Last 7 Days' },
    { value: '30', label: 'Last 30 Days' },
    { value: 'forever', label: 'All Time (Never Re-send)' },
];

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

    const fileInputRef = useRef(null);
    const rawId = useId().replace(/:/g, '');
    const statusLabelId = `audience-status-label-${rawId}`;
    const fileInputId = `audience-file-input-${rawId}`;

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
                <TabList
                    ariaLabel="Audience source"
                    idBase="audience-source"
                    tabs={SOURCE_TABS}
                    activeTab={activeTab}
                    onChange={setActiveTab}
                    className="self-start"
                />
            </div>

            <div className="grid grid-cols-1 gap-ds-8 lg:grid-cols-12">

                {/* LEFT COLUMN: FILTERS */}
                <div className="lg:col-span-4">
                    <TabPanel idBase="audience-source" tabId={activeTab} className="h-full">
                        <Card className="h-full">
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
                                        <div>
                                            <span id={statusLabelId} className="mb-ds-2 block text-ds-xs font-bold uppercase text-ds-content-secondary">
                                                Status
                                            </span>
                                            {/* Multi-select: `Chip` carries the pressed state and its leading
                                                check, so selection is never colour alone. */}
                                            <ChipGroup ariaLabelledBy={statusLabelId}>
                                                {APPLICATION_STATUSES.map((status) => {
                                                    const isActive = !!localFilters.status?.includes(status.id);
                                                    return (
                                                        <Chip
                                                            key={status.id}
                                                            pressed={isActive}
                                                            onClick={() => {
                                                                const current = localFilters.status || [];
                                                                const newVal = isActive ? current.filter(s => s !== status.id) : [...current, status.id];
                                                                handleFilterChange('status', newVal);
                                                            }}
                                                        >
                                                            {status.label}
                                                        </Chip>
                                                    );
                                                })}
                                            </ChipGroup>
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
                                    {/*
                                      `variant="pill"` because this strip sits INSIDE
                                      the source panel: an underline here would read as
                                      a second page-level strip competing with the one
                                      above it. Same control, same keyboard model — only
                                      the selected treatment differs.
                                    */}
                                    <TabList
                                        ariaLabel="Import method"
                                        idBase="audience-import"
                                        tabs={IMPORT_TABS}
                                        activeTab={activeImportTab}
                                        onChange={(value) => setLocalFilters(prev => ({ ...prev, _importTab: value }))}
                                        variant="pill"
                                        className="justify-center"
                                    />

                                    <TabPanel idBase="audience-import" tabId={activeImportTab}>
                                        {activeImportTab === 'file' ? (
                                            /*
                                              `FileInput variant="dropzone"`. This was a hidden
                                              input driven by a `Button`, under a comment saying
                                              the design system had no file-input primitive —
                                              untrue from 2026-08-21. The accept list is
                                              unchanged, and `FileInput`'s `onDrop` makes the
                                              whole panel a real drop target for the input it
                                              labels, which it was not before.
                                            */
                                            <FileInput
                                                ref={fileInputRef}
                                                id={fileInputId}
                                                label="Upload a recipient list"
                                                variant="dropzone"
                                                buttonLabel="Choose file"
                                                description="Support: .csv, .xlsx, .xls"
                                                accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                                                onChange={handleFileChange}
                                            />
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
                                    </TabPanel>

                                    {/* Exclude Previously Messaged for Uploads */}
                                    <div className="border-t border-ds-border-subtle pt-ds-4">
                                        {excludeRecentField('7')}
                                    </div>
                                </div>

                            )}
                        </Card>
                    </TabPanel>
                </div>

                {/* RIGHT COLUMN: PREVIEW */}
                <div className="lg:col-span-8">
                    {/* An inverse ("console") surface, expressed in the approved
                        `--ds-color-surface-inverse` roles. This used to be literal slate
                        values described as a temporary exception pending
                        `VirtualLeadList`'s migration; the list is migrated now, and both
                        halves of the panel read from the same roles. */}
                    <div className="flex h-[650px] flex-col overflow-hidden rounded-ds-xl border border-ds-border-inverse bg-ds-surface-inverse p-ds-1 text-ds-content-on-inverse shadow-ds-lg">
                        {/* Preview Header */}
                        <div className="z-ds-raised border-b border-ds-border-inverse bg-ds-surface-inverse p-ds-6">
                            <div className="flex items-end justify-between gap-ds-4">
                                <div className="min-w-0">
                                    <div className="mb-ds-1 text-ds-sm font-bold uppercase tracking-wide text-ds-status-info-fg-on-inverse">
                                        {isUploadMode ? 'Import Manifest' : 'Live Database Query'}
                                    </div>
                                    <p className="flex items-baseline gap-ds-2">
                                        <span className="text-ds-heading-xl font-bold tracking-tight text-ds-content-on-inverse">{finalCount}</span>
                                        <span className="text-ds-body font-medium text-ds-content-on-inverse-muted">recipients</span>
                                    </p>
                                </div>
                                {isCountLoading && <RefreshCw className="animate-spin text-ds-status-info-fg-on-inverse" aria-hidden="true" />}
                            </div>

                            {/* Announce the recipient count and its loading state. */}
                            <p role="status" className="ds-visually-hidden">
                                {isCountLoading
                                    ? 'Updating recipient count…'
                                    : `${finalCount} recipients selected.`}
                            </p>

                            <div className="mt-ds-2 flex flex-wrap gap-ds-2">
                                {/* These were two hand-built tinted chips. They are counts with
                                    a status meaning, which is what `Badge` is — and the list
                                    below already puts `Badge`s on this same surface, so the two
                                    were the odd ones out on their own panel. */}
                                {manualExcludedCount > 0 && (
                                    <Badge tone="danger">{manualExcludedCount} manually excluded</Badge>
                                )}
                                {phoneExcludedCount > 0 && (
                                    <Badge tone="warning">{phoneExcludedCount} already messaged</Badge>
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
                        <div className="border-t border-ds-border-inverse bg-ds-surface-inverse p-ds-4">
                            <Button
                                variant="primary"
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
