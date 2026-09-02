/**
 * A driver application the CARRIER started, staged in the same draft collection.
 *
 * ## Why this is a draft and not an application
 *
 * A recruiter with a driver's paperwork in hand can fill most of an application
 * before the driver ever sees it. What they produce is not an application: nobody
 * has signed it, consented to anything, or agreed that a word of it is true. The
 * four `applications` triggers say so out loud — creating that document emails the
 * applicant to say their application was received, files a `drivers/{id}` profile
 * and moves dashboard counters. So a prepared application lives exactly where an
 * unfinished one already does (`companies/{id}/application_drafts/{applicantKey}`,
 * server-only, 30-day TTL, promoted by `submitGuestApplication`), with a few
 * fields saying who prepared it and how far it has travelled.
 *
 * ## Origin is the whole distinction
 *
 * `origin: 'company'` marks a draft the carrier wrote. Its absence means what it
 * has always meant: the driver typed it. Every rule below turns on that one field,
 * and a driver-authored draft behaves exactly as it did before this file existed.
 *
 * ## Who may read the answers, and until when
 *
 * `listApplicationDrafts` deliberately shows a contact list rather than a preview,
 * because reading a stranger's half-finished DOT questionnaire is a decision the
 * applicant has not made. That reasoning does not apply to text the company itself
 * typed — but it starts applying the moment the driver edits it. So a company may
 * read the full answers of its own prepared draft while the driver has not yet
 * written to it (`prepared`, `sent`), and from the driver's first save onwards it
 * sees the same contact summary as any other unfinished application. The
 * transition is a one-way door, set server-side in `drafts/save.js`.
 *
 * ## Locked employers are metadata, not a flag in the answers
 *
 * A carrier that imports employers from a PSP report locks their identity: the
 * driver supplies the dates and the reason for leaving, not the carrier's name or
 * USDOT number. That lock is recorded HERE, beside the form data, because driver
 * autosave round-trips `formData` verbatim — a `locked: true` living inside a row
 * would be a lock the locked party can delete. Rows still carry a decorative
 * marker so the wizard can render them; enforcement reads this list.
 */

const ORIGIN_COMPANY = 'company';

/**
 * Where a prepared application is in its life.
 *
 * `in_progress` is the pre-existing value for a driver-authored draft and keeps
 * its meaning untouched.
 */
const PREPARED_STATUSES = Object.freeze({
    /** The carrier is still filling it in. No link exists yet. */
    PREPARED: 'prepared',
    /** An invite link has been minted. The driver may not have opened it. */
    SENT: 'sent',
    /** The driver has saved at least once. The answers are theirs now. */
    DRIVER_IN_PROGRESS: 'driver_in_progress',
});

/**
 * Locking is defined once, in a module the browser has a byte-identical copy of.
 *
 * The wizard has to render exactly the rows this file records as locked, and the
 * submission has to refuse exactly the changes the wizard prevented. Two
 * definitions of "which employer is this" would be two answers to that question.
 */
const {
    MAX_LOCKED_EMPLOYERS, employerSignature, normalizeLockedEmployers,
} = require('./applicationLockedFields');

function text(value, max = 120) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** True when this stored draft is one a carrier prepared. */
function isCompanyPrepared(data) {
    return (data || {}).origin === ORIGIN_COMPANY;
}

/**
 * May the carrier read this draft's answers?
 *
 * Only its own prepared draft, and only until the driver has written to it. See
 * the header: the company's authorship is what earns the read, and the driver's
 * first save ends it.
 */
function companyMayReadAnswers(data) {
    return isCompanyPrepared(data)
        && (data || {}).status !== PREPARED_STATUSES.DRIVER_IN_PROGRESS;
}

function isoOf(value) {
    return value?.toDate?.()?.toISOString?.() || null;
}

/**
 * The contact-and-progress shape, identical in spirit to `listApplicationDrafts`.
 *
 * This is what a carrier sees once the driver has taken the application over, and
 * what it sees for every draft in a list. It carries no answers.
 */
function toCompanySummary(doc) {
    const data = doc.data() || {};
    const form = data.formData || {};
    return {
        applicantKey: doc.id,
        origin: data.origin === ORIGIN_COMPANY ? ORIGIN_COMPANY : 'driver',
        status: typeof data.status === 'string' ? data.status : 'in_progress',
        firstName: text(form.firstName, 80),
        lastName: text(form.lastName, 80),
        email: data.contactEmail || '',
        phone: data.contactPhone || '',
        lastSemanticStep: data.lastSemanticStep || null,
        preparedBy: data.preparedBy ? {
            uid: text(data.preparedBy.uid, 128),
            name: text(data.preparedBy.name, 120),
        } : null,
        invitedAt: isoOf(data.invitedAt),
        inviteExpiresAt: isoOf(data.inviteTokenExpiresAt),
        lockedEmployerCount: Array.isArray(data.lockedEmployers) ? data.lockedEmployers.length : 0,
        createdAt: isoOf(data.createdAt),
        updatedAt: isoOf(data.updatedAt),
    };
}

/**
 * The full shape, for a carrier reading back what it prepared.
 *
 * The summary plus the answers and the lock list — never the identity HMAC, the
 * token hashes, or anything else the stored document keeps to itself.
 */
function toCompanyDraft(doc) {
    const data = doc.data() || {};
    return {
        ...toCompanySummary(doc),
        formData: data.formData || {},
        lockedEmployers: Array.isArray(data.lockedEmployers) ? data.lockedEmployers : [],
        readable: true,
    };
}

module.exports = {
    MAX_LOCKED_EMPLOYERS,
    ORIGIN_COMPANY,
    PREPARED_STATUSES,
    companyMayReadAnswers,
    employerSignature,
    isCompanyPrepared,
    normalizeLockedEmployers,
    toCompanyDraft,
    toCompanySummary,
};
