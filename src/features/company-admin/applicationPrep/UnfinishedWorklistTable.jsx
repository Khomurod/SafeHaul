import React, { useLayoutEffect, useMemo, useState } from 'react';
import { DataTable } from '@/design-system/components';
import { useMediaQuery } from '@shared/hooks/useMediaQuery';
import { describeUnfinishedRow } from './unfinishedRowActions';
import {
    ActivityCell, CardLine, CellTop, ContactLines, DriverCardTitle, DriverCell, LeadAvatar, ProgressCell, RowActions,
    StatusCell, StatusDetails,
} from './UnfinishedWorklistCells';
import { statusDetailsOf, worklistLayoutOf } from './unfinishedWorklist';

/** A draft's document id, which is what makes a row one draft. */
const rowIdOf = (entry) => entry.applicantKey;

/**
 * Cards under 768px, where the table is one card per driver (the design
 * system's cards follow the window). From 768px the shape and the widths follow
 * the room the table's box has (`worklistLayoutOf`); until it is measured, the
 * window says whether Last activity folds under the status (under 1440px).
 */
const CARDS_QUERY = '(max-width: 767px)';
const FOLD_QUERY = '(min-width: 768px) and (max-width: 1439px)';

/**
 * How wide the table's box is, in whole pixels, followed through resizes (the
 * window, a scrollbar, the sidebar); 0 until measured. The box takes its width
 * from the page, never from the table in it, so what is decided from it does
 * not feed back on itself. Returns a callback ref for the box.
 */
function useBoxWidth() {
    const [node, setNode] = useState(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        if (!node) return undefined;
        const update = () => setWidth(Math.round(node.getBoundingClientRect().width));
        update();
        if (typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, [node]);
    return [setNode, width];
}

function useWorklistLayout() {
    const cards = useMediaQuery(CARDS_QUERY);
    const foldByWindow = useMediaQuery(FOLD_QUERY);
    const [boxRef, width] = useBoxWidth();
    const layout = worklistLayoutOf(width, { foldByWindow });
    return { boxRef, ...layout, shape: cards ? 'cards' : layout.shape };
}

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
 * The driver's cell holds who they are and how to reach them (the email, the
 * phone as a call); a status keeps who prepared it beside it, and the last
 * activity keeps when the row will be removed, because each explains the other.
 * Each column's text exists once, whatever the width: a narrower page moves the
 * last activity into the status cell rather than hiding a copy of it.
 *
 * On a phone each row is a card (`mobilePresentation="cards"`, by role): the
 * initials and the name, the status in the corner, then the contact, what the
 * carrier's row adds to its status, how far they got, the last activity, and
 * the actions across the card. These are rows worked one at a time, never
 * compared, which is what the design system's rule for tables on phones asks of
 * cards.
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
        linkFor, deliveredFor, busyKey, emailKey, copied, copyFailed, error: mintError, failedKey,
        onCreate, onEmail, onCopy,
    } = link;
    const { boxRef, shape, progress: progressWidth, status: statusWidth } = useWorklistLayout();
    // One object per role, so the columns below are rebuilt when it changes and
    // not on every render.
    const viewer = useMemo(() => ({ isCompanyAdmin }), [isCompanyAdmin]);
    const linkState = useMemo(() => ({
        linkFor, deliveredFor, busyKey, emailKey, copied, copyFailed, error: mintError, failedKey,
        onCreate, onEmail, onCopy,
    }), [linkFor, deliveredFor, busyKey, emailKey, copied, copyFailed, mintError, failedKey, onCreate, onEmail, onCopy]);

    const columns = useMemo(() => {
        const rowOf = (entry) => describeUnfinishedRow(entry, viewer);
        const progress = {
            key: 'progress',
            header: 'How far they got',
            // The bar takes any width; a long page name wraps under it in `md`.
            width: progressWidth,
            render: (entry) => <ProgressCell entry={entry} hasCustomQuestions={hasCustomQuestions} />,
        };
        const actions = {
            key: 'actions',
            header: 'Actions',
            align: 'end',
            // What the others leave: the three places of the actions need 322px,
            // wider than any of the table's widths.
            width: 'auto',
            render: (entry) => (
                <RowActions
                    entry={entry}
                    row={rowOf(entry)}
                    link={linkState}
                    onOpen={onOpen}
                    onEdit={onEdit}
                    onDelete={onDelete}
                />
            ),
        };
        const activity = (entry, labelled) => (
            <ActivityCell entry={entry} now={now} retentionDays={retentionDays} labelled={labelled} />
        );

        if (shape === 'cards') {
            // A line of the card, starting where the name does.
            const line = (content) => <CardLine>{content}</CardLine>;
            return [
                {
                    key: 'driver',
                    header: 'Driver',
                    rowHeader: true,
                    render: (entry) => <DriverCardTitle entry={entry} />,
                },
                {
                    key: 'status',
                    header: 'Status',
                    mobileRole: 'status',
                    render: (entry) => <StatusCell entry={entry} row={rowOf(entry)} now={now} details={false} />,
                },
                {
                    // Straight under the name, as the name's own lines would be.
                    key: 'contact',
                    header: 'Contact',
                    mobileRole: 'line',
                    render: (entry) => <CardLine className="-mt-ds-2"><ContactLines entry={entry} /></CardLine>,
                },
                {
                    // Left out of the card when the row adds nothing to its status.
                    key: 'details',
                    header: 'Status details',
                    mobileRole: 'line',
                    render: (entry) => {
                        const lines = statusDetailsOf(entry, rowOf(entry), now);
                        return lines.length > 0 ? line(<StatusDetails lines={lines} />) : null;
                    },
                },
                { ...progress, mobileRole: 'line', render: (entry) => line(progress.render(entry)) },
                {
                    key: 'activity',
                    header: 'Last activity',
                    mobileRole: 'line',
                    render: (entry) => line(activity(entry, true)),
                },
                { ...actions, mobileRole: 'actions' },
            ];
        }

        return [
            {
                // The disc names no one a screen reader needs (`Avatar` is hidden
                // from it): the name beside it does.
                key: 'initials',
                header: '',
                headerLabel: 'Initials',
                mobileRole: 'lead',
                render: (entry) => <LeadAvatar entry={entry} />,
            },
            {
                key: 'driver',
                header: 'Driver',
                rowHeader: true,
                // `xl`: the name, and the longest email on one line.
                width: 'xl',
                render: (entry) => <CellTop><DriverCell entry={entry} /></CellTop>,
            },
            { ...progress, render: (entry) => <CellTop>{progress.render(entry)}</CellTop> },
            {
                key: 'status',
                header: 'Status',
                // At least `lg`: a `Badge` does not wrap, and "Driver is filling it
                // in" is the widest this column holds.
                width: statusWidth,
                render: (entry) => (
                    <CellTop>
                        <StatusCell
                            entry={entry}
                            row={rowOf(entry)}
                            now={now}
                            activity={shape === 'fold' ? activity(entry, true) : null}
                        />
                    </CellTop>
                ),
            },
            ...(shape === 'full' ? [{
                key: 'activity',
                header: 'Last activity',
                // `lg`: "Yesterday, 4:20 PM" on one line.
                width: 'lg',
                render: (entry) => <CellTop>{activity(entry, false)}</CellTop>,
            }] : []),
            actions,
        ];
    }, [hasCustomQuestions, linkState, now, onDelete, onEdit, onOpen, progressWidth, retentionDays, shape, statusWidth, viewer]);

    return (
        // The box the layout is measured from: as wide as the table's card.
        <div ref={boxRef}>
            <DataTable
                ariaLabel="Unfinished applications"
                density="comfortable"
                mobilePresentation="cards"
                embedded
                data={rows}
                columns={columns}
                getRowId={rowIdOf}
                isLoading={loading}
                loadingLabel="Loading unfinished applications"
                empty={empty}
            />
        </div>
    );
}

export default UnfinishedWorklistTable;
