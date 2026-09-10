import React, { useState } from 'react';
import { Icon, AlertTriangle, ShieldCheck, FileText, Pencil, Link2 } from '@design-system/icons';
import { APPLICATION_SCHEMA } from '@/config/applicationSchema';
import { SchemaSection } from '@shared/components/schema/SchemaRenderer';
import { useApplicationChanges } from '@features/applications/hooks/useApplicationChanges';
import { useSubmissionRecord } from '@features/applications/hooks/useSubmissionRecord';
import { SubmissionRecordNotice } from '@features/applications/components/SubmissionRecordNotice';
import { PreservedApplicationView } from '@features/applications/components/PreservedApplicationView';
import { PreviousEmployersEditor } from '@features/applications/components/PreviousEmployersEditor';
import { Badge, Button, Card, Notice, SegmentedControl } from '@/design-system/components';
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
 * ## Employment history is edited by its own component, and that is not cosmetic
 *
 * `SchemaSection` renders an `array` section read-only whatever `isEditing` says,
 * so until 2026-09-09 "Edit application" could change every scalar field and none
 * of the employment history — the section a recruiter most often has to correct.
 * That renderer is shared with the driver's own wizard, so the editor lives in the
 * applications feature (`PreviousEmployersEditor`) and is swapped in here for the
 * one section while editing. Every other section renders exactly as before.
 *
 * The verification mirror on each employer row is never edited or moved: the
 * server strips whatever a client sends and re-attaches it by employer identity
 * (`functions/shared/employerEdits.js`).
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
                {/* A page-level state glyph in a FLUID container, so unlike
                    `BrandingSection`'s 128px frame there is no ratio to hold. `3xl`
                    (32) is this product's answer for the role — it is what an `lg`
                    `StatusMedallion` and `PageState` have rendered since 7a. */}
                <Icon icon={FileText} size="3xl" className="mb-ds-4 text-ds-content-muted" />
                <p className="font-medium text-ds-content">Application details are not available.</p>
                <p className="mt-ds-1 text-ds-sm">This record may have been removed, or you may not have access to it.</p>
            </div>
        );
    }

    const startEdit = () => {
        setEditedData({
            ...appData,
            /**
             * A copy of the rows, not the record's own array.
             *
             * The spread above is shallow, so `editedData.employers` would be the
             * very array on `appData` — and `handlePropose` diffs the two by
             * value. An editor working in place would corrupt the original AND
             * make the diff conclude nothing had changed. One level is enough:
             * the editor replaces whole rows rather than reaching inside them.
             */
            employers: Array.isArray(appData.employers) ? [...appData.employers] : [],
        });
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
                <Notice
                    tone="warning"
                    title={`${pendingChanges.length} field(s) edited by company — pending driver approval`}
                    actions={(
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={createReviewLink}
                            disabled={linking}
                            loading={linking}
                        >
                            {linking ? null : <Icon icon={Link2} size="sm" />}
                            Copy driver review link
                        </Button>
                    )}
                >
                    <ul className="space-y-ds-1">
                        {pendingChanges.map((c) => (
                            <li key={c.id} className="flex flex-wrap items-center gap-ds-1 text-ds-xs">
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
                </Notice>
            )}

            {/* Edit controls */}
            {canEdit && (
                <div className="flex flex-wrap items-center gap-ds-2">
                    {!editing ? (
                        <Button variant="secondary" size="sm" onClick={startEdit}>
                            <Icon icon={Pencil} size="sm" /> Edit application
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
                    <Icon icon={AlertTriangle} size="sm" className="shrink-0" />
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
                                {editing && section.id === 'employmentHistory' ? (
                                    /* The one section `SchemaSection` cannot edit —
                                       see the header. Read-only rendering is still
                                       its job, so this swap is scoped to editing. */
                                    <PreviousEmployersEditor
                                        employers={editedData.employers}
                                        onChange={(employers) => handleFieldChange('employers', employers)}
                                    />
                                ) : (
                                    <SchemaSection
                                        sectionId={section.id}
                                        data={editing ? editedData : appData}
                                        mode="display"
                                        isEditing={editing}
                                        onChange={handleFieldChange}
                                        fileUrls={fileUrls}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
}
