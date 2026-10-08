import React, { useMemo } from 'react';
import { DataTable } from '@/design-system/components';
import { describeUnfinishedRow } from './unfinishedRowActions';
import { ActivityCell, DriverCell, ProgressCell, RowActions, StatusCell } from './UnfinishedWorklistCells';

/** A draft's document id, which is what makes a row one draft. */
const rowIdOf = (entry) => entry.applicantKey;

/**
 * Every application that has been started and not submitted, in one list.
 *
 * A worklist, not a preview. It says who, how far they got, where it stands and
 * when it last moved and will be removed — and opening a row is what asks the
 * server for the answers, which it gives only while the carrier is still the
 * author of them, or to a Company Admin. Once the driver has written, the row is
 * still here and still says how far they have got; the answers are theirs.
 *
 * The rows come from one query (`listApplicationDrafts`), so a draft appears once
 * because it is one document — and `describeUnfinishedRow` decides what each row
 * may do, which is the part that must NOT be uniform. See that module for the
 * four cases, and for what a Company Admin may do besides (`isCompanyAdmin`).
 *
 * On a phone each row is a card (`mobilePresentation="cards"`): its driver is the
 * title, every other cell sits under its column's name, and the actions take the
 * card's width. These are rows worked one at a time, never compared, which is
 * what the design system's rule for tables on phones asks of cards.
 */
export function UnfinishedWorklistTable({
    rows,
    loading,
    onOpen,
    onEdit,
    onDelete,
    isCompanyAdmin = false,
    link,
    now,
    retentionDays,
    hasCustomQuestions = false,
    empty,
}) {
    const {
        linkFor, busyKey, copied, copyFailed, error: mintError, failedKey, onCreate, onCopy,
    } = link;
    // One object per role, so the columns below are rebuilt when it changes and
    // not on every render.
    const viewer = useMemo(() => ({ isCompanyAdmin }), [isCompanyAdmin]);
    const linkState = useMemo(() => ({
        linkFor, busyKey, copied, copyFailed, error: mintError, failedKey, onCreate, onCopy,
    }), [linkFor, busyKey, copied, copyFailed, mintError, failedKey, onCreate, onCopy]);

    const columns = useMemo(() => [
        {
            key: 'driver',
            header: 'Driver',
            rowHeader: true,
            priority: 'primary',
            /*
             * A width of its own, not `auto`: every other column has one, and an
             * `auto` column gets what is left, which on a tablet, where the table
             * scrolls at its narrowest, was nothing at all. With every column
             * sized the table never goes narrower than their sum (1012px) and
             * shares out any room above it.
             */
            width: 'xl',
            render: (entry) => <DriverCell entry={entry} />,
        },
        {
            key: 'progress',
            header: 'How far they got',
            width: 'xl',
            render: (entry) => <ProgressCell entry={entry} hasCustomQuestions={hasCustomQuestions} />,
        },
        {
            key: 'status',
            header: 'Status',
            // `lg`: a `Badge` does not wrap, and "Driver is filling it in" is the
            // widest this column holds.
            width: 'lg',
            render: (entry) => <StatusCell entry={entry} row={describeUnfinishedRow(entry, viewer)} now={now} />,
        },
        {
            key: 'activity',
            header: 'Last activity',
            width: 'lg',
            render: (entry) => <ActivityCell entry={entry} now={now} retentionDays={retentionDays} />,
        },
        {
            key: 'actions',
            headerLabel: 'Actions',
            // No label on a card: its buttons are the card's last line, full width.
            mobileLabel: '',
            priority: 'actions',
            width: 'xl',
            render: (entry) => (
                <RowActions
                    entry={entry}
                    row={describeUnfinishedRow(entry, viewer)}
                    link={linkState}
                    onOpen={onOpen}
                    onEdit={onEdit}
                    onDelete={onDelete}
                />
            ),
        },
    ], [hasCustomQuestions, linkState, now, onDelete, onEdit, onOpen, retentionDays, viewer]);

    return (
        <DataTable
            ariaLabel="Unfinished applications"
            density="compact"
            minWidth="standard"
            mobilePresentation="cards"
            embedded
            data={rows}
            columns={columns}
            getRowId={rowIdOf}
            isLoading={loading}
            loadingLabel="Loading unfinished applications"
            empty={empty}
        />
    );
}

export default UnfinishedWorklistTable;
