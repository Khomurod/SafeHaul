/**
 * How the unfinished-applications worklist reads each row: how far it got,
 * whether it is nearly done or has gone quiet, when it will be removed, and which
 * rows a search and a filter keep.
 *
 * Pure, and told the time (`now`, in milliseconds): a test states the clock, and
 * the page reads one instant per load, so every row is measured against the same
 * moment. What a row's actions are called and who may use them stays in
 * `unfinishedRowActions.js`.
 *
 * Days are calendar days in the reader's time zone, which is how "Today",
 * "3 days ago" and "Removed in 27 days" are read. The removal date follows the
 * server: a draft expires `retentionDays` after its last save (`expiresAt`, which
 * every save writes beside `updatedAt`), and Firestore deletes it some hours after
 * that, so the last day reads "Due for removal" rather than a count.
 */
import { STEP_LABELS, startedBy } from './unfinishedRowActions';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A week without a save is "no activity for a week". */
export const QUIET_AFTER_DAYS = 7;

/** From this many days left, the removal date is a warning. */
export const REMOVAL_WARNING_DAYS = 7;

/** The last two pages: everything is answered but the review and the signature. */
const ALMOST_DONE_STEPS = new Set(['review', 'consent']);

/**
 * The words in place of a page for a carrier's application the driver has not
 * taken over yet: there is no page of theirs to name.
 */
const NOT_STARTED_BY_DRIVER = Object.freeze({
    prepared: 'Prepared by us',
    sent: 'Not started by the driver yet',
});

/** The filters above the list, in the order they are offered. */
export const WORKLIST_FILTERS = Object.freeze([
    Object.freeze({ id: 'all', label: 'All' }),
    Object.freeze({ id: 'almost', label: 'Almost done' }),
    Object.freeze({ id: 'driver', label: 'Started by drivers' }),
    Object.freeze({ id: 'company', label: 'Prepared by us' }),
    Object.freeze({ id: 'quiet', label: 'No activity for a week' }),
]);

/**
 * The wizard's pages, in its order (`buildSemanticStepOrder` in `Stepper.jsx`,
 * which a test holds this to), with the company's questions when it asks any.
 */
export function wizardSteps(hasCustomQuestions) {
    return Object.keys(STEP_LABELS).filter((step) => hasCustomQuestions || step !== 'custom_questions');
}

/**
 * How far the application has got: "Step 3 of 9", the page it reached, and
 * whether only the review and the signature are left.
 *
 * A row that reached the company's questions counts them whatever the company
 * asks today. A draft saved before pages had names has only its number, which
 * is shown without a name rather than guessed at.
 *
 * @param {object} entry one row of `listApplicationDrafts`
 * @param {{ hasCustomQuestions?: boolean }} [form] whether the company asks questions of its own
 * @returns {{ step: number, total: number, label: ?string, almostDone: boolean }}
 */
export function progressOf(entry, { hasCustomQuestions = false } = {}) {
    const semantic = typeof entry?.lastSemanticStep === 'string' ? entry.lastSemanticStep : null;
    const steps = wizardSteps(hasCustomQuestions || semantic === 'custom_questions');
    const reached = semantic ? steps.indexOf(semantic) : -1;
    const numbered = Number.isInteger(entry?.lastStep) ? entry.lastStep : 0;
    const index = reached >= 0 ? reached : Math.min(Math.max(numbered, 0), steps.length - 1);
    const waiting = startedBy(entry) === 'company' ? NOT_STARTED_BY_DRIVER[entry?.status] : undefined;
    return {
        step: index + 1,
        total: steps.length,
        label: waiting || (reached >= 0 ? STEP_LABELS[semantic] : null),
        almostDone: !waiting && reached >= 0 && ALMOST_DONE_STEPS.has(semantic),
    };
}

function millisOf(iso) {
    const millis = Date.parse(iso);
    return Number.isFinite(millis) ? millis : null;
}

function startOfDay(millis) {
    const day = new Date(millis);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
}

/** Whole calendar days from one instant to a later one; rounded, for the hour a clock change takes. */
function calendarDaysBetween(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

/** True once a week has passed since the last save; a row without one is not judged. */
export function isQuiet(entry, now) {
    const at = millisOf(entry?.updatedAt);
    return at !== null && calendarDaysBetween(at, now) >= QUIET_AFTER_DAYS;
}

/** "today", "yesterday" or "3 days ago" for an instant, or null without one. */
function daysAgo(iso, now) {
    const at = millisOf(iso);
    if (at === null) return null;
    const days = calendarDaysBetween(at, now);
    if (days <= 0) return 'today';
    return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * When the row was last saved, as the worklist says it: "Today, 10:45 AM",
 * "Yesterday, 4:20 PM", then "3 days ago".
 */
export function describeActivity(entry, now) {
    const when = daysAgo(entry?.updatedAt, now);
    if (when === null) return 'Unknown';
    if (when !== 'today' && when !== 'yesterday') return when;
    const time = new Date(millisOf(entry.updatedAt)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${when === 'today' ? 'Today' : 'Yesterday'}, ${time}`;
}

/** "sent 3 days ago", for a carrier's link the driver has not taken up yet. */
export function describeSent(entry, now) {
    if (startedBy(entry) !== 'company' || entry?.status !== 'sent') return null;
    const when = daysAgo(entry?.invitedAt, now);
    return when === null ? null : `sent ${when}`;
}

/**
 * When the row will be removed on its own, or null when the list does not say.
 *
 * @returns {?{ days: number, label: string, soon: boolean }}
 */
export function removalOf(entry, retentionDays, now) {
    const at = millisOf(entry?.updatedAt);
    if (at === null || !(Number.isFinite(retentionDays) && retentionDays > 0)) return null;
    // A save stamped a little ahead of this clock was made today, not tomorrow.
    const days = retentionDays - Math.max(0, calendarDaysBetween(at, now));
    if (days <= 0) return { days: 0, label: 'Due for removal', soon: true };
    return {
        days,
        label: `Removed in ${days} ${days === 1 ? 'day' : 'days'}`,
        soon: days <= REMOVAL_WARNING_DAYS,
    };
}

const KEEPS = Object.freeze({
    all: () => true,
    almost: (entry) => progressOf(entry).almostDone,
    driver: (entry) => startedBy(entry) === 'driver',
    company: (entry) => startedBy(entry) === 'company',
    quiet: (entry, now) => isQuiet(entry, now),
});

/** A query of digits and phone punctuation may be a phone number, matched by its digits. */
const PHONE_QUERY = /^[\d\s().+-]+$/;

/** A phone's digits without the US country code: "+1 (555) 010-2233" is "5550102233". */
function nationalDigits(text) {
    const digits = String(text || '').replace(/\D/g, '');
    const countryCode = /^\+1|^1[\s().-]/.test(String(text || '').trim()) || (digits.length === 11 && digits[0] === '1');
    return countryCode ? digits.slice(1) : digits;
}

/**
 * Whether a row answers the search: every word in its name, email or phone, or,
 * for a phone number however it is typed (the country code too), its digits.
 */
export function matchesSearch(entry, query) {
    const text = String(query || '').trim().toLowerCase();
    if (!text) return true;
    const phone = nationalDigits(entry?.phone);
    const haystack = [entry?.firstName, entry?.lastName, entry?.email, phone]
        .filter(Boolean).join(' ').toLowerCase();
    if (text.split(/\s+/).every((word) => haystack.includes(word))) return true;
    const digits = PHONE_QUERY.test(text) ? nationalDigits(text) : '';
    return digits !== '' && phone.includes(digits);
}

/** How many rows each filter keeps, before any search. */
export function countByFilter(rows, now) {
    const counts = {};
    for (const { id } of WORKLIST_FILTERS) {
        counts[id] = rows.filter((entry) => KEEPS[id](entry, now)).length;
    }
    return counts;
}

/** The rows the chosen filter and the search keep, in the order the server sent them. */
export function visibleRows(rows, { filter = 'all', query = '', now }) {
    const keep = KEEPS[filter] || KEEPS.all;
    return rows.filter((entry) => keep(entry, now) && matchesSearch(entry, query));
}
