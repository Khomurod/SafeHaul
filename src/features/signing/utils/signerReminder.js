/**
 * Remind: sending an unsigned document's signing link to its signer again.
 *
 * The server decides (`remindSigner`, `functions/remindSigner.js`): which
 * channels, whether the driver may be texted, and at most one reminder in ten
 * minutes; it refuses with its reason. These choose where the button is offered
 * and word what the server answered. Pure: the call is `useSignerReminder`.
 */

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Whether Remind is offered: a document waiting for its signature (`sent`, its
 * link expired or not) that the server sent by email or by text. One shared by
 * a copied link has nothing to send again.
 */
export function canRemindSigner(document) {
    if (text(document?.status).toLowerCase() !== 'sent') return false;
    const byEmail = document.sendEmail !== false && text(document.recipientEmail) !== '';
    const byText = Boolean(document.sendSms) && text(document.recipientPhone).replace(/\D/g, '') !== '';
    return byEmail || byText;
}

const CHANNEL_WORDS = {
    email: 'by email',
    sms: 'by text message',
    both: 'by email and text message',
};

const FAILED_WORDS = { email: 'email', sms: 'text message' };

/**
 * What a press of Remind did, from the callable's answer: the channels that
 * went (`channels`) and those that were tried and did not (`failed`, whose
 * reason the document's details show). Never says a failed send went.
 */
export function reminderResultMessage(data) {
    const { email, sms } = data?.channels || {};
    const failed = Object.keys(FAILED_WORDS).filter((key) => data?.failed?.[key]).map((key) => FAILED_WORDS[key]);
    if (!email && !sms) {
        return {
            tone: 'danger',
            text: `The reminder could not be sent${failed.length ? ` by ${failed.join(' or ')}` : ''}. The document's details say why.`,
        };
    }
    const channel = (email && sms && 'both') || (sms && 'sms') || 'email';
    const notSent = failed.length
        ? ` The ${failed.join(' and ')} could not be sent: the document's details say why.`
        : '';
    const skipped = data?.textSkipped === 'no-sms-consent'
        ? ' Not texted: the driver did not answer Yes to text messages.'
        : '';
    return {
        tone: failed.length ? 'warning' : 'success',
        text: `Reminder sent ${CHANNEL_WORDS[channel]}. The link works for seven more days.${notSent}${skipped}`,
    };
}

/** Why a press of Remind sent nothing. A refusal carries the server's own reason. */
export function reminderErrorMessage(error) {
    const code = String(error?.code || '').replace(/^functions\//, '');
    if ((code === 'failed-precondition' || code === 'aborted' || code === 'not-found') && error?.message) {
        return error.message;
    }
    if (code === 'permission-denied') return 'You do not have access to send reminders for this company.';
    return 'Could not send the reminder. Please try again.';
}
