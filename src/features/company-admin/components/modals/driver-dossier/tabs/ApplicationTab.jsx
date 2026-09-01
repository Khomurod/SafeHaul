import React, { useState } from 'react';
import {
    AlertTriangle,
    ShieldCheck,
    FileText,
    Pencil,
    Link2,
} from 'lucide-react';
import { APPLICATION_SCHEMA } from '@/config/applicationSchema';
import { SchemaSection } from '@shared/components/schema/SchemaRenderer';
import { useApplicationChanges } from '@features/applications/hooks/useApplicationChanges';
import { useSubmissionRecord } from '@features/applications/hooks/useSubmissionRecord';
import { SubmissionRecordNotice } from '@features/applications/components/SubmissionRecordNotice';
import { PreservedApplicationView } from '@features/applications/components/PreservedApplicationView';
import { Badge, Button, Card, SegmentedControl } from '@/design-system/components';
import {
    IdentityCard,
    LicenseCard,
    SafetyCard,
    ExperienceTimeline,
    ConsentCard,
} from './applicationTabCards';

/**
 * Dossier Application tab.
 *
 * The read-only summary (identity, license, safety, employment, consent), the
 * summary/full toggle and the pending-changes banner are migrated to the
 * approved `Card` / `Button` / `IconButton` / `Badge` / `FieldDisplay`
 * primitives and `--ds-*` tokens (2026-07-27).
 *
 * DELIBERATELY NOT MIGRATED in this campaign: the full-application
 * `SchemaSection` rendering/editing path and the propose-changes / review-link
 * workflow. Those are the complex-editing surface and are the next campaign;
 * only their trigger buttons are restyled here, with the callbacks untouched.
 *
 * Frozen contracts: the SSN masking rule, every `--` / `'A'` / `'Driver'`
 * fallback, the CDL expiry bands and their exact labels, the clean-record copy,
 * the legacy/current employer field aliases, the accepted-consent values
 * (`'agreed'` / `'yes'` / `true`), the data-url-only signature rendering, the
 * `'summary'` initial view, and the `previewValue` truncation rules.
 *
 * DEFECTS FIXED (2026-07-27):
 * - With no SSN on the application the mask was applied to the literal fallback
 *   string `'Unknown'`, so the card displayed **`***-**-nown`**. An absent SSN
 *   now renders the fully-masked `***-**-****`.
 * - The SSN reveal toggle was an icon-only `<button>` with no accessible name,
 *   so a screen-reader user was offered an unlabelled control that exposes a
 *   social security number. It is now a named `IconButton` whose label reflects
 *   its state.
 * - The summary/full toggle was two `<button>`s with no pressed state, so
 *   assistive technology could not tell which view was active — selection was
 *   carried by background colour alone.
 * - Card titles were `<h3>`; they now sit at `<h4>` beneath the header's `<h3>`.
 * - With no application data the tab rendered **nothing at all**, leaving the
 *   dossier's tab panel blank with no explanation. It now renders an announced
 *   empty state.
 * - Summary rows applied `truncate` to the value, so long addresses and names
 *   were clipped with no tooltip and no way to read them. Values now wrap.
 */

/** Compact value preview for the pending-changes before/after list. */
function previewValue(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'object') return Array.isArray(v) ? `${v.length} item(s)` : '(updated)';
    const s = String(v);
    return s.length > 48 ? `${s.slice(0, 48)}…` : s;
}


/**
 * The three records this tab can show, in the order a recruiter wants them:
 * what was submitted first, then what the record says now.
 */
const VIEW_MODES = [
    { id: 'submitted', label: 'As Submitted', Icon: ShieldCheck },
    { id: 'summary', label: 'Summary View', Icon: null },
    { id: 'full', label: 'Full Application', Icon: FileText },
];

export function ApplicationTab({ appData, fileUrls = {}, canEdit = false, companyId, applicationId, collectionName = 'applications' }) {
    /**
     * Which record this tab is showing.
     *
     *   submitted — the PRESERVED original, frozen at submission.
     *   summary   — the current record, at a glance.
     *   full      — the current record in full, and the only editable one.
     *
     * The default is set below, once the preserved record has resolved: a
     * recruiter opening an application should land on what the applicant
     * actually submitted, not on data a company edit may have changed since.
     */
    const [viewMode, setViewMode] = useState(null);
    const [editing, setEditing] = useState(false);
    const [editedData, setEditedData] = useState({});

    const { pendingChanges, proposing, linking, proposeChanges, createReviewLink } =
        useApplicationChanges(companyId, applicationId, collectionName);

    // Provenance of what this tab is showing. Resolved before the `!appData`
    // early return so the hook order stays stable across renders.
    const { record: submissionRecord, loading: recordLoading } = useSubmissionRecord(companyId, applicationId);

    const hasPreservedRecord = Boolean(submissionRecord?.isPreserved);
    /**
     * An explicit choice always wins, so a reader who has switched views is never
     * moved. With no choice yet, the default assumes a preserved record WHILE THE
     * READ IS STILL IN FLIGHT — otherwise the tab would open on live data and
     * then swap to the frozen record a moment later, which is the one transition
     * that must not happen quietly on this screen. It settles on the summary only
     * once we know there is nothing preserved to show.
     */
    const resolvedViewMode = viewMode
        ?? ((recordLoading || hasPreservedRecord) ? 'submitted' : 'summary');

    // DEFECT FIX: this used to `return null`, so an application that resolved to
    // nothing left the dossier's tab panel completely blank — no explanation and
    // no indication that anything had happened. The panel now says so.
    if (!appData) {
        return (
            <div
                role="status"
                className="flex flex-col items-center justify-center py-ds-12 text-center text-ds-content-secondary"
            >
                <FileText size={48} className="mb-ds-4 text-ds-content-muted" aria-hidden="true" />
                <p className="font-medium text-ds-content">Application details are not available.</p>
                <p className="mt-ds-1 text-ds-sm">This record may have been removed, or you may not have access to it.</p>
            </div>
        );
    }

    const startEdit = () => {
        setEditedData({ ...appData });
        setEditing(true);
        // Edits operate on the current record; the preserved one is frozen.
        setViewMode('full');
    };

    const handleFieldChange = (key, value) => {
        setEditedData((prev) => ({ ...prev, [key]: value }));
    };

    const handlePropose = async () => {
        const changes = Object.keys(editedData)
            .filter((k) => JSON.stringify(editedData[k]) !== JSON.stringify(appData[k]))
            .map((k) => ({ fieldKey: k, proposedValue: editedData[k] }));
        if (changes.length === 0) { setEditing(false); return; }
        const ok = await proposeChanges(changes);
        if (ok) setEditing(false);
    };

    return (
        <div className="space-y-ds-6">
            {/* Pending company edits — awaiting driver approval */}
            {pendingChanges.length > 0 && (
                <Card padding="md" className="border-ds-status-warning-border bg-ds-status-warning-bg">
                    <div className="mb-ds-2 flex flex-wrap items-center justify-between gap-ds-3">
                        <p className="flex items-center gap-ds-2 text-ds-sm font-semibold text-ds-status-warning-fg">
                            <AlertTriangle size={16} aria-hidden="true" />
                            {pendingChanges.length} field(s) edited by company — pending driver approval
                        </p>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={createReviewLink}
                            disabled={linking}
                            loading={linking}
                        >
                            {linking ? null : <Link2 size={14} aria-hidden="true" />}
                            Copy driver review link
                        </Button>
                    </div>
                    <ul className="space-y-ds-1">
                        {pendingChanges.map((c) => (
                            <li key={c.id} className="flex flex-wrap items-center gap-ds-1 text-ds-xs text-ds-status-warning-fg">
                                <span className="font-semibold">{c.fieldLabel || c.fieldKey}:</span>
                                <span className="line-through">{previewValue(c.originalValue)}</span>
                                <span aria-hidden="true">→</span>
                                <span className="font-medium">{previewValue(c.proposedValue)}</span>
                                {c.status && c.status !== 'pending' && (
                                    <Badge tone="warning">{c.status}</Badge>
                                )}
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            {/* Edit controls */}
            {canEdit && (
                <div className="flex flex-wrap items-center gap-ds-2">
                    {!editing ? (
                        <Button variant="secondary" size="sm" onClick={startEdit}>
                            <Pencil size={14} aria-hidden="true" /> Edit application
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={handlePropose}
                                disabled={proposing}
                                loading={proposing}
                            >
                                Propose changes for approval
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                                Cancel
                            </Button>
                            <span className="text-ds-xs text-ds-content-secondary">Edits become pending changes the driver must approve.</span>
                        </>
                    )}
                </div>
            )}

            {/*
              Toggle Header — the design system's `SegmentedControl` since
              2026-08-25. It was a hand-built `role="group"` of `aria-pressed`
              buttons, recorded as an exception because "the design system has no
              Segmented/ToggleGroup primitive yet"; one shipped on 2026-08-21
              naming this call site. The semantics are the same by design — the
              primitive is `role="group"` + `aria-pressed`, not a radiogroup — and
              the icon size now comes from the control-icon token instead of a
              `size={14}` chosen here.
            */}
            <SegmentedControl
                ariaLabel="Application view"
                columns={3}
                className="w-fit"
                value={resolvedViewMode}
                onChange={setViewMode}
                options={VIEW_MODES.map((mode) => ({
                    value: mode.id,
                    label: mode.label,
                    icon: mode.Icon || undefined,
                }))}
            />

            {/*
              Each view says which record it is. The provenance notice used to sit
              above every view, including the live ones, which told a recruiter the
              record was frozen while showing them data a company edit can change.
            */}
            {resolvedViewMode === 'submitted' ? (
                <SubmissionRecordNotice record={submissionRecord} />
            ) : (
                <p role="status" className="flex items-center gap-ds-2 text-ds-sm text-ds-content-secondary">
                    <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />
                    <span>
                        This is the current record, which company edits and driver updates can change.
                        {hasPreservedRecord ? ' Choose “As Submitted” for the frozen original.' : ''}
                    </span>
                </p>
            )}

            {resolvedViewMode === 'submitted' ? (
                /*
                  The preserved original, rendered from the frozen record and
                  nothing else. There is no fall-back to `appData` here on
                  purpose: a surface that silently substitutes live data when the
                  record is missing is exactly the defect this replaces.
                */
                recordLoading
                    ? <p role="status" className="py-ds-8 text-center text-ds-content-secondary">Loading the preserved record…</p>
                    : <PreservedApplicationView record={submissionRecord} />
            ) : resolvedViewMode === 'summary' ? (
                /* Summary View (Cards) — the CURRENT record, at a glance */
                <div className="grid grid-cols-1 gap-ds-6 md:grid-cols-12 animate-in fade-in duration-300">

                    {/* 1. Identity Card (Col Span 6) */}
                    <div className="md:col-span-6">
                        <IdentityCard appData={appData} />
                    </div>

                    {/* 2. License Card (Col Span 6) */}
                    <div className="md:col-span-6">
                        <LicenseCard appData={appData} fileUrls={fileUrls} />
                    </div>

                    {/* 3. Stats / Summary (Col Span 12) */}
                    <div className="md:col-span-12">
                        <SafetyCard appData={appData} />
                    </div>

                    {/* 4. Experience Timeline (Col Span 12) */}
                    <div className="md:col-span-12">
                        <ExperienceTimeline appData={appData} />
                    </div>

                    {/* 5. Consent & Signature (Col Span 12) */}
                    <div className="md:col-span-12">
                        <ConsentCard appData={appData} />
                    </div>
                </div>
            ) : (
                /* Full Application View (Schema Renderer) — the CURRENT record,
                   and the only editable one. Editing a frozen record is not a
                   thing that can happen, so edits necessarily operate here. */
                <Card padding="lg" className="animate-in fade-in duration-300">
                    <div className="mx-auto max-w-4xl space-y-ds-8">
                        {APPLICATION_SCHEMA.sections.map(section => (
                            <div key={section.id} className="border-b border-ds-border-subtle pb-ds-8 last:border-0 last:pb-0">
                                <h4 className="mb-ds-4 flex items-center gap-ds-2 text-ds-body-lg font-bold text-ds-content">
                                    {section.title}
                                </h4>
                                <SchemaSection
                                    sectionId={section.id}
                                    data={editing ? editedData : appData}
                                    mode="display"
                                    isEditing={editing}
                                    onChange={handleFieldChange}
                                    fileUrls={fileUrls}
                                />
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
}
