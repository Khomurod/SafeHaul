import React, { useId } from 'react';
import { attemptWhen } from '../../utils/pevAttempts';

/**
 * The employer card's short record of attempts: the newest few entries of the
 * row's verification history (the server mirrors each reminder, a failed email
 * and every recorded call, fax or note there), each with its day. The whole
 * record is in "View History".
 *
 * Status is never colour alone: an attempt that did not go out says so in its
 * own words ("… could not be sent").
 */

const SHOWN = 3;

/** Newest first; an entry with no usable time keeps its place at the end. */
function newestFirst(history) {
    const timeOf = (entry) => {
        const ms = Date.parse(entry?.timestamp);
        return Number.isNaN(ms) ? -Infinity : ms;
    };
    return history
        .map((entry, order) => ({ entry, order, ms: timeOf(entry) }))
        .sort((a, b) => (b.ms - a.ms) || (b.order - a.order))
        .map(({ entry }) => entry);
}

export function PEVAttemptList({ history }) {
    const headingId = `pev-attempts-${useId().replace(/:/g, '')}`;
    const entries = Array.isArray(history) ? history.filter((entry) => entry?.action) : [];
    if (entries.length === 0) return null;
    const shown = newestFirst(entries).slice(0, SHOWN);
    const earlier = entries.length - shown.length;

    return (
        <div className="mt-ds-3">
            <p id={headingId} className="text-ds-xs font-semibold text-ds-content-secondary">Attempts</p>
            <ol aria-labelledby={headingId} className="mt-ds-1 space-y-ds-1">
                {shown.map((entry, i) => (
                    <li key={i} className="flex min-w-0 gap-ds-2 text-ds-xs text-ds-content-secondary">
                        <span className="shrink-0 tabular-nums">{attemptWhen(entry, { withTime: false })}</span>
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                            <span className={entry.ok === false ? 'font-semibold text-ds-status-danger-fg' : 'font-medium text-ds-content'}>
                                {entry.action}
                            </span>
                            {entry.note ? ` — ${entry.note}` : ''}
                        </span>
                    </li>
                ))}
            </ol>
            {earlier > 0 && (
                <p className="mt-ds-1 text-ds-xs text-ds-content-secondary">
                    {earlier} earlier {earlier === 1 ? 'entry' : 'entries'} in View History
                </p>
            )}
        </div>
    );
}
