/**
 * What the Employment page still needs before Continue, row by row, in words
 * an applicant can act on: "Employer 1: start date, reason for leaving, 2
 * questions."
 *
 * The page used to say this with `form.reportValidity()`, which shows the
 * browser's own bubble on the first empty field for a couple of seconds, and
 * with one toast per email or contact problem. A driver who picked a company
 * from SAFER saw the name and address fill in, pressed Continue, and got a
 * bubble on a field further down that was gone before it was found. So the
 * page lists everything at once, at the top, and marks each field.
 *
 * Each row's fields are listed in the order the row shows them, with the id
 * of the control that takes focus. `Step6_Employment.issues.test.jsx` holds
 * this list to the step's `required` controls, so the two cannot drift: the
 * `required` attributes stay, for the browser and the browser tests.
 */

import { MILITARY_BRANCH_OPTIONS } from '@/config/form-options';
import { isLockedEmployerRow } from '@/config/applicationLockedFields';
import { domIdSegment } from '@shared/utils/domId';
import { employerRowHasVerifierContact, employerRowMissingAnswerKeys } from '@shared/utils/employmentApplicationHelpers';
import { isWellFormedEmail } from '@shared/utils/validation';

export const REQUIRED_MESSAGE = 'Required.';
const EMAIL_MESSAGE = 'Enter a valid email, or leave it blank.';
const CONTACT_MESSAGE = 'Add a phone (10 digits) or an email for someone who can verify this job.';

const filled = (value) => String(value ?? '').trim() !== '';
const monthYear = (prefix) => (index) => `${prefix}-${index}-month`;

const EMPLOYER_IDENTITY = [
    { key: 'companyName', word: 'company name', focus: (i) => `emp-name-${i}` },
    { key: 'address', word: 'street address', focus: (i) => `emp-street-${i}` },
    { key: 'city', word: 'city', focus: (i) => `emp-city-${i}` },
    { key: 'state', word: 'state or province', focus: (i) => `emp-state-${i}` },
];
const EMPLOYER_DATES = [
    { key: 'startDate', word: 'start date', focus: monthYear('emp-start') },
    { key: 'endDate', word: 'end date', focus: monthYear('emp-end') },
];
const EMPLOYER_ANSWERS = {
    reasonForLeaving: { word: 'reason for leaving', focus: (i) => `emp-reason-${i}` },
    subjectToFmcsrs: { question: true, focus: (i) => `emp-fmcsrs-${i}-yes` },
    subjectToDotTesting: { question: true, focus: (i) => `emp-dot-tested-${i}-yes` },
};

/** The other three lists: every field `required`, whatever the company's settings. */
const ROW_LISTS = [
    {
        listKey: 'unemployment',
        title: (n) => `Employment gap ${n}`,
        fields: [
            { key: 'startDate', word: 'gap start', focus: monthYear('unemp-start') },
            { key: 'endDate', word: 'gap end', focus: monthYear('unemp-end') },
        ],
    },
    {
        listKey: 'schools',
        title: (n) => `Driving school ${n}`,
        fields: [
            { key: 'name', word: 'school name', focus: (i) => `school-name-${i}` },
            { key: 'startDate', word: 'start date', focus: monthYear('school-start') },
            { key: 'endDate', word: 'end date', focus: monthYear('school-end') },
        ],
    },
    {
        listKey: 'military',
        title: (n) => `Military service ${n}`,
        fields: [
            { key: 'branch', word: 'branch', focus: (i) => `mil-branch-${i}-${domIdSegment(MILITARY_BRANCH_OPTIONS[0].value)}` },
            { key: 'start', word: 'service start', focus: monthYear('mil-start') },
            { key: 'end', word: 'service end', focus: monthYear('mil-end') },
            { key: 'rank', word: 'rank of discharge', focus: (i) => `mil-rank-${i}` },
        ],
    },
];

const rowsOf = (formData, listKey) => (Array.isArray(formData?.[listKey]) ? formData[listKey] : []);

/**
 * Which row an item is about, by the `id` `DynamicRow` gives each row it adds,
 * else by position. A position moves when a row above is removed, and the page
 * keeps the rows a refused Continue listed by this key.
 */
const rowKeyOf = (listKey, row, index) => (
    row?.id !== undefined && row?.id !== null && row?.id !== '' ? `${listKey}-id-${row.id}` : `${listKey}-${index}`
);

/** One row's list item, or null when the row is complete. */
function rowIssue(listKey, index, title, missing, row) {
    if (missing.length === 0) return null;
    const questions = missing.filter((entry) => entry.question).length;
    const words = missing.filter((entry) => !entry.question).map((entry) => entry.word);
    if (questions > 0) words.push(questions === 1 ? '1 question' : `${questions} questions`);
    return {
        key: rowKeyOf(listKey, row, index),
        code: 'employment-missing',
        message: `${title}: ${words.join(', ')}.`,
        focusId: missing[0].focus,
        fields: Object.fromEntries(missing.map((entry) => [entry.key, entry.message])),
    };
}

function employerIssue(row, index, { required, lockedEmployers, today }) {
    const missing = [];
    const add = (key, field, message) => missing.push({ key, message, focus: field.focus(index), word: field.word, question: field.question });
    if (required) {
        for (const field of EMPLOYER_IDENTITY) {
            // A row the carrier locked shows its name as settled text, not a field.
            if (field.key === 'companyName' && isLockedEmployerRow(row, lockedEmployers)) continue;
            if (!filled(row?.[field.key])) add(field.key, field, REQUIRED_MESSAGE);
        }
    }
    // The rule the browser applies to these fields, so the list names what it would refuse.
    const badCompanyEmail = filled(row?.companyEmail) && !isWellFormedEmail(String(row.companyEmail).trim());
    const badSupervisorEmail = filled(row?.supervisorEmail) && !isWellFormedEmail(String(row.supervisorEmail).trim());
    if (badCompanyEmail) add('companyEmail', { word: 'a valid company email', focus: (i) => `emp-co-email-${i}` }, EMAIL_MESSAGE);
    // Fixing a mistyped email gives the row its contact too, so it is asked for once.
    if (required && !badCompanyEmail && !badSupervisorEmail && !employerRowHasVerifierContact(row)) {
        add('phone', { word: 'a phone or email to verify the job', focus: (i) => `emp-phone-${i}` }, CONTACT_MESSAGE);
    }
    if (required) {
        for (const field of EMPLOYER_DATES) if (!filled(row?.[field.key])) add(field.key, field, REQUIRED_MESSAGE);
        for (const key of employerRowMissingAnswerKeys(row, today)) add(key, EMPLOYER_ANSWERS[key], REQUIRED_MESSAGE);
    }
    if (badSupervisorEmail) add('supervisorEmail', { word: 'a valid supervisor email', focus: (i) => `emp-sup-email-${i}` }, EMAIL_MESSAGE);
    return rowIssue('employers', index, `Employer ${index + 1}`, missing, row);
}

/**
 * Everything the page still needs, top to bottom.
 *
 * @param {object} params
 * @param {object} params.formData the wizard's answers
 * @param {{ hidden: boolean, required: boolean }} params.employment the company's employment-history setting
 * @param {Date} [params.today]
 * @returns {{ items: Array<{ key: string, code: string, message: string, focusId: string, fields: object }>,
 *   rowKey: (listKey: string, index: number) => string,
 *   errorFor: (listKey: string, index: number, key: string) => (string|undefined) }}
 */
export function employmentStepIssues({ formData, employment, today = new Date() }) {
    const items = [];
    if (!employment.hidden) {
        rowsOf(formData, 'employers').forEach((row, index) => {
            items.push(employerIssue(row, index, { required: employment.required, lockedEmployers: formData?.lockedEmployers, today }));
        });
    }
    for (const list of ROW_LISTS) {
        rowsOf(formData, list.listKey).forEach((row, index) => {
            const missing = list.fields
                .filter((field) => !filled(row?.[field.key]))
                .map((field) => ({ key: field.key, message: REQUIRED_MESSAGE, focus: field.focus(index), word: field.word }));
            items.push(rowIssue(list.listKey, index, list.title(index + 1), missing, row));
        });
    }
    const present = items.filter(Boolean);
    const byRow = new Map(present.map((item) => [item.key, item.fields]));
    const rowKey = (listKey, index) => rowKeyOf(listKey, rowsOf(formData, listKey)[index], index);
    return {
        items: present,
        rowKey,
        errorFor: (listKey, index, key) => byRow.get(rowKey(listKey, index))?.[key],
    };
}

/** Moves the applicant to a listed field: centred, because the page has a sticky header, and at once. */
export function focusEmploymentField(id) {
    const element = typeof document === 'undefined' ? null : document.getElementById(id);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView?.({ block: 'center' });
}
