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

/** Domain status → approved tone. Feature-owned mapping; token-owned values. */
const STATUS_TONES = {
    'New': 'info',
    'In Review': 'accent',
    'Qualified': 'success',
    'Approved': 'success',
    'Hold': 'warning',
    'Needs Info': 'warning',
    'Rejected': 'danger',
    'Stale': 'neutral',
    'Background Check': 'accent',
    'Offer Sent': 'success',
};

/**
 * @param {object} props
 * @param {string} props.status One of the keys above; anything else reads as new.
 */
export function StatusBadge({ status }) {
    const tone = STATUS_TONES[status] ?? STATUS_TONES.New;
    return (
        <Badge tone={tone} icon={getStatusIcon(status)}>
            {status}
        </Badge>
    );
}

export default StatusBadge;
