/**
 * What a Company Admin's editor offers on an unfinished application, and what it
 * sends when they save.
 *
 * Pure, so the rules are stated once and tested directly; the screen is
 * `UnfinishedApplicationEditor.jsx`. The server holds the same rules
 * (`functions/shared/companyEdits.js`) and refuses anything else, so this file
 * decides only what is worth showing.
 *
 * ## What is offered
 *
 * The answers the driver's application asks for (`applicationSections.json`, the
 * table the wizard, the record and the PDF read), as the company's form asks
 * them: a question the company hid is not offered, and one that depends on
 * another answer appears when that answer allows it. Never the answers only the
 * driver gives (`driverOnlyFields.json`): their contact details, last name and
 * date of birth, which identify the application; the SSN, its card and the
 * signature; their consents and initials; and their hours-of-service statement,
 * which they make about their own week. A question asked only in some cases
 * (`presentWhenAnswered`) is offered once it has an answer.
 *
 * ## What is sent
 *
 * Only the answers that differ from what the editor loaded, each with the value
 * it loaded beside it, so the server can refuse an answer the driver changed in
 * the meantime instead of overwriting it.
 */
import STANDARD_SECTIONS from '../../../../functions/shared/applicationSections.json';
import DRIVER_ONLY_FIELDS from '../../../../functions/shared/driverOnlyFields.json';
import { resolveApplicationGate } from '@/config/applicationGates';
import { wasPresented } from '@/config/applicationDefinition';
import { lockedEmployerIssues, normalizeLockedEmployers } from '@/config/applicationLockedFields';

/** The company's own questions' answers: one map, beside the standard answers. */
export const CUSTOM_ANSWERS = 'customAnswers';

const DRIVER_ONLY = new Set(DRIVER_ONLY_FIELDS);
const FIELDS = new Map(STANDARD_SECTIONS.flatMap((section) => section.fields.map((field) => [field.id, field])));

/** Every answer a Company Admin may change; the server's `EDITABLE_FIELDS`. */
export const EDITABLE_FIELDS = Object.freeze(
    [...FIELDS.keys(), CUSTOM_ANSWERS].filter((field) => !DRIVER_ONLY.has(field)),
);
const EDITABLE = new Set(EDITABLE_FIELDS);

function isBlank(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

/**
 * Does the editor offer this answer?
 *
 * @param {string} fieldId an id from `applicationSections.json`
 * @param {object} context
 * @param {object} [context.applicationConfig] the company's form settings, as the wizard read them
 * @param {object} context.answers the answers as they stand in the editor
 * @param {object} context.loaded the answers as the editor loaded them
 */
export function isOffered(fieldId, { applicationConfig, answers, loaded }) {
    const field = FIELDS.get(fieldId);
    if (!field || DRIVER_ONLY.has(fieldId)) return false;
    if (field.gate && resolveApplicationGate(applicationConfig, field.gate).hidden) return false;
    if (field.presentWhenAnswered) return !isBlank(loaded?.[fieldId]) || !isBlank(answers?.[fieldId]);
    return wasPresented(field, answers || {});
}

/**
 * Does the editor offer this document?
 *
 * A document the company asks for unless it hid it, and one it asks for only in
 * some cases (a PSP report, a motor vehicle record) whether or not the driver
 * has one: a document the carrier already holds is the commonest thing it adds.
 */
export function isDocumentOffered(fieldId, applicationConfig) {
    const field = FIELDS.get(fieldId);
    if (!field || field.type !== 'file' || DRIVER_ONLY.has(fieldId)) return false;
    return !(field.gate && resolveApplicationGate(applicationConfig, field.gate).hidden);
}

/** A value with its keys in one order, so two copies of it compare equal. */
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value === undefined ? null : value;
}

/** Are these the same answer, whatever order their keys arrived in? */
export function sameAnswer(first, second) {
    return JSON.stringify(canonical(first)) === JSON.stringify(canonical(second));
}

/**
 * What a save sends: each answer that differs from the one loaded (`changes`),
 * and the value it loaded (`base`). Empty when nothing changed.
 */
export function editRequest(answers, loaded) {
    const changes = {};
    const base = {};
    const fields = new Set([...Object.keys(answers || {}), ...Object.keys(loaded || {})]);
    for (const field of fields) {
        if (!EDITABLE.has(field)) continue;
        if (sameAnswer(answers?.[field], loaded?.[field])) continue;
        changes[field] = answers?.[field] ?? null;
        base[field] = loaded?.[field] ?? null;
    }
    return { changes, base };
}

/**
 * The employer locks the loaded answers hold, which an edit must keep.
 *
 * The server refuses an edit that would undo one (`undoesALock` in
 * `functions/drafts/admin.js`). A lock the driver's own rows already fail is
 * theirs to answer at submission, not the editor's to keep, so a row the admin
 * adds for that employer stays an ordinary row.
 */
export function heldLocks(lockedEmployers, loaded) {
    return normalizeLockedEmployers(lockedEmployers)
        .filter((lock) => lockedEmployerIssues([lock], loaded || {}).length === 0);
}

/** The changed answers' sections, in the application's order, for the confirmation. */
export function changedSectionTitles(fields) {
    const changed = new Set(fields || []);
    const titles = STANDARD_SECTIONS
        .filter((section) => section.fields.some((field) => changed.has(field.id)))
        .map((section) => section.title);
    if (changed.has(CUSTOM_ANSWERS)) titles.push('Additional Questions');
    return titles;
}
