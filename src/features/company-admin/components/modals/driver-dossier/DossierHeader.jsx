import React, { useId, useMemo } from 'react';
import { Icon, X, Download, Trash2 } from '@design-system/icons';
import { ATS_STATUS_DROPDOWN_OPTIONS } from '@shared/constants/atsStatus';
import { Badge, IconButton, Select } from '@/design-system/components';
import { dossierStatusLabel as statusLabel } from './dossierStatusLabel';

/**
 * What the status picker offers: the funnel stages and Interested, and the
 * record's own value when it is none of those. A legacy value that names a stage
 * (`New Application`, `New Lead`, `Approved`, `Rejected`) takes that stage's
 * place under its name, so the stage is offered once and choosing it writes
 * nothing; any other keeps its stored name, after the stages. Stored values
 * never change, and every legacy one stays valid in the rules.
 */
function statusOptionsFor(currentStatus) {
    const options = ATS_STATUS_DROPDOWN_OPTIONS.map((value) => ({ value, label: value }));
    if (!currentStatus || !String(currentStatus).trim() || ATS_STATUS_DROPDOWN_OPTIONS.includes(currentStatus)) {
        return options;
    }
    const label = statusLabel(currentStatus);
    const stage = options.findIndex((option) => option.value === label);
    if (stage >= 0) options[stage] = { value: currentStatus, label };
    else options.push({ value: currentStatus, label });
    return options;
}

/**
 * Dossier header: the current section's title, the application reference, the
 * status/assignment controls, and the primary actions.
 *
 * Presentation uses the approved `IconButton`, `Select` and `Badge`
 * primitives with `--ds-*` tokens.
 *
 * Frozen contracts: every per-tab title string (a lead's first tab reads
 * "Lead"), the application tab's
 * `Confirmation Number: <number>` (the number the driver was given, shown only
 * when the record on screen has one; the document id means nothing to the
 * team) and its `Loading...` placeholder while the record loads, the status
 * option set
 * (`statusOptionsFor`: the funnel, Interested and the record's own value) with its
 * `'New'` fallback, the `onStatusUpdate(value)` and `onAssignChange(value)`
 * single-argument callbacks, the `name || displayName || email || id` assignee
 * label chain, the empty string for "Unassigned", the
 * the `canEdit` / `canDelete` visibility rules.
 *
 * CHANGED (preserved-record programme): Download no longer regenerates the
 * application with the browser-side jsPDF generator over live data. It fetches
 * the PRESERVED original, rendered once on the server from the frozen submission
 * record and stored — so the document a recruiter downloads today is the same
 * document they would have downloaded the day it was submitted. The dossier's
 * `handleDownloadPdf` (`useApplicationView`) does it as `onDownload`, and says
 * when there is no file to give.
 *
 * Rules this header keeps:
 * - **The close button has an accessible name**: it is the only way out of a
 *   modal dialog.
 * - The Status and Assign To labels stay in the accessible name computation —
 *   visually hidden on narrow headers, never `display:none`, which would leave
 *   both selects unlabelled on tablets and phones.
 * - The Download action has an explicit accessible name, not `title` alone.
 * - **At 412 px the Close and Delete actions stay on screen.** The action group
 *   shrinks and wraps: a `shrink-0` group never wraps and is clipped by the
 *   dialog panel's `overflow-hidden`, and a phone has no Escape key to close
 *   the dossier with.
 * - **A lead is not an application** (`collectionName`, the collection
 *   `useApplicationView` opened): its first tab is titled "Lead", its delete
 *   reads "Delete lead", and it has no application PDF to download. Anything
 *   else, an application or a record not yet loaded, keeps the application's
 *   wording.
 */
export function DossierHeader({
    activeTab,
    appData,
    loading = false,
    currentStatus,
    onClose,
    onStatusUpdate,
    canEdit,
    teamMembers = [],
    assignedTo,
    onAssignChange,
    canDelete = false,
    onDelete,
    onDownload,
    collectionName,
}) {
    const rawId = useId().replace(/:/g, '');
    const statusId = `dossier-status-${rawId}`;
    const assignId = `dossier-assign-${rawId}`;

    const isLead = collectionName === 'leads';

    const getTitle = () => {
        switch (activeTab) {
            case 'application': return isLead ? 'Lead' : 'Application Review';
            case 'documents': return 'Documents to sign';
            case 'dq': return 'Driver Qualification File';
            case 'activity': return 'Activity Timeline';
            case 'notes': return 'Internal Notes';
            case 'pev': return 'Previous Employment Verification';
            default: return 'Driver Dossier';
        }
    };

    const statusOptions = useMemo(() => statusOptionsFor(currentStatus), [currentStatus]);

    const statusValue = currentStatus || 'New';

    // The number the driver was shown and emailed; a lead or a record made by hand has none.
    const confirmationNumber = typeof appData?.confirmationNumber === 'string' ? appData.confirmationNumber.trim() : '';

    return (
        <>
            {/* `basis-48` keeps the title a readable line: with `flex-1`'s zero
                basis it absorbed none of the available width and collapsed to
                nothing behind the action group. */}
            {/* Wraps, so on a phone the number goes under the title rather than
                squeezing it to a few letters. */}
            <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-x-ds-3 gap-y-ds-1">
                {/* `<h3>` sits under the identity `<h2>` in the sidebar, which in
                    turn sits under the dialog's own accessible name. */}
                <h3 className="max-w-full truncate text-ds-body-lg font-bold text-ds-content">{getTitle()}</h3>

                {activeTab === 'application' && (loading || confirmationNumber) && (
                    <span className="shrink-0">
                        <Badge tone="neutral">
                            {loading ? 'Loading...' : `Confirmation Number: ${confirmationNumber}`}
                        </Badge>
                    </span>
                )}
            </div>

            {/*
              DEFECT FIX (see the note above): `shrink-0` gave this group an
              unconstrained max-content width, so `flex-wrap` never engaged and
              the group ran 489 px wide inside a 412 px dialog. It may now shrink
              and wrap onto further lines; `min-w-0` is what actually lets it.
            */}
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-ds-2">
                {canEdit && (
                    <>
                        <div className="flex items-center gap-ds-2">
                            {/* Always in the accessible name tree; only the visual
                                presentation collapses on narrow headers. */}
                            <label
                                htmlFor={statusId}
                                className="sr-only text-ds-xs font-semibold text-ds-content-secondary xl:not-sr-only"
                            >
                                Status
                            </label>
                            <Select
                                id={statusId}
                                className="max-w-[200px]"
                                value={statusValue}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    if (onStatusUpdate) void onStatusUpdate(v);
                                }}
                            >
                                {statusOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </Select>
                        </div>

                        <div className="flex items-center gap-ds-2">
                            <label
                                htmlFor={assignId}
                                className="sr-only text-ds-xs font-semibold text-ds-content-secondary xl:not-sr-only"
                            >
                                Assign To
                            </label>
                            <Select
                                id={assignId}
                                className="max-w-[180px]"
                                value={assignedTo || ''}
                                onChange={(e) => {
                                    if (onAssignChange) void onAssignChange(e.target.value);
                                }}
                            >
                                <option value="">Unassigned</option>
                                {(teamMembers || []).map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.name || m.displayName || m.email || m.id}
                                    </option>
                                ))}
                            </Select>
                        </div>

                        <span aria-hidden="true" className="hidden h-6 w-px bg-ds-border-subtle sm:block" />
                    </>
                )}

                {/* A lead has no application document; its files are in its DQ File. */}
                {!isLead && (
                    <IconButton
                        variant="ghost"
                        label="Download application PDF"
                        onClick={onDownload}
                    >
                        <Icon icon={Download} size="xl" />
                    </IconButton>
                )}

                {canDelete && (
                    <IconButton
                        variant="ghost"
                        label={isLead ? 'Delete lead' : 'Delete application'}
                        onClick={onDelete}
                    >
                        <Icon icon={Trash2} size="xl" className="text-ds-status-danger-fg" />
                    </IconButton>
                )}

                <span aria-hidden="true" className="mx-ds-1 hidden h-6 w-px bg-ds-border-subtle sm:block" />

                <IconButton
                    variant="ghost"
                    label="Close driver dossier"
                    onClick={onClose}
                >
                    <Icon icon={X} size="2xl" />
                </IconButton>
            </div>
        </>
    );
}
