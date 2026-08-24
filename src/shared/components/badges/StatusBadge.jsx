import React from 'react';
import { Badge } from '@design-system/components';
import { getStatusIcon } from './statusIcon';

/**
 * A recruiting status, rendered as an approved `Badge`.
 *
 * This is a **domain adapter**, which is why it lives in `shared` and not in the
 * design system: it knows what "Background Check" and "Offer Sent" mean, and the
 * design system must not. All it does is map a status string onto a `Badge`
 * tone and an icon; the appearance is entirely `Badge`'s.
 *
 * Before 2026-08-21 it was a second badge implementation — its own pill, its own
 * size scale, and forty raw palette classes across a ten-status colour table.
 * Beside a real `Badge` on the same screen it was a visibly different shape.
 *
 * ## Tones collide, and that is fine
 *
 * Ten statuses map onto six approved tones, so some share one — "In Review" and
 * "Background Check" are both `accent`, where they used to be purple and indigo.
 * That is not a loss of information, because **status is never carried by colour
 * alone**: each status has a distinct icon from `getStatusIcon` and its own text
 * label. Two statuses sharing a tint are still told apart by the two signals
 * that a colour-blind reader can actually use.
 *
 * Inventing a seventh and eighth tone to preserve the old hues would have been
 * the wrong trade — it would put domain distinctions into the token contract.
 */

/**
 * Domain status → approved tone.
 *
 * Substring matching, in the same order and the same shape as `getStatusIcon`,
 * because the product has two kinds of status string: the canonical labels
 * ("Offer Sent") and the free-form ones a recruiter list carries
 * ("New Application", "Terminated", "Declined"). An exact-key map handled the
 * first and silently defaulted the second, which is how one screen ended up
 * calling "Hired" purple while another called it green.
 *
 * Order matters: "rejected/declined" is tested before "new", so
 * "New — declined" reads as declined rather than as new.
 */
const STATUS_TONES = [
    [/reject|disqualif|declin|terminat/, 'danger'],
    [/hired|accept|approved|qualified/, 'success'],
    [/offer/, 'success'],
    [/background/, 'accent'],
    [/hold|needs info/, 'warning'],
    [/review|contacted|attempted/, 'accent'],
    [/stale|archiv/, 'neutral'],
    [/new|lead/, 'info'],
];

/** The tone a status reads as. Exported so a caller can tone a row to match. */
export function getStatusTone(status) {
    const s = (status || '').toLowerCase();
    const match = STATUS_TONES.find(([pattern]) => pattern.test(s));
    return match ? match[1] : 'neutral';
}

/**
 * @param {object} props
 * @param {string} props.status Any status string; matching is fuzzy.
 */
export function StatusBadge({ status }) {
    return (
        <Badge tone={getStatusTone(status)} icon={getStatusIcon(status)}>
            {status}
        </Badge>
    );
}

export default StatusBadge;
