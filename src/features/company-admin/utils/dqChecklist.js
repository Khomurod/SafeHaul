import { endedBeforeLastThreeYears } from '@shared/utils/employmentApplicationHelpers';
import { dqKindOf } from './dqFileTypes';
import { calendarDay, expiryStatus, todayUtc } from './dqExpiry';

/**
 * The DQ file's checklist: what the record's DQ file holds and what it does not,
 * item by item. Pure — the record's DQ entries, the record (its employers and
 * their verifications) and a clock in, the list out. It says what is in the file;
 * it is not a compliance check and never words itself as one.
 *
 * Each item is `present`, `missing` or `expired` (`none` for the previous
 * employers when the record lists none in the three years). An optional item is
 * shown and never counted. A removed entry is not in the file. A dated item
 * (CDL, medical card, MVR) takes its newest valid-until date, so a renewal
 * outranks the card it replaced; it is expired when that date has passed, by the
 * UTC day (`dqExpiry.js`).
 *
 * The previous employers are those of the three years before the application
 * (`endedBeforeLastThreeYears`, from each employer's own end date), counted from
 * its submission, else its creation, else today. Each is answered, marked no
 * response after the attempts (the day-30 mark), waiting, or not requested, as
 * its row's verification says. Inquiries the team uploaded by hand are counted
 * but cannot be matched to an employer.
 *
 * The PSP report is optional and informational: a recruiter-attached one is
 * filed with the driver's uploads (`psp_report`), a team upload by its type.
 */

// `uploadType`: the team-upload type (`DQ_FILE_TYPES`) that files the item, which
// the DQ tab chooses when the item is pressed.
const DOCUMENT_ITEMS = Object.freeze([
    { id: 'application', label: 'Application for employment', kinds: ['application'], uploadType: 'Application for Employment' },
    { id: 'cdl', label: 'CDL', kinds: ['cdl'], dated: true, uploadType: 'CDL' },
    { id: 'medical_card', label: 'Medical card', kinds: ['medical_card'], dated: true, uploadType: 'Medical Card' },
    { id: 'mvr', label: 'MVR', kinds: ['mvr'], dated: true, uploadType: 'MVR (Annual)' },
    { id: 'pev', label: 'Previous employers, last 3 years', employers: true },
    { id: 'road_test', label: 'Road test certificate', kinds: ['road_test'], uploadType: 'Road Test Certificate' },
    { id: 'clearinghouse_full', label: 'Clearinghouse report (full)', kinds: ['clearinghouse_full'], uploadType: 'Clearinghouse Report (Full)' },
    { id: 'psp', label: 'PSP report', kinds: ['psp'], optional: true, uploadType: 'PSP Report' },
    { id: 'clearinghouse_annual', label: 'Clearinghouse report (annual)', kinds: ['clearinghouse_annual'], optional: true, uploadType: 'Clearinghouse Report (Annual)' },
    { id: 'violations_annual', label: 'Certificate of violations (annual)', kinds: ['violations_annual'], optional: true, uploadType: 'Certificate of Violations (Annual)' },
    { id: 'annual_review', label: 'Annual review', kinds: ['annual_review'], optional: true, uploadType: 'Annual Review' },
]);

const NO_RESPONSE = /^no response/i;

/** A date from an ISO string, a Firestore timestamp, `{ seconds }` or a Date; else null. */
function toDate(value) {
    if (!value) return null;
    const date = typeof value.toDate === 'function' ? value.toDate()
        : typeof value.seconds === 'number' ? new Date(value.seconds * 1000)
            : new Date(value);
    return Number.isNaN(date?.getTime?.()) ? null : date;
}

/** The day the three years are counted back from. */
function applicationDate(record, now) {
    return toDate(record?.lifecycle?.submittedAt) || toDate(record?.submittedAt) || toDate(record?.createdAt) || now;
}

function verificationState(verification) {
    const status = String(verification?.status || '').trim();
    if (status === 'Completed') return 'answered';
    if (NO_RESPONSE.test(status)) return 'no_response';
    if (!status || status === 'Not Started') return 'not_requested';
    return 'waiting';
}

function employersItem(definition, record, files, now) {
    const from = applicationDate(record, now);
    const employers = (Array.isArray(record?.employers) ? record.employers : [])
        .map((employer, index) => ({ employer, index }))
        .filter(({ employer }) => employer && typeof employer === 'object' && !endedBeforeLastThreeYears(employer, from))
        .map(({ employer, index }) => ({
            key: String(index),
            name: String(employer.companyName || employer.name || '').trim() || `Employer ${index + 1}`,
            state: verificationState(employer.verification),
        }));
    const covered = employers.every(({ state }) => state === 'answered' || state === 'no_response');
    return {
        ...definition,
        state: employers.length === 0 ? 'none' : covered ? 'present' : 'missing',
        employers,
        handInquiries: files.filter((file) => dqKindOf(file) === 'pev_inquiry').length,
        results: files.filter((file) => dqKindOf(file) === 'pev_result').length,
    };
}

function documentItem(definition, files, today) {
    const held = files.filter((file) => definition.kinds.includes(dqKindOf(file)));
    if (held.length === 0) return { ...definition, state: 'missing', count: 0, expiry: null };
    if (!definition.dated) return { ...definition, state: 'present', count: held.length, expiry: null };
    const newest = held.map((file) => calendarDay(file.expirationDate)).filter(Boolean).sort().at(-1) || null;
    const expiry = newest ? expiryStatus(newest, today) : null;
    return {
        ...definition,
        state: expiry?.state === 'expired' ? 'expired' : 'present',
        count: held.length,
        expiry,
        undated: !newest,
    };
}

/**
 * @param {{ files?: object[], record?: object|null, now?: Date }} input
 *   `files`: the record's DQ entries as read (removed ones included or not)
 * @returns {{ items: object[], missing: number, expired: number }}
 *   `missing` and `expired` count the items that are not optional
 */
export function buildDqChecklist({ files = [], record = null, now = new Date() } = {}) {
    const inFile = (Array.isArray(files) ? files : []).filter((file) => file && !file.removedAt);
    const today = todayUtc(now);
    const items = DOCUMENT_ITEMS.map(({ optional = false, ...definition }) => ({
        optional,
        ...(definition.employers
            ? employersItem(definition, record, inFile, now)
            : documentItem(definition, inFile, today)),
    }));
    const counted = items.filter((entry) => !entry.optional);
    return {
        items,
        missing: counted.filter((entry) => entry.state === 'missing').length,
        expired: counted.filter((entry) => entry.state === 'expired').length,
    };
}
