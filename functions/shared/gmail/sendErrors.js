/**
 * How an email sent through a company's connected Gmail fails: a fixed code
 * and the plain message the team reads where the failure is recorded (a
 * signing request's `emailError`, a campaign recipient's log, a refusal).
 *
 * The message never carries Google's own text, a token or an address: only
 * the code goes to the log.
 */

const GMAIL_SEND_FAILURES = Object.freeze({
    // The stored grant no longer works: nothing is sent until an admin reconnects.
    GMAIL_RECONNECT_NEEDED: 'Gmail needs reconnecting: a company admin can reconnect it in Settings → Email.',
    // Gmail's own sending limits; the connection is fine.
    GMAIL_RATE_LIMITED: "Gmail's sending limit was reached; try again later.",
    // The OAuth client is missing or unreadable, or the stored token cannot be opened.
    GMAIL_NOT_CONFIGURED: 'Sending from Gmail is not set up yet.',
    // Google did not answer, or answered with a server error.
    GMAIL_UNAVAILABLE: 'Gmail could not be reached. Try again in a moment.',
    // Gmail refused this one email (a malformed or oversized message).
    GMAIL_REJECTED: 'Gmail did not accept this email.',
    // Anything else Google refused.
    GMAIL_FAILED: 'Gmail did not send this email. Try again later.',
});

class GmailSendError extends Error {
    /** @param {keyof GMAIL_SEND_FAILURES} code */
    constructor(code) {
        super(GMAIL_SEND_FAILURES[code] || GMAIL_SEND_FAILURES.GMAIL_FAILED);
        this.name = 'GmailSendError';
        this.code = Object.prototype.hasOwnProperty.call(GMAIL_SEND_FAILURES, code) ? code : 'GMAIL_FAILED';
    }
}

/** True for the two failures that stop a campaign rather than fail each recipient. */
const stopsCampaign = (error) => error?.code === 'GMAIL_RECONNECT_NEEDED' || error?.code === 'GMAIL_RATE_LIMITED';

module.exports = { GMAIL_SEND_FAILURES, GmailSendError, stopsCampaign };
