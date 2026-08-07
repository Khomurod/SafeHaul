// src/config/applicationDefinition.js
//
// The browser's view of "what this application asks", resolved against the
// company's settings.
//
// WHY THIS EXISTS
// ---------------
// Review & Confirm rendered from a hand-written list of fields with its own
// labels and its own idea of what to show. Three consequences, all visible to
// applicants:
//
//   * A question the company had HIDDEN still got a row — "SSN: Not provided"
//     on an application that never asked for one.
//   * Values were interpolated into template strings without checking, so a
//     driver with no emergency contact read "undefined (undefined) - undefined",
//     and one with no straight-truck experience read "undefined yrs".
//   * Custom questions did not appear at all, so a driver could not review the
//     answers they had just given.
//
// The wizard, the preserved record and the PDF now resolve the same table —
// `functions/shared/applicationSections.json`, imported by both runtimes — so a
// label, a column or a dependency exists in exactly one place.
//
// This module is the pure browser half: it resolves the table against the
// company's gates and the driver's answers, and returns rows a renderer can
// print. It performs no I/O.

import STANDARD_SECTIONS from '../../functions/shared/applicationSections.json';
import { resolveApplicationGate } from './applicationGates';

export { STANDARD_SECTIONS };

/** Shown when a presented question was left blank. */
export const NOT_PROVIDED = 'Not provided';

/** True when the driver supplied nothing. Mirrors the server's `isBlank`. */
function isBlank(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

/** `YYYY-MM-DD` / `YYYY-MM` → US display. Anything else passes through. */
function formatDateForDisplay(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return null;
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (ymd) return `${ymd[2]}/${ymd[3]}/${ymd[1]}`;
    const ym = /^(\d{4})-(\d{2})$/.exec(raw);
    if (ym) return `${ym[2]}/${ym[1]}`;
    return raw;
}

/**
 * A file answer reads as its filename — never a storage path or a signed URL,
 * which are infrastructure values and often carry credentials.
 */
function formatFileForDisplay(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const segment = trimmed.split('?')[0].split('/').pop();
        return segment ? decodeURIComponent(segment) : 'Uploaded file';
    }
    if (value && typeof value === 'object') {
        return value.name || value.fileName || 'Uploaded file';
    }
    return null;
}

/** Mirrors the server's `formatAnswerForDisplay`. */
export function formatAnswerForDisplay(value, field = {}) {
    if (isBlank(value)) return null;
    if (field.type === 'file') return formatFileForDisplay(value);
    if (field.type === 'date') return formatDateForDisplay(value);

    if (Array.isArray(value)) {
        const parts = value.map((v) => (typeof v === 'string' ? v.trim() : String(v))).filter(Boolean);
        return parts.length ? parts.join(', ') : null;
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return String(value);

    const raw = String(value).trim();
    if (raw.toLowerCase() === 'yes') return 'Yes';
    if (raw.toLowerCase() === 'no') return 'No';
    return raw || null;
}

/** Was this field actually put in front of the driver? */
export function wasPresented(field, formData) {
    if (field.presentWhenAnswered) return !isBlank(formData ? formData[field.id] : undefined);
    if (!field.dependsOn) return true;
    const actual = formData ? formData[field.dependsOn.field] : undefined;
    const expected = field.dependsOn.equals;
    if (typeof actual === 'string' && typeof expected === 'string') {
        return actual.trim().toLowerCase() === expected.trim().toLowerCase();
    }
    return actual === expected;
}

/** Resolve a repeating field's rows into labelled cells. */
export function buildRepeatingRows(value, columns) {
    if (!Array.isArray(value) || !Array.isArray(columns) || columns.length === 0) return [];
    return value
        .map((row) => {
            const record = row && typeof row === 'object' ? row : {};
            return columns
                .map((column) => ({
                    label: column.label,
                    displayValue: formatAnswerForDisplay(record[column.id], column),
                }))
                .filter((cell) => cell.displayValue !== null);
        })
        .filter((cells) => cells.length > 0);
}

/**
 * Resolve the whole application into display sections.
 *
 * Hidden fields are absent — not blank rows. Conditional fields the driver never
 * saw are absent too. What is left is exactly what was asked, with the wording
 * the record will freeze.
 *
 * @param {object} opts
 * @param {object} opts.applicationConfig The company's saved gate map.
 * @param {object} opts.formData          The driver's answers so far.
 * @param {Array}  [opts.customQuestions] The company's custom questions.
 * @param {number} [opts.stepByFieldId]   Optional map of field id → wizard step,
 *   so a section can offer an Edit control that lands on the right page.
 * @returns {{sections: Array, customAnswers: Array}}
 */
export function buildApplicationReview({
    applicationConfig,
    formData,
    customQuestions = [],
    stepByFieldId = {},
} = {}) {
    const data = formData && typeof formData === 'object' ? formData : {};

    const sections = STANDARD_SECTIONS.map((section) => {
        const answers = [];

        for (const field of section.fields) {
            const gate = resolveApplicationGate(applicationConfig, field.gate || null);
            // A field the company hid was never asked. It is not an unanswered
            // question, so it is not shown as one.
            if (field.gate && gate.hidden) continue;
            if (!wasPresented(field, data)) continue;

            const rawValue = data[field.id];
            const repeating = Boolean(field.repeating);
            answers.push({
                key: field.id,
                label: field.label,
                sensitive: Boolean(field.sensitive),
                required: field.gate ? gate.required : false,
                repeating,
                rows: repeating ? buildRepeatingRows(rawValue, field.columns) : [],
                value: repeating ? null : (formatAnswerForDisplay(rawValue, field) || NOT_PROVIDED),
                isMissing: !repeating && isBlank(rawValue),
            });
        }

        return {
            id: section.id,
            title: section.title,
            answers,
            // The wizard step to open when the driver presses Edit. Derived from
            // the first field that has a mapping, so the map stays a small,
            // explicit table rather than a rule.
            step: answers.reduce(
                (found, answer) => (found ?? (answer.key in stepByFieldId ? stepByFieldId[answer.key] : null)),
                null,
            ),
        };
    }).filter((section) => section.answers.length > 0);

    const answersById = data.customAnswers && typeof data.customAnswers === 'object' ? data.customAnswers : {};
    const customAnswers = (Array.isArray(customQuestions) ? customQuestions : []).map((question, index) => {
        const label = typeof question?.label === 'string' ? question.label.trim() : '';
        const rawValue = question?.id ? answersById[question.id] : undefined;
        return {
            // React identity only; never rendered as text.
            key: question?.id || `question-${index}`,
            // A question with no recorded wording is described, never printed as
            // its id — that is how UUIDs reached applicants and recruiters.
            label: label || 'Question wording not recorded',
            labelUnavailable: !label,
            value: formatAnswerForDisplay(rawValue, { type: question?.type }) || NOT_PROVIDED,
            isMissing: isBlank(rawValue),
        };
    });

    return { sections, customAnswers };
}

export default buildApplicationReview;
