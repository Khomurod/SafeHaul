/**
 * Campaign Constants (The "Dictionary")
 * 
 * This file serves as the single source of truth for all status strings, 
 * outcome types, and filter labels used in the Engagement Engine.
 * 
 * Both the UI dropdowns and the Firestore query logic MUST import from here
 * to prevent data "drift."
 */

export const APPLICATION_STATUSES = [
    { id: 'new', label: 'New Application', value: 'New Application' },
    { id: 'contacted', label: 'Contacted', value: 'Contacted' },
    { id: 'interview', label: 'Interview Scheduled', value: 'Interview Scheduled' },
    { id: 'offer', label: 'Offer Sent', value: 'Offer Sent' },
    { id: 'hired', label: 'Hired', value: 'Hired' },
    { id: 'rejected', label: 'Rejected', value: 'Rejected' },
    { id: 'withdrawn', label: 'Withdrawn', value: 'Withdrawn' },
    { id: 'inactive', label: 'Inactive (30d+)', value: 'Inactive' }
];

/**
 * The "Exclude Previously Messaged" window an uploaded list is counted and sent
 * with until the recruiter picks another. The server applies the same default
 * (`functions/bulkActions/controllers/session/importTargets.js`).
 */
export const UPLOAD_EXCLUDE_DEFAULT = '7';

/**
 * The most recipients one launch may message. The server refuses a larger
 * audience with the same limit (`functions/bulkActions/helpers/launchLimit.js`).
 */
export const MAX_RECIPIENTS_PER_LAUNCH = 2000;

/**
 * What became of an SMS RingCentral accepted, once the server asked it
 * (`functions/bulkActions/delivery/`). A log without a delivery state (an email,
 * or a text not checked yet) stays plain "Sent".
 */
const DELIVERY_RESULTS = {
    delivered: { label: 'Delivered', tone: 'success', note: null },
    pending: { label: 'Awaiting delivery', tone: 'info', note: 'RingCentral has not confirmed delivery yet.' },
    unconfirmed: { label: 'Delivery not confirmed', tone: 'warning', note: 'RingCentral sent it on but never confirmed delivery.' },
    unknown: { label: 'Delivery unknown', tone: 'neutral', note: 'RingCentral has no record of this text.' },
};

/**
 * What a campaign's log says of one recipient. The send loop logs `delivered`
 * when the SMS provider or the mail server took the message: that is "Sent",
 * not proof it arrived, until the delivery check records what RingCentral did.
 * Anything else is "Not sent" ("Not delivered" when RingCentral refused it
 * later), with the reason the server recorded.
 */
export function sendResultOf(log) {
    const sent = log?.status === 'delivered' || log?.isSuccess === true;
    if (!sent) {
        return {
            sent,
            label: log?.delivery?.state === 'failed' ? 'Not delivered' : 'Not sent',
            tone: 'danger',
            reason: log?.error || 'No reason was recorded',
            note: null,
        };
    }
    const delivery = DELIVERY_RESULTS[log?.delivery?.state] || { label: 'Sent', tone: 'success', note: null };
    return { sent, ...delivery, reason: null };
}

/** What the "Check delivery" button tells the recruiter about the server's answer. */
export function deliveryCheckMessage({ status, counts } = {}) {
    if (status === 'checked') {
        const parts = [`${counts?.delivered || 0} delivered`, `${counts?.failed || 0} not delivered`];
        if (counts?.pending) parts.push(`${counts.pending} still waiting`);
        if (counts?.unconfirmed) parts.push(`${counts.unconfirmed} not confirmed`);
        if (counts?.unknown) parts.push(`${counts.unknown} unknown`);
        return { ok: true, text: `Delivery checked: ${parts.join(', ')}.` };
    }
    if (status === 'nothing_to_check') return { ok: true, text: 'Every text in this campaign already has its delivery result.' };
    if (status === 'not_sms') return { ok: false, text: 'Only SMS campaigns can be checked for delivery.' };
    if (status === 'unsupported') return { ok: false, text: "This company's SMS provider does not report delivery, so it cannot be checked." };
    if (status === 'no_permission') {
        return { ok: false, text: 'RingCentral did not allow SafeHaul to read sent messages. Turn on the "Read Messages" permission for the SafeHaul app in RingCentral, then try again.' };
    }
    return { ok: false, text: 'RingCentral could not be reached to check delivery. Please try again later.' };
}

export const LAST_CALL_RESULTS = [
    { id: 'no_answer', label: 'No Answer', value: 'No Answer' },
    { id: 'left_voicemail', label: 'Left Voicemail', value: 'Left Voicemail' },
    { id: 'busy', label: 'Busy', value: 'Busy' },
    { id: 'wrong_number', label: 'Wrong Number', value: 'Wrong Number' },
    { id: 'not_interested', label: 'Not Interested', value: 'Not Interested' }
];

/**
 * Bulk session lifecycle buckets.
 *
 * Live sessions may still send messages (the worker only processes 'active',
 * but queued/scheduled/paused sessions can transition back to it), so they must
 * be CANCELLED through the supported cancelBulkSession flow — never deleted
 * outright. Terminal sessions are inert history and may be deleted explicitly.
 */
export const CANCELLABLE_SESSION_STATUSES = ['active', 'queued', 'scheduled', 'paused'];

export const isCancellableSessionStatus = (status) =>
    CANCELLABLE_SESSION_STATUSES.includes(status);

/**
 * Friendly error messages for Bulletproof Logic
 */
export const ERROR_MESSAGES = {
    ZERO_RESULTS: "No drivers match these filters. Try removing the 'Date' or 'Recruiter' filter to see more results.",
    // The server could not count: not the same as nobody matching.
    COUNT_FAILED: "The server could not count this audience. Check your connection and try again.",
    MISSING_AUTH: "Verifying your security credentials...",
    MISSING_COMPANY: "Selecting your company profile...",
    LOADING: "Scanning the network for active matches..."
};
