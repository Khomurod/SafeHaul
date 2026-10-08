/**
 * What one unfinished application is, and what a recruiter may do with it.
 *
 * ## Why this is a module and not inline in the table
 *
 * `Started (unfinished)` and `Start an application` became one workspace on
 * 2026-09-10, and the whole difficulty of merging them is that a row must NOT
 * behave the same everywhere. Four cases share one table:
 *
 * | Started by | Status                | A recruiter may…                        |
 * |------------|-----------------------|-----------------------------------------|
 * | Company    | `prepared`            | open and keep editing; mint the first link |
 * | Company    | `sent`                | open and keep editing; mint a replacement |
 * | Company    | `driver_in_progress`  | open (progress only — the server withholds the answers); mint a continuation link |
 * | Driver     | `in_progress`         | mint a continuation link. Nothing else.  |
 *
 * A **Company Admin** may do all of that, and since 2026-10-06 also open every
 * row the driver has written to — read-only, with the answers — and delete any
 * row. That is the owner's decision, and the server holds it: `getApplicationDraft`
 * and `purgeApplicationDraft` answer only the strict admin check.
 *
 * Putting that in a pure function means the distinction is stated once, tested
 * directly, and cannot drift between the desktop table and anything else that
 * later needs it. A `render` callback three levels inside a column definition is
 * where this kind of rule goes to die.
 *
 * ## `openMode` mirrors a server rule rather than inventing a client one
 *
 * `prepare` opens the carrier's own workspace through `getCompanyPreparedDraft`,
 * which refuses any draft the carrier did not author with a flat `not-found` and
 * gates the answers of its own by `companyMayReadAnswers` on every load. `review`
 * opens the driver's answers through `getApplicationDraft`, which refuses anyone
 * but a Company Admin. So *Open* is offered exactly where the server can answer
 * it, and what comes back is still the server's call.
 *
 * Nothing here decides privacy. The list this reads carries no answers at all
 * (`toCompanySummary`); who may read them is decided server-side.
 */

const ORIGIN_COMPANY = 'company';

/** The driver's own status value, and the only one a driver-started draft has. */
const DRIVER_IN_PROGRESS = 'driver_in_progress';

/** The wizard's own step names, in order, so "how far did they get" reads plainly. */
export const STEP_LABELS = Object.freeze({
    contact: 'Personal information',
    qualifications: 'Qualifications',
    license: 'License & credentials',
    violations: 'Driving record',
    accidents: 'Accident history',
    employment: 'Employment history',
    general: 'General questions',
    custom_questions: 'Company questions',
    review: 'Review',
    consent: 'Agreements & signature',
});

/**
 * How far this application has got, in the wizard's words.
 *
 * The numeric step is the fallback rather than the answer, because a draft saved
 * before `lastSemanticStep` existed has only that — and "Step 3" is still useful
 * where a blank cell is not.
 */
export function describeProgress(entry) {
    const semantic = entry?.lastSemanticStep;
    if (semantic && STEP_LABELS[semantic]) return STEP_LABELS[semantic];
    return `Step ${(Number.isInteger(entry?.lastStep) ? entry.lastStep : 0) + 1}`;
}

/** Who put this application into the workspace. */
export function startedBy(entry) {
    return entry?.origin === ORIGIN_COMPANY ? ORIGIN_COMPANY : 'driver';
}

/**
 * The row, as the recruiter or Company Admin reads and acts on it.
 *
 * @param {object} entry one row of `listApplicationDrafts`
 * @param {{ isCompanyAdmin?: boolean }} [viewer] who is looking; a recruiter
 *   unless said otherwise, which is the narrower reading
 * @returns {{
 *   origin: string, startedByLabel: string, preparedByName: ?string,
 *   statusLabel: string, statusTone: string, progressLabel: string,
 *   openMode: ?('prepare'|'review'), canDelete: boolean,
 *   driverOwnsAnswers: boolean, mintLabel: string, lockedEmployersLabel: ?string,
 * }}
 */
export function describeUnfinishedRow(entry, { isCompanyAdmin = false } = {}) {
    // Only an explicit `true` widens a row; anything else is a recruiter.
    const admin = isCompanyAdmin === true;
    const origin = startedBy(entry);
    const fromCompany = origin === ORIGIN_COMPANY;
    const status = typeof entry?.status === 'string' ? entry.status : 'in_progress';
    // The one-way door: from the driver's first save the answers are theirs,
    // whoever typed the first draft of them.
    const driverOwnsAnswers = !fromCompany || status === DRIVER_IN_PROGRESS;

    let statusLabel = 'Unfinished';
    let statusTone = 'neutral';
    let mintLabel = 'Create a continuation link';
    if (fromCompany && status === 'prepared') {
        statusLabel = 'Not sent yet';
        mintLabel = "Create the driver's link";
    } else if (fromCompany && status === 'sent') {
        statusLabel = 'Link sent';
        statusTone = 'info';
        mintLabel = 'Create a replacement link';
    } else if (status === DRIVER_IN_PROGRESS) {
        statusLabel = 'Driver is filling it in';
        statusTone = 'success';
    }

    /**
     * How many employers this application holds the driver to.
     *
     * `listCompanyPreparedApplications` returned `lockedEmployerCount` for a long
     * time with nothing rendering it, which is how an orphaned lock — one whose row
     * the carrier had deleted — stayed invisible while it blocked the driver's
     * submission. The count cannot be orphaned any more
     * (`reconcileLockedEmployers`), and showing it is what makes the number
     * checkable rather than a thing to trust. Only a carrier locks employers, so
     * this is silent on a driver-started row rather than reading "None" on every
     * one of them.
     */
    const lockedCount = Number.isInteger(entry?.lockedEmployerCount) ? entry.lockedEmployerCount : 0;
    const lockedEmployersLabel = fromCompany && lockedCount > 0
        ? `${lockedCount === 1 ? '1 employer' : `${lockedCount} employers`} locked`
        : null;

    return {
        origin,
        startedByLabel: fromCompany ? 'Company' : 'Driver',
        preparedByName: fromCompany ? (entry?.preparedBy?.name || null) : null,
        lockedEmployersLabel,
        statusLabel,
        statusTone,
        progressLabel: describeProgress(entry),
        openMode: openModeFor({ fromCompany, driverOwnsAnswers, admin }),
        canDelete: admin,
        driverOwnsAnswers,
        mintLabel,
    };
}

/**
 * Where *Open* takes this viewer, or null when it is not offered.
 *
 * A Company Admin reads whatever the driver has written (`review`), and edits
 * what the carrier still authors (`prepare`), as a recruiter does. A recruiter
 * opens only the carrier's own work — a document `getCompanyPreparedDraft` will
 * answer for at all — including after the driver takes it over, where the
 * workspace shows progress without the answers.
 */
function openModeFor({ fromCompany, driverOwnsAnswers, admin }) {
    if (admin && driverOwnsAnswers) return 'review';
    return fromCompany ? 'prepare' : null;
}

/** What to call this applicant when there is a name, a contact, or neither. */
export function describeApplicant(entry) {
    const name = [entry?.firstName, entry?.lastName].filter(Boolean).join(' ');
    return {
        name,
        displayName: name || 'Name not entered yet',
        // For an accessible, record-specific action label. Never "this row".
        actionName: name || entry?.email || entry?.phone || 'this applicant',
    };
}

export default describeUnfinishedRow;
