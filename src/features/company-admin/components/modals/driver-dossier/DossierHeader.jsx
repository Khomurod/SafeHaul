import React, { useId, useMemo } from 'react';
import { Icon, X, Download, Trash2 } from '@design-system/icons';
import { ATS_STATUS_DROPDOWN_OPTIONS } from '@shared/constants/atsStatus';
import { IconButton, Select } from '@/design-system/components';
import { dossierStatusLabel as statusLabel } from './dossierStatusLabel';
import { sectionTitle } from './dossierSections';
import { stageOptionLabel } from './contactAttemptText';

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
 * Presentation uses the approved `IconButton` and `Select`
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
 * - The Status and Assigned to labels are visible at every width, on one line
 *   (over their select below 1440px), and name their selects through `htmlFor`.
 * - The Download action has an explicit accessible name, not `title` alone.
 * - **At 412 px the Close and Delete actions stay on screen.** The actions are
 *   their own group of at most three icon buttons beside the title; the selects,
 *   the wide part, take the next row below 1440px. A phone has no Escape key to
 *   close the dossier with.
 * - **A lead is not an application** (`collectionName`, the collection
 *   `useApplicationView` opened): its first tab is titled "Lead", its delete
 *   reads "Delete lead", and it has no application PDF to download. Anything
 *   else, an application or a record not yet loaded, keeps the application's
 *   wording.
 * - **On a phone Close is not here** (`showClose={false}`): it leads the
 *   dossier's one-line identity bar (`DossierIdentityBar`), above everything
 *   that scrolls.
 * - **A stage that texts the driver says so in the picker** (У5.3):
 *   `textOutlookFor(value)` (`useContactAttemptTexts`) is `'texts'` or `'may'`
 *   for a Contact Attempt stage the server would text the driver on, and the
 *   option reads "Contact Attempt 1 — texts the driver" ("— may text the
 *   driver" while the dossier cannot know). The stored value is unchanged.
 */

/** The dossier's one way out, the same control wherever it sits. */
export function DossierCloseButton({ onClose }) {
    return (
        <IconButton
            variant="ghost"
            label="Close driver dossier"
            onClick={onClose}
        >
            <Icon icon={X} size="2xl" />
        </IconButton>
    );
}

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
    showClose = true,
    textOutlookFor,
}) {
    const rawId = useId().replace(/:/g, '');
    const statusId = `dossier-status-${rawId}`;
    const assignId = `dossier-assign-${rawId}`;

    const isLead = collectionName === 'leads';

    // The section's one name, the tab's (У4.7).
    const getTitle = () => sectionTitle(activeTab, { isLead });

    const statusOptions = useMemo(() => statusOptionsFor(currentStatus).map((option) => ({
        ...option,
        label: stageOptionLabel(option.label, textOutlookFor?.(option.value)),
    })), [currentStatus, textOutlookFor]);

    const statusValue = currentStatus || 'New';

    // The number the driver was shown and emailed; a lead or a record made by hand has none.
    const confirmationNumber = typeof appData?.confirmationNumber === 'string' ? appData.confirmationNumber.trim() : '';

    return (
        <>
            {/* The title, and under it the number the driver was given. Stacked,
                so the pair is as narrow as its longer line and the controls keep
                the width. */}
            <div className="flex min-w-0 flex-1 basis-48 flex-col items-start gap-y-ds-1">
                {/* `<h3>` sits under the identity `<h2>` in the sidebar, which in
                    turn sits under the dialog's own accessible name. */}
                <h3 className="max-w-full truncate text-ds-heading-sm font-bold text-ds-content">{getTitle()}</h3>

                {/* Text rather than a badge, which never wraps: beside the
                    actions on a tablet the line breaks after "Number:" instead
                    of running under them. */}
                {activeTab === 'application' && (loading || confirmationNumber) && (
                    <p className="max-w-full text-ds-xs font-medium text-ds-content-secondary [overflow-wrap:anywhere]">
                        {loading ? 'Loading...' : (
                            // The number itself never breaks at its hyphens.
                            <>Confirmation Number: <span className="whitespace-nowrap">{confirmationNumber}</span></>
                        )}
                    </p>
                )}
            </div>

            {/*
              Status and Assigned to. Below 1440px this group takes a row of its
              own (`basis-full`, `order-last`) under the title and the actions,
              so the actions never sit alone on a line; from 1440px, where the
              dossier is wide enough, all three share one row in reading order.
              Each label stays visible and on one line: over its select below
              1440px, beside it from there.
            */}
            {canEdit && (
                <div className="order-last grid basis-full grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-ds-3 min-[1440px]:order-none min-[1440px]:flex min-[1440px]:basis-auto min-[1440px]:items-center min-[1440px]:gap-x-ds-3">
                    <div className="flex min-w-0 flex-col gap-ds-1 min-[1440px]:flex-row min-[1440px]:items-center">
                        <label htmlFor={statusId} className="whitespace-nowrap text-ds-xs font-semibold text-ds-content-secondary">
                            Status
                        </label>
                        <Select
                            id={statusId}
                            className="sm:max-w-[280px] min-[1440px]:max-w-[200px]"
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

                    <div className="flex min-w-0 flex-col gap-ds-1 min-[1440px]:flex-row min-[1440px]:items-center">
                        <label htmlFor={assignId} className="whitespace-nowrap text-ds-xs font-semibold text-ds-content-secondary">
                            Assigned to
                        </label>
                        <Select
                            id={assignId}
                            className="sm:max-w-[280px] min-[1440px]:max-w-[160px]"
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
                </div>
            )}

            {/* Download, Delete and Close: beside the title at every width. */}
            <div className="flex shrink-0 items-center gap-ds-1">
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

                {showClose && (
                    <>
                        <span aria-hidden="true" className="mx-ds-1 hidden h-6 w-px bg-ds-border-subtle sm:block" />
                        <DossierCloseButton onClose={onClose} />
                    </>
                )}
            </div>
        </>
    );
}
