import React from 'react';
import { Icon, AlertTriangle, Copy, Link2, Mail, Pencil, Trash2 } from '@design-system/icons';
import { Badge, Button, FieldMessage, IconButton, Link, ProgressBar } from '@/design-system/components';
import { formatPhoneNumber } from '@shared/utils/helpers';
import { canEmailLinkTo } from '@shared/utils/linkEmail';
import { describeApplicant } from './unfinishedRowActions';
import { describeActivity, describeSent, progressOf, removalOf } from './unfinishedWorklist';

/**
 * The cells of the unfinished-applications worklist, one component per column,
 * so `UnfinishedWorklistTable.jsx` reads as its columns. Each takes the row
 * (`entry`) and, where it needs them, the row's actions (`row`, from
 * `describeUnfinishedRow`) and the instant the list was read (`now`).
 */

/** A phone number a phone can dial: digits, with the country code a US number leaves out. */
function telHref(digits) {
    return `tel:${digits.length === 10 ? `+1${digits}` : digits}`;
}

/** The digits of the row's phone, or '' when it has none. */
const phoneDigits = (entry) => String(entry.phone || '').replace(/\D/g, '');

/**
 * Who: the name, and under it, quieter, the email that tells two drivers of
 * the same name apart, or that there is no way to reach them yet. A row with
 * no name yet says so, quietly.
 */
export function DriverCell({ entry }) {
    const { name, displayName } = describeApplicant(entry);
    return (
        <div className="flex min-w-0 flex-col items-start gap-ds-1">
            <span className={name ? 'font-semibold text-ds-content' : 'text-ds-content-muted'}>
                {displayName}
            </span>
            {/* `break-words`: an address has no space to break at, and a card or a
                column narrower than it would clip it. */}
            {entry.email && (
                <span className="max-w-full break-words text-ds-sm text-ds-content-secondary">{entry.email}</span>
            )}
            {!entry.email && !phoneDigits(entry) && (
                <span className="text-ds-sm text-ds-content-muted">No contact details yet</span>
            )}
        </div>
    );
}

/** The phone as a call: a link, so a phone dials it. A quiet dash when there is none. */
export function PhoneCell({ entry }) {
    const phone = phoneDigits(entry);
    if (!phone) return <span className="text-ds-content-muted">—</span>;
    const shown = formatPhoneNumber(phone);
    return (
        <Link
            href={telHref(phone)}
            aria-label={`Call ${describeApplicant(entry).actionName} at ${shown}`}
            className="whitespace-nowrap tabular-nums"
        >
            {shown}
        </Link>
    );
}

/** How far they got: a bar, "Step 3 of 9 · License & credentials", and "Almost done". */
export function ProgressCell({ entry, hasCustomQuestions }) {
    const progress = progressOf(entry, { hasCustomQuestions });
    const steps = `Step ${progress.step} of ${progress.total}`;
    return (
        <div className="flex min-w-0 flex-col items-start gap-ds-1">
            <ProgressBar
                className="w-full"
                value={progress.step}
                max={progress.total}
                tone={progress.almostDone ? 'success' : 'info'}
                label={`How far ${describeApplicant(entry).actionName} got`}
                valueText={progress.label ? `${steps}, ${progress.label}` : steps}
            />
            <span className="text-ds-sm text-ds-content-secondary">
                <span className="font-semibold text-ds-content">{steps}</span>
                {progress.label && ` · ${progress.label}`}
            </span>
            {progress.almostDone && <Badge tone="success">Almost done</Badge>}
        </div>
    );
}

/** The row's status, and on a carrier's row who prepared it and when its link went. */
export function StatusCell({ entry, row, now }) {
    const sent = describeSent(entry, now);
    return (
        <div className="flex min-w-0 flex-col items-start gap-ds-1">
            {/* The label carries the state; the tone only reinforces it. */}
            <Badge tone={row.statusTone}>{row.statusLabel}</Badge>
            {(row.preparedByName || sent) && (
                <span className="text-ds-xs text-ds-content-muted">
                    {[row.preparedByName && `Prepared by ${row.preparedByName}`, sent].filter(Boolean).join(' · ')}
                </span>
            )}
            {/* An orphaned lock once blocked a driver's submission unseen, so the
                count is shown where a carrier can check it. */}
            {row.lockedEmployersLabel && (
                <span className="text-ds-xs text-ds-content-muted">{row.lockedEmployersLabel}</span>
            )}
        </div>
    );
}

/** When it last moved, and when it will be removed on its own. */
export function ActivityCell({ entry, now, retentionDays }) {
    const removal = removalOf(entry, retentionDays, now);
    return (
        <div className="flex min-w-0 flex-col items-start gap-ds-1">
            <span className="text-ds-sm text-ds-content">{describeActivity(entry, now)}</span>
            {removal && (
                <span
                    className={removal.soon
                        ? 'inline-flex items-center gap-ds-1 text-ds-xs font-semibold text-ds-status-warning-fg'
                        : 'text-ds-xs text-ds-content-muted'}
                >
                    {removal.soon && <Icon icon={AlertTriangle} size="xs" />}
                    {removal.label}
                </span>
            )}
        </div>
    );
}

/**
 * What can be done with the row, every action a button of its own: there is no
 * row menu in the design system, and the roadmap keeps it that way.
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
    return (
        <div className="flex min-w-0 flex-col items-start gap-ds-2">
            <div className="flex flex-wrap gap-ds-2">
                {row.openMode && (
                    <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Open the application for ${actionName}`}
                        onClick={() => onOpen(entry, row.openMode)}
                    >
                        Open
                    </Button>
                )}
                <Button
                    variant={minted || row.linkDue ? 'primary' : 'secondary'}
                    size="sm"
                    loading={busy}
                    disabled={emailing}
                    aria-label={`${minted ? 'Copy link' : row.mintLabel} for ${actionName}`}
                    onClick={() => (minted ? onCopy(minted.url) : onCreate(entry))}
                >
                    <Icon icon={minted ? Copy : Link2} size="sm" />
                    {minted ? (copied ? 'Copied' : 'Copy link') : row.mintLabel}
                </Button>
                {canEmail && (
                    <Button
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
                    <code className="block max-w-full overflow-x-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-2 text-ds-xs text-ds-content">
                        {minted.url}
                    </code>
                    <p className="text-ds-xs text-ds-content-muted">
                        {`Works for ${minted.expiresInDays} days and is shown once.`}
                        {row.replacesLink && ' The link sent before stops working about ten minutes from now.'}
                        {row.driverOwnsAnswers
                            ? ' It asks them to confirm who they are, so it will not show you their answers.'
                            : ' It opens the application you prepared for them.'}
                    </p>
                </>
            )}
            {emailed && (
                <p className="text-ds-xs text-ds-content-secondary" role="status">
                    {`Emailed to ${emailed.to}. Works for ${emailed.expiresInDays} days.`}
                    {row.replacesLink && ' Any link sent before stops working about ten minutes from now.'}
                </p>
            )}
            {onEmail && !canEmail && (
                <p className="text-ds-xs text-ds-content-muted">
                    No email address on file, so this link can only be copied.
                </p>
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
}
