import React, { useMemo } from 'react';
import { Icon, Copy, Link2, Trash2 } from '@design-system/icons';
import { Badge, Button, DataTable, FieldMessage } from '@/design-system/components';
import { describeApplicant, describeUnfinishedRow } from './unfinishedRowActions';

/**
 * Every application that has been started and not submitted, in one list.
 *
 * A worklist, not a preview. It says who, who started it, where it has got to and
 * when it last moved — and opening a row is what asks the server for the answers,
 * which it gives only while the carrier is still the author of them. Once the
 * driver has written, the row is still here and still says how far they have got;
 * the answers are theirs.
 *
 * Replaces `PreparedApplicationsTable`, which showed only the carrier's own
 * prepared work on a second screen. The rows come from one query
 * (`listApplicationDrafts`), so a draft appears once because it is one document —
 * and `describeUnfinishedRow` decides what each row may do, which is the part that
 * must NOT be uniform. See that module for the four cases, and for what a Company
 * Admin may do besides (`isCompanyAdmin`): open every row, and delete any.
 */
export function UnfinishedWorklistTable({ rows, loading, onOpen, onDelete, isCompanyAdmin = false, link }) {
    const {
        linkFor, busyKey, copied, copyFailed, error: mintError, failedKey, onCreate, onCopy,
    } = link;
    // One object per role, so the columns below are rebuilt when it changes and
    // not on every render.
    const viewer = useMemo(() => ({ isCompanyAdmin }), [isCompanyAdmin]);

    const columns = useMemo(() => [
        {
            key: 'driver',
            header: 'Driver',
            rowHeader: true,
            priority: 'primary',
            width: 'lg',
            /*
             * Name and contact in one cell, and `break-words` is not decoration.
             * This is the column `DataTable` PINS on a phone, so it is narrower
             * there than its `lg` width suggests — and an address like
             * `dana.whitfield@example.test` has no space to break at, so without
             * this it is clipped flush against the next column and reads as
             * running into it. The old screen gave contact a column of its own,
             * which is where the room came from; folding it in here is what took
             * it away. Caught by looking at the re-recorded mobile baseline.
             */
            render: (entry) => (
                <div className="flex min-w-0 flex-col gap-ds-1">
                    <span className="font-medium text-ds-content">
                        {describeApplicant(entry).displayName}
                    </span>
                    <span className="break-words text-ds-sm text-ds-content-secondary">
                        {entry.email || entry.phone || 'No contact details yet'}
                    </span>
                    {entry.email && entry.phone && (
                        <span className="break-words text-ds-sm text-ds-content-secondary">{entry.phone}</span>
                    )}
                </div>
            ),
        },
        {
            key: 'startedBy',
            header: 'Started by',
            priority: 'secondary',
            width: 'md',
            render: (entry) => {
                const row = describeUnfinishedRow(entry, viewer);
                return (
                    <div className="flex flex-col gap-ds-1">
                        <span className="text-ds-sm text-ds-content">{row.startedByLabel}</span>
                        {row.preparedByName && (
                            <span className="text-ds-xs text-ds-content-muted">{row.preparedByName}</span>
                        )}
                        {/* Kept from `PreparedApplicationsTable`, where it earned
                            its place: an orphaned lock used to block a driver's
                            submission invisibly. In this cell rather than a column
                            of its own, because only a carrier locks employers and a
                            column would read "None" on every driver-started row. */}
                        {row.lockedEmployersLabel && (
                            <span className="text-ds-xs text-ds-content-muted">{row.lockedEmployersLabel}</span>
                        )}
                    </div>
                );
            },
        },
        {
            key: 'status',
            header: 'Status',
            priority: 'secondary',
            width: 'md',
            // The label carries the state; the tone only reinforces it. Status is
            // never colour alone.
            render: (entry) => {
                const row = describeUnfinishedRow(entry, viewer);
                return <Badge tone={row.statusTone}>{row.statusLabel}</Badge>;
            },
        },
        {
            key: 'progress',
            header: 'Reached',
            priority: 'secondary',
            width: 'md',
            render: (entry) => (
                <span className="text-ds-sm text-ds-content-secondary">
                    {describeUnfinishedRow(entry, viewer).progressLabel}
                </span>
            ),
        },
        {
            key: 'updated',
            header: 'Last activity',
            priority: 'tertiary',
            width: 'md',
            render: (entry) => (
                <span className="text-ds-sm text-ds-content-secondary">
                    {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : 'Unknown'}
                </span>
            ),
        },
        {
            key: 'actions',
            header: 'Action',
            priority: 'secondary',
            /*
             * `xl` (220px), not `lg` (176px) and not the semantic `actions` width.
             * `actions` is 88px — it is for a column of icon buttons, and these are
             * two labelled ones whose labels are the useful part ("Create a
             * replacement link" is a different thing from "Create the driver's
             * link"). At `lg` every one of them wrapped mid-phrase, which reads as
             * cramped next to the crisp `Open` beside it.
             */
            width: 'xl',
            render: (entry) => {
                const row = describeUnfinishedRow(entry, viewer);
                const { actionName } = describeApplicant(entry);
                const minted = linkFor(entry.applicantKey);
                return (
                    <div className="flex flex-col items-start gap-ds-2">
                        <div className="flex flex-wrap gap-ds-2">
                            {row.openMode && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    /* Record-specific, because a table of identical
                                       "Open" buttons tells a screen-reader user
                                       nothing about which row they are on. */
                                    aria-label={`Open the application for ${actionName}`}
                                    onClick={() => onOpen(entry, row.openMode)}
                                >
                                    Open
                                </Button>
                            )}
                            <Button
                                variant={minted ? 'primary' : 'secondary'}
                                size="sm"
                                loading={busyKey === entry.applicantKey}
                                aria-label={minted
                                    ? `Copy the link for ${actionName}`
                                    : `${row.mintLabel} for ${actionName}`}
                                onClick={() => (minted ? onCopy(minted.url) : onCreate(entry))}
                            >
                                <Icon icon={minted ? Copy : Link2} size="sm" />
                                {minted ? (copied ? 'Copied' : 'Copy link') : row.mintLabel}
                            </Button>
                            {row.canDelete && (
                                <Button
                                    /* Quiet, and last: the row's work is following a
                                       driver up, and the confirmation is where the
                                       weight of a deletion belongs. */
                                    variant="ghost"
                                    tone="danger"
                                    size="sm"
                                    aria-label={`Delete the application for ${actionName}`}
                                    onClick={() => onDelete(entry)}
                                >
                                    <Icon icon={Trash2} size="sm" /> Delete
                                </Button>
                            )}
                        </div>
                        {minted && (
                            <>
                                <code className="block max-w-full overflow-x-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-2 text-ds-xs text-ds-content">
                                    {minted.url}
                                </code>
                                <p className="text-ds-xs text-ds-content-muted">
                                    {`Works for ${minted.expiresInDays} days and is shown once.`}
                                    {row.driverOwnsAnswers
                                        ? ' It asks them to confirm who they are, so it will not show you their answers.'
                                        : ' It opens the application you prepared for them.'}
                                </p>
                            </>
                        )}
                        {copyFailed && minted && (
                            <FieldMessage tone="error">
                                Your browser would not let us copy it. Select the link above and copy it yourself.
                            </FieldMessage>
                        )}
                        {mintError && failedKey === entry.applicantKey && (
                            <FieldMessage tone="error">{mintError}</FieldMessage>
                        )}
                    </div>
                );
            },
        },
        // The pieces read above, not the `link` object — that is a fresh literal on
        // every render, which would make this `useMemo` a no-op.
    ], [linkFor, busyKey, copied, copyFailed, mintError, failedKey, onCreate, onCopy, onOpen, onDelete, viewer]);

    return (
        <DataTable
            ariaLabel="Unfinished applications"
            density="compact"
            minWidth="md"
            data={rows}
            columns={columns}
            isLoading={loading}
            loadingLabel="Loading unfinished applications"
            empty={{
                title: 'Nothing is unfinished.',
                description: 'Everyone who has started an application has either submitted it or their draft has expired. Start one yourself when you have a driver’s paperwork in hand.',
            }}
        />
    );
}

export default UnfinishedWorklistTable;
