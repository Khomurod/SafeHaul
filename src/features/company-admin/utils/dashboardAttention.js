/**
 * "Needs attention" on the dashboard: what each row of `getDashboardAttention`'s
 * answer says, for `NeedsAttentionCard`. Pure: the read is
 * `useDashboardAttention`.
 *
 * The server counts; this decides the words and where each row leads. A row
 * with nothing to show is left out, and so is one the answer does not carry (a
 * feature the company turned off). A count that failed, or that is not a
 * number, is "could not be checked", never 0. A row links to the page that
 * shows its records where one exists: the PEV requests and the changes waiting
 * for a driver are only in each driver's file, so those rows say where to look.
 */

export const ATTENTION_LINKS = Object.freeze({
    documents: '/company/e-docs',
    sentDocuments: '/company/e-docs?view=sent',
    unfinished: '/company/drivers/unfinished',
    applications: '/company/drivers/applications',
});

/** The windows the server counts with, used when an answer does not name them. */
const DEFAULT_WINDOWS = Object.freeze({ awaitingDays: 7, draftDays: 5, dqDays: 30 });

const UNCHECKED = 'This could not be checked just now.';

/** "1 document has" / "3 documents have". */
const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The rows in the order they are shown. */
const ROWS = Object.freeze([
    {
        id: 'sealFailed',
        label: 'Documents whose seal failed',
        title: (n) => `${counted(n, 'signed document', 'signed documents')} could not be sealed`,
        text: 'Open the document’s details and choose Retry seal.',
        link: { href: ATTENTION_LINKS.documents, label: 'Open documents' },
    },
    {
        id: 'awaitingSignature',
        label: 'Documents waiting for a signature',
        title: (n, w) => `${counted(n, 'document has', 'documents have')} waited more than ${w.awaitingDays} days for a signature`,
        text: 'Remind the signer from the document’s details, or void it if it is no longer needed.',
        link: { href: ATTENTION_LINKS.sentDocuments, label: 'Open sent documents' },
    },
    {
        id: 'pevWaiting',
        label: 'PEV requests waiting for the employer',
        title: (n) => `${counted(n, 'PEV request is', 'PEV requests are')} waiting for the employer`,
        text: 'Reminders go out on their own. Each driver’s PEV tab shows the request, and Record attempt logs a call or a fax.',
    },
    {
        id: 'pevNoResponse',
        label: 'PEV requests marked no response',
        title: (n) => `${counted(n, 'PEV request is', 'PEV requests are')} marked no response`,
        text: 'The employer did not answer within 30 days. The record of attempts is in the driver’s DQ file, and a late answer can still be uploaded on the PEV tab.',
    },
    {
        id: 'pendingChanges',
        label: 'Changes waiting for the driver',
        title: (n) => `${counted(n, 'driver has', 'drivers have')} company changes to approve`,
        text: 'The driver approves them from the review link. The driver’s file shows each change and can email the link again.',
    },
    {
        id: 'draftsExpiring',
        label: 'Unfinished applications about to be removed',
        title: (n, w) => `${counted(n, 'unfinished application', 'unfinished applications')} will be removed within ${w.draftDays} days`,
        text: 'An unfinished application is removed 30 days after its last save. Contact the driver to finish it.',
        link: { href: ATTENTION_LINKS.unfinished, label: 'Open unfinished applications' },
    },
    {
        id: 'dqExpiring',
        label: 'Hired drivers’ DQ documents',
        title: (n, w, row) => `${row.more ? 'At least ' : ''}${counted(n, 'hired driver has', 'hired drivers have')} DQ documents that expire within ${w.dqDays} days or have expired`,
        text: 'Open a driver to see the DQ file.',
        link: { href: ATTENTION_LINKS.applications, state: { segment: 'hired' }, label: 'Open hired drivers' },
    },
]);

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A stored `'YYYY-MM-DD'` as "Nov 20, 2026", the same day wherever it is read. */
export function formatDay(day) {
    const match = DAY.exec(String(day || ''));
    if (!match) return '';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Today in the reader's own calendar, as `'YYYY-MM-DD'`. */
export function localDay(now = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function when(date, today) {
    if (date === today) return 'expires today';
    return `${date < today ? 'expired' : 'expires'} ${formatDay(date)}`;
}

function driversOf(row, today) {
    const drivers = (Array.isArray(row.drivers) ? row.drivers : [])
        .filter((driver) => driver && typeof driver.id === 'string' && DAY.test(driver.date))
        .map((driver) => ({ id: driver.id, name: String(driver.name || 'Unnamed driver'), when: when(driver.date, today) }));
    const rest = row.count - drivers.length;
    let others = null;
    if (rest > 0) others = `${row.more ? 'at least ' : ''}${rest} more`;
    else if (row.more) others = 'maybe more';
    return { drivers, others };
}

const isCount = (value) => Number.isInteger(value) && value >= 0;

/**
 * The rows to show, each `{ id, state: 'todo' | 'unknown', title, text, link? }`;
 * the DQ row also has `drivers` (`{ id, name, when }`) and `others`.
 *
 * @param {{ rows?: object, windows?: object }} answer the callable's answer
 * @param {{ today: string }} options the reader's `'YYYY-MM-DD'`, for "expired"
 */
export function attentionItems(answer, { today }) {
    const rows = answer?.rows || {};
    const windows = { ...DEFAULT_WINDOWS, ...(answer?.windows || {}) };
    const items = [];
    for (const definition of ROWS) {
        const row = rows[definition.id];
        if (!row) continue;
        const link = definition.link ? { link: definition.link } : {};
        if (row.status !== 'ok' || !isCount(row.count)) {
            items.push({ id: definition.id, state: 'unknown', title: definition.label, text: UNCHECKED, ...link });
            continue;
        }
        if (row.count === 0) continue;
        items.push({
            id: definition.id,
            state: 'todo',
            title: definition.title(row.count, windows, row),
            text: definition.text,
            ...link,
            ...(definition.id === 'dqExpiring' ? driversOf(row, today) : {}),
        });
    }
    return items;
}
