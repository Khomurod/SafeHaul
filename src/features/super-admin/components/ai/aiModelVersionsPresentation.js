/**
 * Words and tones for the model versions table.
 *
 * The daily check speaks in its own vocabulary (`functions/ai/tasks/modelCheck.js`
 * for a lane, `modelVerification.js` for one version); this is the one place it
 * becomes what an operator reads, so the mapping is a tested table rather than
 * strings scattered through the card.
 */

const LANE_STATUS = Object.freeze({
    ok: Object.freeze({ tone: 'success', label: 'Working' }),
    failing: Object.freeze({ tone: 'danger', label: 'Failing' }),
    // Nothing passed, but nothing was disqualified either: busy, or not reached.
    unknown: Object.freeze({ tone: 'warning', label: 'Not confirmed' }),
    skipped: Object.freeze({ tone: 'neutral', label: 'Chosen by hand' }),
});

const NOT_CHECKED = Object.freeze({ tone: 'neutral', label: 'Not checked yet' });

/** A lane's verdict from the last check. */
export function describeLaneStatus(status) {
    return LANE_STATUS[status] || NOT_CHECKED;
}

const RESULT_NOTES = Object.freeze({
    misread: 'read the test licence wrong',
    gone: 'withdrawn, or not on this plan',
    refused: 'refused the request',
    busy: 'busy at the last check',
    key: 'key refused',
    quota: 'allowance used up',
    error: 'unexpected error',
});

/** Why a version in use did not pass the last check; null when it passed or was not tested. */
export function describeVersionResult(result) {
    return RESULT_NOTES[result] || null;
}

/** The service as a whole: whether the check runs for it, and what its account last answered. */
export function describeServiceState(row) {
    if (row.state === 'off') return { tone: 'neutral', label: 'Off', note: 'Not checked while it is off.' };
    if (row.state === 'not_set_up') return { tone: 'neutral', label: 'Not set up', note: 'Checked once its key is added.' };
    if (row.account === 'key') return { tone: 'danger', label: 'Key refused', note: 'Replace its key in the table above.' };
    if (row.account === 'quota') {
        return { tone: 'danger', label: 'Allowance used up', note: 'Top up the account or wait for the limit to reset.' };
    }
    return { tone: 'success', label: 'On', note: null };
}

const REASONS = Object.freeze({
    first: 'First check',
    daily: 'Daily check',
    failing: 'After a failure',
    requested: 'Check now',
});

/** Why the last check ran, in a word or two; null when unknown. */
export function describeCheckReason(reason) {
    return REASONS[reason] || null;
}

/** A stored ISO time as local text, or null. */
export function formatCheckedAt(iso) {
    const date = iso ? new Date(iso) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : null;
}
