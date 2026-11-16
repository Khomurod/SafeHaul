import React, { useState } from 'react';
import { Icon, AlertTriangle, ShieldCheck, FileText, LayoutGrid, Pencil, Phone } from '@design-system/icons';
import { APPLICATION_SCHEMA } from '@/config/applicationSchema';
import { SchemaSection } from '@shared/components/schema/SchemaRenderer';
import { useApplicationChanges } from '@features/applications/hooks/useApplicationChanges';
import { useSubmissionRecord } from '@features/applications/hooks/useSubmissionRecord';
import { SubmissionRecordNotice } from '@features/applications/components/SubmissionRecordNotice';
import { PreservedApplicationView } from '@features/applications/components/PreservedApplicationView';
import { PreviousEmployersEditor } from '@features/applications/components/PreviousEmployersEditor';
import { DISPLAY_ONLY_REASON, displayOnlyKeys } from '@features/applications/services/editableFields';
import { Badge, Button, Card, Notice, SegmentedControl } from '@/design-system/components';
import { DossierKeyFacts } from '../DossierKeyFacts';
import {
    DossierSummaryCard,
    IdentityCard,
    LicenseCard,
    SafetyCard,
    ExperienceTimeline,
    ConsentCard,
} from './applicationTabCards';
import { ReviewLinkActions } from './ReviewLinkActions';

/**
 * Dossier Application tab.
 *
 * The read-only summary (identity, license, safety, employment, consent), the
 * summary/full toggle and the pending-changes banner use the approved
 * `Card` / `Button` / `IconButton` / `Badge` / `FieldDisplay` primitives and
 * `--ds-*` tokens.
 *
 * DELIBERATELY NOT MIGRATED in this campaign: the full-application
 * `SchemaSection` rendering/editing path and the propose-changes / review-link
 * workflow. Those are the complex-editing surface and are the next campaign;
 * only their trigger buttons are restyled here, with the callbacks untouched.
 *
 * ## Employment history is edited by its own component, and that is not cosmetic
 *
 * `SchemaSection` renders an `array` section read-only whatever `isEditing` says,
 * and employment history is the section a recruiter most often has to correct.
 * That renderer is shared with the driver's own wizard, so the editor lives in the
 * applications feature (`PreviousEmployersEditor`) and is swapped in here for the
 * one section while editing. Every other section renders through `SchemaSection`.
 *
 * The verification mirror on each employer row is never edited or moved: the
 * server strips whatever a client sends and re-attaches it by employer identity
 * (`functions/shared/employerEdits.js`).
 *
 * ## Only the fields the server changes have a box
 *
 * `proposeApplicationChanges` applies its allowlist and returns the rest as
 * `skipped`, so every field off that list (`editableFields.js`, the server's own
 * file) is passed to `SchemaSection` as a locked key, a section with nothing left
 * to edit says "Display only", and the edit bar says why.
 *
 * Frozen contracts: the SSN masking rule, every `--` / `'A'` / `'Driver'`
 * fallback, the CDL expiry bands and their exact labels, the clean-record copy,
 * the legacy/current employer field aliases, the accepted-consent values
 * (`'agreed'` / `'yes'` / `true`), the data-url-only signature rendering, the
 * `'summary'` initial view, and the `previewValue` truncation rules.
 *
 * Rules this tab keeps:
 * - An absent SSN renders the fully-masked `***-**-****`; the mask is never
 *   applied to a fallback string (`'Unknown'` would show as `***-**-nown`).
 * - The SSN reveal toggle is a named `IconButton` whose label reflects its
 *   state, because it exposes a social security number.
 * - The view toggle exposes its pressed state, so assistive technology can tell
 *   which view is active and selection is not carried by colour alone.
 * - Card titles are `<h4>`, beneath the header's `<h3>`.
 * - With no application data the tab renders an announced empty state, never a
 *   blank panel.
 * - Summary values wrap rather than `truncate`, so long addresses and names stay
 *   readable.
 */

/** Compact value preview for the pending-changes before/after list. */
function previewValue(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'object') return Array.isArray(v) ? `${v.length} item(s)` : '(updated)';
    const s = String(v);
    return s.length > 48 ? `${s.slice(0, 48)}…` : s;
}


/**
 * The three records this tab can show, in the order a recruiter uses them (the
 * owner's choice): the record at a glance first, then what was submitted, then
 * the record in full.
 */
const VIEW_MODES = [
    { id: 'summary', label: 'Summary View', Icon: LayoutGrid },
    { id: 'submitted', label: 'As Submitted', Icon: ShieldCheck },
    { id: 'full', label: 'Full Application', Icon: FileText },
];

export function ApplicationTab({ appData, fileUrls = {}, filesPending = false, canEdit = false, companyId, applicationId, collectionName = 'applications' }) {
    /**
     * Which record this tab is showing.
     *
     *   summary   — the current record, at a glance, with how to reach the
     *               driver (`DossierKeyFacts`); the tab opens on it.
     *   submitted — the PRESERVED original, frozen at submission.
     *   full      — the current record in full, and the only editable one.
     *
     * The summary says it is the current record, and points to "As Submitted"
     * for the frozen original when there is one.
     */
    const [viewMode, setViewMode] = useState(null);
    const [editing, setEditing] = useState(false);
    const [editedData, setEditedData] = useState({});

    const {
        pendingChanges, proposing, linking, emailing, emailedTo, proposeChanges, createReviewLink, emailReviewLink,
    } = useApplicationChanges(companyId, applicationId, collectionName);

    // Provenance of what this tab is showing. Resolved before the `!appData`
    // early return so the hook order stays stable across renders.
    const { record: submissionRecord, loading: recordLoading } = useSubmissionRecord(companyId, applicationId);

    const hasPreservedRecord = Boolean(submissionRecord?.isPreserved);
    // Only a reader's own choice changes the view: the read of the preserved
    // record never swaps what is on screen.
    const resolvedViewMode = viewMode ?? 'summary';

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

    // `startEdit` gives a record with no employers an empty list to edit: that
    // list, still empty, is no change.
    const savedValue = (key) => (key === 'employers' && !Array.isArray(appData.employers) ? [] : appData[key]);

    const handlePropose = async () => {
        const changes = Object.keys(editedData)
            .filter((k) => JSON.stringify(editedData[k]) !== JSON.stringify(savedValue(k)))
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
                        <ReviewLinkActions
                            email={appData.email}
                            linking={linking}
                            emailing={emailing}
                            emailedTo={emailedTo}
                            onEmail={emailReviewLink}
                            onCopy={createReviewLink}
                        />
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

            {/* The view switch, and beside it what can be done to the record.
                One row that wraps: the edit controls drop under the switch
                when the panel is narrow. */}
            <div className="flex flex-wrap items-center justify-between gap-ds-3">
                {/*
                  Toggle Header — the design system's `SegmentedControl`:
                  `role="group"` + `aria-pressed`, not a radiogroup, by design. The
                  icon size comes from the control-icon token, not from this call
                  site.
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

                {/* Edit controls */}
                {canEdit && (
                    <div className="flex w-full flex-wrap items-center gap-ds-2 sm:w-auto">
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
                                <span className="text-ds-xs text-ds-content-secondary">
                                    Edits become pending changes the driver must approve. {DISPLAY_ONLY_REASON}
                                </span>
                            </>
                        )}
                    </div>
                )}
            </div>

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
                <div className="grid grid-cols-1 gap-ds-6 xl:grid-cols-12 animate-in fade-in duration-300">

                    {/* 0. How to reach the driver: phone (with Do not text), email,
                        the day the record came in and the last call. */}
                    <div className="xl:col-span-12">
                        <DossierSummaryCard icon={Phone} title="Contact">
                            <DossierKeyFacts
                                appData={appData}
                                collectionName={collectionName}
                                companyId={companyId}
                                canEdit={canEdit}
                            />
                        </DossierSummaryCard>
                    </div>

                    {/* 1. Identity Card (Col Span 6) */}
                    <div className="xl:col-span-6">
                        <IdentityCard appData={appData} />
                    </div>

                    {/* 2. License Card (Col Span 6) */}
                    <div className="xl:col-span-6">
                        <LicenseCard appData={appData} fileUrls={fileUrls} filesPending={filesPending} isLead={collectionName === 'leads'} />
                    </div>

                    {/* 3. Stats / Summary (Col Span 12) */}
                    <div className="xl:col-span-12">
                        <SafetyCard appData={appData} />
                    </div>

                    {/* 4. Experience Timeline (Col Span 12) */}
                    <div className="xl:col-span-12">
                        <ExperienceTimeline appData={appData} />
                    </div>

                    {/* 5. Consent & Signature (Col Span 12) */}
                    <div className="xl:col-span-12">
                        <ConsentCard appData={appData} />
                    </div>
                </div>
            ) : (
                /* Full Application View (Schema Renderer) — the CURRENT record,
                   and the only editable one. Editing a frozen record is not a
                   thing that can happen, so edits necessarily operate here. */
                <Card padding="lg" className="animate-in fade-in duration-300">
                    <div className="mx-auto max-w-4xl space-y-ds-8">
                        {APPLICATION_SCHEMA.sections.map((section) => {
                            const lockedKeys = displayOnlyKeys(section);
                            const nothingToEdit = editing && section.id !== 'employmentHistory'
                                && lockedKeys.length === (section.fields || []).length;
                            return (
                                <div key={section.id} className="border-b border-ds-border-subtle pb-ds-8 last:border-0 last:pb-0">
                                    <h4 className="mb-ds-4 flex items-center gap-ds-2 text-ds-body-lg font-bold text-ds-content">
                                        {section.title}
                                        {nothingToEdit && <Badge tone="neutral">Display only</Badge>}
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
                                            isEditing={editing}
                                            onChange={handleFieldChange}
                                            lockedKeys={lockedKeys}
                                            fileUrls={fileUrls}
                                            filesPending={filesPending}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}
        </div>
    );
}
