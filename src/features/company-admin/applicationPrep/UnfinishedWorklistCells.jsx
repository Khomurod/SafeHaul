import React from 'react';
import { Icon, AlertTriangle, Copy, Link2, Mail, Pencil, Trash2 } from '@design-system/icons';
import { Avatar, Badge, Button, FieldMessage, IconButton, Link, ProgressBar } from '@/design-system/components';
import { formatPhoneNumber } from '@shared/utils/helpers';
import { initialsOf } from '@shared/utils/initials';
import { canEmailLinkTo } from '@shared/utils/linkEmail';
import { describeApplicant } from './unfinishedRowActions';
import { describeActivity, progressOf, removalOf, statusDetailsOf } from './unfinishedWorklist';

/**
 * The cells of the unfinished-applications worklist, one component per column,
 * so `UnfinishedWorklistTable.jsx` reads as its columns. Each takes the row
 * (`entry`) and, where it needs them, the row's actions (`row`, from
 * `describeUnfinishedRow`) and the instant the list was read (`now`).
 *
 * The `max-md:` classes are the phone card's (the table is cards under 768px):
 * there the contact, step and activity lines read at body size.
 */

/** A phone number a phone can dial: digits, with the country code a US number leaves out. */
function telHref(digits) {
    return `tel:${digits.length === 10 ? `+1${digits}` : digits}`;
}

/** The digits of the row's phone, or '' when it has none. */
const phoneDigits = (entry) => String(entry.phone || '').replace(/\D/g, '');

/**
 * On a phone's card the lines under the name start where the name does, after
 * the initials, as the title's own lines would: the width of the disc and the
 * gap beside it.
 */
const CARD_TEXT_INSET = 'max-md:ps-[calc(var(--ds-avatar-size-sm)+var(--ds-space-3))]';

/** A line of a phone's card, starting where the name does (`CARD_TEXT_INSET`). */
export function CardLine({ className = '', children }) {
    return <div className={`${CARD_TEXT_INSET} ${className}`.trim()}>{children}</div>;
}

/** The driver's initials, or an empty ring holding the place of a driver with no name yet. */
export function DriverAvatar({ entry }) {
    const initials = initialsOf(describeApplicant(entry).name);
    return initials ? <Avatar size="sm" tone="brand">{initials}</Avatar> : <Avatar size="sm" tone="placeholder" />;
}

/**
 * A table cell's content from 768px, held at the top of its row: the name,
 * "Step N of 9", the status and the last activity start on one line, level
 * with the first row of buttons, and a taller cell only grows down. The
 * content fills its cell (`h-full`), so the cell's centring has nothing left to
 * move; the 8px above it sets the first line beside the buttons' middle. A
 * stopgap until `DataTable` can align its rows to the top itself (requested
 * from the design system); where a browser cannot fill the cell, the row is
 * centred as before.
 */
export function CellTop({ children }) {
    return <div className="h-full pt-ds-2">{children}</div>;
}

/**
 * The initials in their own column, beside the driver's cell: as high as the
 * name and its contact lines, their middle level with that block's (two lines
 * or three), as if they sat in one cell.
 */
export function LeadAvatar({ entry }) {
    const contactLines = (entry.email ? 1 : 0) + (phoneDigits(entry) ? 1 : 0);
    return (
        <CellTop>
            <div className={contactLines === 2 ? 'mt-ds-3' : 'mt-ds-1'}>
                <DriverAvatar entry={entry} />
            </div>
        </CellTop>
    );
}

/**
 * The email, which may break only after its "@": an address has no space to
 * break at, and broken anywhere else it reads as two addresses.
 */
function EmailText({ email }) {
    const at = email.indexOf('@');
    if (at < 0) return email;
    return <>{email.slice(0, at + 1)}<wbr />{email.slice(at + 1)}</>;
}

/**
 * How to reach the driver: the email, then the phone as a call (a link, so a
 * phone dials it), or that there is no way to reach them yet.
 */
export function ContactLines({ entry }) {
    const phone = phoneDigits(entry);
    const shown = phone ? formatPhoneNumber(phone) : '';
    return (
        <>
            {/* `break-words` only for an address too long for the column even at its "@". */}
            {entry.email && (
                <span className="block max-w-full break-words text-ds-sm text-ds-content-secondary max-md:text-ds-body">
                    <EmailText email={entry.email} />
                </span>
            )}
            {phone && (
                <Link
                    href={telHref(phone)}
                    aria-label={`Call ${describeApplicant(entry).actionName} at ${shown}`}
                    className="whitespace-nowrap text-ds-body font-medium tabular-nums"
                >
                    {shown}
                </Link>
            )}
            {!entry.email && !phone && (
                <span className="block text-ds-sm text-ds-content-muted max-md:text-ds-body">No contact details yet</span>
            )}
        </>
    );
}

/**
 * Who: the name, and under it, quieter, the email that tells two drivers of
 * the same name apart and the phone to call them on (`contact`). A row with no
 * name yet says so, quietly. A phone's card shows the name alone: its contact
 * is a line of its own (`ContactLines`), under the name and the status.
 */
export function DriverCell({ entry, contact = true }) {
    const { name, displayName } = describeApplicant(entry);
    return (
        <div className="flex min-w-0 flex-col items-start">
            <span className={name ? 'font-semibold text-ds-content' : 'text-ds-content-muted'}>
                {displayName}
            </span>
            {contact && <ContactLines entry={entry} />}
        </div>
    );
}

/** The card's title: the initials and the name beside them. */
export function DriverCardTitle({ entry }) {
    return (
        <div className="flex min-w-0 items-center gap-ds-3">
            <DriverAvatar entry={entry} />
            <DriverCell entry={entry} contact={false} />
        </div>
    );
}

/** How far they got: "Step 3 of 9", a bar, then the page it reached and "Almost done". */
export function ProgressCell({ entry, hasCustomQuestions }) {
    const progress = progressOf(entry, { hasCustomQuestions });
    const steps = `Step ${progress.step} of ${progress.total}`;
    return (
        <div className="flex min-w-0 flex-col gap-ds-2">
            <span className="font-semibold text-ds-content">{steps}</span>
            <ProgressBar
                className="w-full md:max-w-[13.75rem]"
                value={progress.step}
                max={progress.total}
                tone={progress.almostDone ? 'success' : 'info'}
                label={`How far ${describeApplicant(entry).actionName} got`}
                valueText={progress.label ? `${steps}, ${progress.label}` : steps}
            />
            {(progress.label || progress.almostDone) && (
                <span className="flex flex-wrap items-center gap-x-ds-2 gap-y-ds-1 text-ds-xs text-ds-content-secondary max-md:text-ds-body">
                    {progress.label && <span>{progress.label}</span>}
                    {progress.almostDone && <Badge tone="success">Almost done</Badge>}
                </span>
            )}
        </div>
    );
}

/** The status details as quiet lines, or nothing when there are none. */
export function StatusDetails({ lines }) {
    if (lines.length === 0) return null;
    return (
        <span className="flex flex-col text-ds-xs text-ds-content-muted">
            {lines.map((line) => <span key={line}>{line}</span>)}
        </span>
    );
}

/**
 * The row's status, its details under it (`details`, left out on a phone's
 * card, where they are a line of their own), and, on a laptop or a tablet,
 * where there is no room for a column of its own, its last activity
 * (`activity`).
 */
export function StatusCell({ entry, row, now, details = true, activity = null }) {
    return (
        <div className="flex min-w-0 flex-col items-start gap-ds-1">
            {/* The label carries the state; the tone only reinforces it. */}
            <Badge tone={row.statusTone}>{row.statusLabel}</Badge>
            {details && <StatusDetails lines={statusDetailsOf(entry, row, now)} />}
            {activity && <div className="mt-ds-1">{activity}</div>}
        </div>
    );
}

/**
 * When it last moved, and when it will be removed on its own. `labelled` names
 * it "Last activity" first, where it shares a cell (the status, or a phone's
 * card) rather than sitting under its column's header. The time comes first and
 * inline, so a label before it reads as one line with it.
 */
export function ActivityCell({ entry, now, retentionDays, labelled = false }) {
    const removal = removalOf(entry, retentionDays, now);
    return (
        <>
            {labelled && <span className="block text-ds-xs text-ds-content-muted max-md:inline max-md:text-ds-body">Last activity </span>}
            <span className="text-ds-body text-ds-content">{describeActivity(entry, now)}</span>
            {removal && (
                <span
                    className={removal.soon
                        ? 'flex items-center gap-ds-1 text-ds-xs font-semibold text-ds-status-warning-fg max-md:text-ds-body'
                        : 'block text-ds-xs text-ds-content-muted max-md:text-ds-body'}
                >
                    {removal.soon && <Icon icon={AlertTriangle} size="xs" />}
                    {removal.label}
                </span>
            )}
        </>
    );
}

/** A message under the buttons, as wide as they are and no wider. */
const NOTE = 'w-0 min-w-full';

/**
 * What can be done with the row, every action a button of its own: there is no
 * row menu in the design system, and the roadmap keeps it that way.
 *
 * Each action has a place of its own in a fixed grid, and keeps it whether or
 * not the row offers the others, so nothing moves from row to row: Open, Copy
 * link (or New link), Email link on the first line; Edit answers under the
 * first two and Delete at the end of the second. A recruiter's row leaves the
 * places of the Company Admin's actions empty.
 *
 * Each name says whose application it acts on, because a list of identical
 * "Open" buttons tells a screen-reader user nothing about the row.
 *
 * "Email to driver" has the server email the link to the row's own address; the
 * row then says where, masked, and holds no link. A row with no usable address
 * says why instead, and keeps Copy link.
 */
export function RowActions({ entry, row, link, onOpen, onEdit, onDelete }) {
    const {
        linkFor, deliveredFor, busyKey, emailKey, copied, copyFailed, error: mintError, failedKey,
        onCreate, onEmail, onCopy,
    } = link;
    const { actionName } = describeApplicant(entry);
    const minted = linkFor(entry.applicantKey);
    const emailed = deliveredFor?.(entry.applicantKey) ?? null;
    const canEmail = Boolean(onEmail) && canEmailLinkTo(entry.email);
    const busy = busyKey === entry.applicantKey;
    const emailing = emailKey === entry.applicantKey;
    // "Copy link" copies a link; "New link" makes one.
    const copies = minted || row.mintLabel === 'Copy link';
    return (
        // From 768px the actions fill their cell's height, so their first line
        // stays at the top of the row (`CellTop`).
        <div className={`ms-auto flex w-fit max-w-full flex-col gap-ds-2 text-start md:h-full max-md:w-full ${CARD_TEXT_INSET} max-[400px]:ps-0`}>
            {/* On a phone the shares never go below a label's own width, so
                "Copy link" stays on one line in its button. */}
            <div className="grid grid-cols-[3.875rem_6.75rem_7rem] gap-ds-1 max-md:grid-cols-[minmax(min-content,64fr)_minmax(min-content,108fr)_minmax(min-content,112fr)] max-md:gap-ds-2 max-md:whitespace-nowrap max-[400px]:gap-ds-1">
                {row.openMode && (
                    <Button
                        className="col-start-1 row-start-1"
                        variant="secondary"
                        size="sm"
                        aria-label={`Open the application for ${actionName}`}
                        onClick={() => onOpen(entry, row.openMode)}
                    >
                        Open
                    </Button>
                )}
                <Button
                    className="col-start-2 row-start-1"
                    variant={minted || row.linkDue ? 'primary' : 'secondary'}
                    size="sm"
                    loading={busy}
                    disabled={emailing}
                    aria-label={`${minted ? 'Copy link' : row.mintLabel} for ${actionName}`}
                    onClick={() => (minted ? onCopy(minted.url) : onCreate(entry))}
                >
                    <Icon icon={copies ? Copy : Link2} size="sm" />
                    {minted ? (copied ? 'Copied' : 'Copy link') : row.mintLabel}
                </Button>
                {canEmail && (
                    <Button
                        className="col-start-3 row-start-1"
                        variant="secondary"
                        size="sm"
                        loading={emailing}
                        disabled={busy}
                        aria-label={`Email link to ${actionName}`}
                        onClick={() => onEmail(entry)}
                    >
                        <Icon icon={Mail} size="sm" /> Email link
                    </Button>
                )}
                {row.canEditAnswers && (
                    <Button
                        className="col-span-2 col-start-1 row-start-2"
                        variant="secondary"
                        size="sm"
                        aria-label={`Edit answers for ${actionName}`}
                        onClick={() => onEdit(entry)}
                    >
                        <Icon icon={Pencil} size="sm" /> Edit answers
                    </Button>
                )}
                {row.canDelete && (
                    // The one look of a row delete, and last: quiet, because the
                    // dialog it opens is where a deletion's weight belongs.
                    <IconButton
                        className="col-start-3 row-start-2 justify-self-end"
                        variant="ghost"
                        size="sm"
                        label={`Delete everything for ${actionName}`}
                        onClick={() => onDelete(entry)}
                    >
                        <Icon icon={Trash2} className="text-ds-status-danger-fg" />
                    </IconButton>
                )}
            </div>
            {minted && (
                <>
                    <code className={`${NOTE} block overflow-x-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-2 text-ds-xs text-ds-content`}>
                        {minted.url}
                    </code>
                    <p className={`${NOTE} text-ds-xs text-ds-content-muted`}>
                        {`Works for ${minted.expiresInDays} days and is shown once.`}
                        {row.replacesLink && ' The link sent before stops working about ten minutes from now.'}
                        {row.driverOwnsAnswers
                            ? ' It asks them to confirm who they are, so it will not show you their answers.'
                            : ' It opens the application you prepared for them.'}
                    </p>
                </>
            )}
            {emailed && (
                <p className={`${NOTE} text-ds-xs text-ds-content-secondary`} role="status">
                    {`Emailed to ${emailed.to}. Works for ${emailed.expiresInDays} days.`}
                    {row.replacesLink && ' Any link sent before stops working about ten minutes from now.'}
                </p>
            )}
            {onEmail && !canEmail && (
                <p className={`${NOTE} text-ds-xs text-ds-content-muted`}>
                    No email address on file, so this link can only be copied.
                </p>
            )}
            {copyFailed && minted && (
                <div className={NOTE}>
                    <FieldMessage tone="error">
                        Your browser would not let us copy it. Select the link above and copy it yourself.
                    </FieldMessage>
                </div>
            )}
            {mintError && failedKey === entry.applicantKey && (
                <div className={NOTE}>
                    <FieldMessage tone="error">{mintError}</FieldMessage>
                </div>
            )}
        </div>
    );
}
