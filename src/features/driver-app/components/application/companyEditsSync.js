/**
 * The driver's side of a Company Admin's edits, pure: which answers to take from
 * the server, how to take them, and what to tell the driver.
 *
 * The protocol is described in `functions/shared/companyEdits.js`. This page keeps
 * two things beside the answers, inside the same `formData` and so inside the same
 * local draft, which means they always describe the copy they travel with:
 *
 * - `_companyRevision`: the latest company edit this copy has taken. Every save
 *   and the submission say it, and the server refuses a copy that is behind.
 * - `_companyNotice`: the answers the carrier changed on this copy, for the notice
 *   above the wizard, until the driver dismisses it or submits.
 *
 * Neither is an answer, so neither is ever sent as one: `withoutCompanyKeys` takes
 * both out of every payload.
 */
import STANDARD_SECTIONS from '../../../../../functions/shared/applicationSections.json';
import DRIVER_ONLY_FIELDS from '../../../../../functions/shared/driverOnlyFields.json';
import {
    COMPANY_KEYS,
    COMPANY_NOTICE_KEY,
    COMPANY_REVISION_KEY,
    companyRevisionIn,
} from './companyEditsWire';

export {
    COMPANY_KEYS,
    COMPANY_NOTICE_KEY,
    COMPANY_REVISION_KEY,
    companyRevisionIn,
    restoredWithRevision,
    saveOnTheWire,
    withoutCompanyKeys,
} from './companyEditsWire';

/**
 * Answers this page never takes from the carrier, whatever the server says.
 *
 * The contact details are the draft's key and the name and date of birth its
 * identity check, so taking a change to them would move or orphan the draft. The
 * SSN and the signature are never stored, and the Social Security card is the
 * driver's own identity document. The rest are the driver's own consents, marks
 * and hours-of-service statement. The server refuses edits to all of them; this
 * is the second lock.
 */
const NEVER_TAKEN = new Set([...DRIVER_ONLY_FIELDS, ...COMPANY_KEYS]);

/** Fields whose keys are separate answers, as `reconcileApplicationDraft` merges them. */
const KEYED_ANSWER_MAPS = new Set(['customAnswers']);

/** Each answer's section, for naming them to the driver. */
const SECTION_OF = new Map([['customAnswers', 'Additional Questions']]);
for (const section of STANDARD_SECTIONS) {
    for (const field of section.fields || []) SECTION_OF.set(field.id, section.title);
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function same(a, b) {
    try {
        return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    } catch {
        return false;
    }
}

/** The answers the carrier edited after `seen`, in a stable order. */
export function companyFieldsAfter(companyEdits, seen) {
    const floor = Number.isInteger(seen) ? seen : 0;
    return Object.entries(isPlainObject(companyEdits) ? companyEdits : {})
        .filter(([field, revision]) => Number.isInteger(revision) && revision > floor && !NEVER_TAKEN.has(field))
        .map(([field]) => field)
        .sort();
}

/**
 * `formData` with each of `fields` as the server copy has it.
 *
 * Replaced, never merged, because repeating rows have no identity: an employer the
 * carrier corrected and the driver's older version of it would otherwise both
 * survive. A keyed map is the exception: it takes the carrier's answers and keeps
 * any answer only this copy has. A field the server copy lacks is left alone.
 */
export function takeCompanyAnswers(formData, serverFormData, fields) {
    const next = { ...(formData || {}) };
    for (const field of fields) {
        if (!serverFormData || !Object.prototype.hasOwnProperty.call(serverFormData, field)) continue;
        const theirs = serverFormData[field];
        next[field] = KEYED_ANSWER_MAPS.has(field) && isPlainObject(next[field]) && isPlainObject(theirs)
            ? { ...next[field], ...theirs }
            : theirs;
    }
    return next;
}

/** `formData` with `fields` added to the notice. */
export function withCompanyNotice(formData, fields) {
    if (!fields.length) return formData;
    const shown = Array.isArray(formData?.[COMPANY_NOTICE_KEY]) ? formData[COMPANY_NOTICE_KEY] : [];
    return { ...formData, [COMPANY_NOTICE_KEY]: [...new Set([...shown, ...fields])].sort() };
}

/**
 * What a refused save or submission brings in: the carrier's edits since this
 * copy's revision, and which of them change an answer on screen.
 */
export function companyEditsToTake(formData, draft) {
    const fields = companyFieldsAfter(draft?.companyEdits, companyRevisionIn(formData));
    const changed = fields.filter((field) => !same(
        takeCompanyAnswers(formData, draft?.formData, [field])[field],
        formData?.[field],
    ));
    return { fields, changed };
}

/**
 * The answers on screen once the carrier's edits are taken.
 *
 * The signature goes when an answer changed: it attested to the application as it
 * was before, and the driver must sign what they are now sending. The revision is
 * the server's, so the next save and the submission say this copy is current.
 */
export function takeCompanyEdits(formData, draft) {
    const { fields, changed } = companyEditsToTake(formData, draft);
    const next = withCompanyNotice(takeCompanyAnswers(formData, draft?.formData, fields), changed);
    if (changed.length) delete next.signature;
    next[COMPANY_REVISION_KEY] = Number.isInteger(draft?.companyRevision) ? draft.companyRevision : 0;
    return next;
}

/** The sections a notice names, in the application's order, each once. */
export function companyEditSections(fields) {
    if (!Array.isArray(fields)) return [];
    const named = new Set(fields.map((field) => SECTION_OF.get(field)).filter(Boolean));
    const order = [...STANDARD_SECTIONS.map((section) => section.title), 'Additional Questions'];
    return order.filter((title) => named.has(title));
}
