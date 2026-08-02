import React, { useId, useMemo } from 'react';
import { X, Download, Trash2 } from 'lucide-react';
import { generateApplicationPDF } from '@shared/utils/pdfGenerator';
import { ATS_STATUS_DROPDOWN_OPTIONS } from '@shared/constants/atsStatus';
import { Badge, IconButton, Select } from '@/design-system/components';

/**
 * Dossier header: the current section's title, the application reference, the
 * status/assignment controls, and the primary actions.
 *
 * Presentation migrated to the approved `IconButton`, `Select` and `Badge`
 * primitives with `--ds-*` tokens (2026-07-27).
 *
 * Frozen contracts: every per-tab title string, the `App ID: <first 8 chars>`
 * presentation and its `Loading...` placeholder, the status option set
 * (`ATS_STATUS_DROPDOWN_OPTIONS` plus the current status, deduplicated) with its
 * `'New'` fallback, the `onStatusUpdate(value)` and `onAssignChange(value)`
 * single-argument callbacks, the `name || displayName || email || id` assignee
 * label chain, the empty string for "Unassigned", the
 * `generateApplicationPDF({ applicant, company, agreements: [] })` payload, and
 * the `canEdit` / `canDelete` visibility rules.
 *
 * DEFECTS FIXED (2026-07-27):
 * - **The close button had no accessible name at all** — an icon-only `<button>`
 *   with neither `title` nor `aria-label`. Screen-reader users were offered an
 *   unlabelled control as the only way out of a modal dialog.
 * - The Status and Assign To selects took their accessible name from a `<span>`
 *   marked `hidden lg:inline`. Below `lg` that span is `display:none`, which
 *   removes it from the accessible name computation — so on every tablet and
 *   phone both selects were **completely unlabelled**. The label text is now
 *   always present, visually hidden below `lg` instead of removed.
 * - The Download action relied on `title` alone for its name; it now carries an
 *   explicit `aria-label`.
 * - **At 412 px the Close and Delete actions were off-screen entirely.** The
 *   action group was `shrink-0`, so its `flex-wrap` never engaged: it stayed at
 *   its 489 px max-content width inside a 412 px dialog panel whose
 *   `overflow-hidden` then clipped it. On a phone — which has no Escape key —
 *   there was no way at all to close the dossier. The group now shrinks and
 *   wraps.
 */
export function DossierHeader({
    activeTab,
    appData,
    companyProfile,
    currentStatus,
    onClose,
    onStatusUpdate,
    canEdit,
    teamMembers = [],
    assignedTo,
    onAssignChange,
    canDelete = false,
    onDelete,
}) {
    const rawId = useId().replace(/:/g, '');
    const statusId = `dossier-status-${rawId}`;
    const assignId = `dossier-assign-${rawId}`;

    const getTitle = () => {
        switch (activeTab) {
            case 'application': return 'Application Review';
            case 'documents': return 'Document Gallery';
            case 'dq': return 'Driver Qualification File';
            case 'activity': return 'Activity Timeline';
            case 'notes': return 'Internal Notes';
            case 'pev': return 'Previous Employment Verification';
            default: return 'Driver Dossier';
        }
    };

    const handleDownload = () => {
        if (appData) {
            generateApplicationPDF({
                applicant: appData,
                company: companyProfile,
                agreements: []
            });
        }
    };

    const statusOptions = useMemo(() => {
        const uniq = new Set(ATS_STATUS_DROPDOWN_OPTIONS);
        if (currentStatus && String(currentStatus).trim()) {
            uniq.add(currentStatus);
        }
        return [...uniq];
    }, [currentStatus]);

    const statusValue = currentStatus || 'New';

    return (
        <>
            {/* `basis-48` keeps the title a readable line: with `flex-1`'s zero
                basis it absorbed none of the available width and collapsed to
                nothing behind the action group. */}
            <div className="flex min-w-0 flex-1 basis-48 items-center gap-ds-3">
                {/* `<h3>` sits under the identity `<h2>` in the sidebar, which in
                    turn sits under the dialog's own accessible name. */}
                <h3 className="truncate text-ds-body-lg font-bold text-ds-content">{getTitle()}</h3>

                {activeTab === 'application' && (
                    <span className="shrink-0">
                        <Badge tone="neutral">
                            {appData ? `App ID: ${appData.id?.slice(0, 8)}` : 'Loading...'}
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
                                {statusOptions.map((s) => (
                                    <option key={s} value={s}>{s}</option>
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

                <IconButton
                    variant="ghost"
                    label="Download application PDF"
                    onClick={handleDownload}
                >
                    <Download size={20} aria-hidden="true" />
                </IconButton>

                {canDelete && (
                    <IconButton
                        variant="ghost"
                        label="Delete application"
                        onClick={onDelete}
                    >
                        <Trash2 size={20} aria-hidden="true" className="text-ds-status-danger-fg" />
                    </IconButton>
                )}

                <span aria-hidden="true" className="mx-ds-1 hidden h-6 w-px bg-ds-border-subtle sm:block" />

                <IconButton
                    variant="ghost"
                    label="Close driver dossier"
                    onClick={onClose}
                >
                    <X size={24} aria-hidden="true" />
                </IconButton>
            </div>
        </>
    );
}
