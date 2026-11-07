import { CONTACT_ATTEMPT_STATUSES } from '@shared/constants/atsStatus';

/**
 * Whether moving a record to a Contact Attempt stage texts the driver, as far
 * as the dossier can tell before it saves.
 *
 * The server sends the text (`functions/atsContactSms.js`, which this does not
 * change) when a record's status changes into Contact Attempt 1, 2 or 3 and:
 * - the company has a template for that stage
 *   (`companies/{id}/settings/automated_sms`, `templateContactAttempt1..3`, not blank);
 * - the record is a lead, or an application whose driver answered "Yes" to
 *   "Can we send you SMS messages?" (`sms-consent`, `shared/smsPermission.js`);
 * - the record has a usable phone (`phoneNormalized`, else `phone`: ten digits,
 *   or more with a country code, `shared/toE164Us.js`);
 * - the number is on neither the company's nor the global opt-out list;
 * - the SMS provider takes it.
 * Each outcome is written to the record's Activity ("Automated SMS").
 *
 * The dossier knows the first three; the opt-out lists (read only through a
 * callable, the global one not at all) and the provider it cannot know. So:
 * - `'texts'`: every condition the dossier can see holds; the server sends it
 *   unless the number opted out or the provider refuses.
 * - `'may'`: the templates or the record are not known (still loading, or the
 *   settings could not be read).
 * - `null`: no text goes: not a Contact Attempt stage, the stage the record is
 *   already in, no template, an application without a "Yes", or no usable phone.
 */

/** The `automated_sms` field holding each stage's template, as the server reads it. */
export const CONTACT_ATTEMPT_TEMPLATE_FIELDS = Object.freeze({
    'Contact Attempt 1': 'templateContactAttempt1',
    'Contact Attempt 2': 'templateContactAttempt2',
    'Contact Attempt 3': 'templateContactAttempt3',
});

/** Which stages have a template, from the `automated_sms` settings document's data. */
export function stagesWithTemplate(settings) {
    return Object.fromEntries(Object.entries(CONTACT_ATTEMPT_TEMPLATE_FIELDS).map(([stage, field]) => [
        stage,
        Boolean(String(settings?.[field] ?? '').trim()),
    ]));
}

/** The server's consent rule for an application: an explicit "Yes". */
function agreedToTexts(record) {
    return String(record?.['sms-consent'] || '').trim().toLowerCase() === 'yes';
}

/** The server's usable number: ten digits, or eleven and more with a country code. */
function hasUsablePhone(record) {
    const phone = record?.phoneNormalized || record?.phone || '';
    return typeof phone === 'string' && phone.replace(/\D/g, '').length >= 10;
}

/**
 * `'texts'`, `'may'` or `null` for moving `record` from `currentStatus` to
 * `stage`. `templates` is `stagesWithTemplate`'s answer, or `null` when unknown.
 */
export function contactAttemptTextFor(stage, { currentStatus, templates, record, isLead }) {
    if (!CONTACT_ATTEMPT_STATUSES.includes(stage) || stage === currentStatus) return null;
    if (!templates) return 'may';
    if (!templates[stage]) return null;
    if (!record) return 'may';
    if (!isLead && !agreedToTexts(record)) return null;
    return hasUsablePhone(record) ? 'texts' : null;
}

/** The status picker's option for a stage, with the warning when choosing it texts the driver. */
export function stageOptionLabel(label, outlook) {
    if (outlook === 'texts') return `${label} — texts the driver`;
    if (outlook === 'may') return `${label} — may text the driver`;
    return label;
}

/** What the confirmation after saving adds about the text, or nothing. */
export function savedTextNote(outlook) {
    if (outlook === 'texts') return 'A text to the driver is queued.';
    if (outlook === 'may') return 'The driver may be texted.';
    return '';
}
