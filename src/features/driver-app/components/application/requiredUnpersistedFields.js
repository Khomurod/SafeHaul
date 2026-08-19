/**
 * Required answers a resumed application cannot have brought back with it.
 *
 * A draft deliberately never stores `ssn` or `signature` — PII and a biometric,
 * removed on the local write, removed from the client payload, removed again on
 * arrival at the server. The consequence nobody had accounted for: the wizard
 * validates a step when the applicant presses Next on it, so an applicant who
 * resumes at the licence page never passes back through page one, nothing
 * re-asks for the Social Security Number, and the application submits without a
 * field the company marked Required.
 *
 * This is the browser half of that fix. `functions/shared/buildApplicationDoc.js`
 * carries the authoritative half and refuses such a submission outright; this
 * module exists so the applicant is walked back to the field and told what is
 * missing, instead of meeting a server error at the end. Both halves resolve the
 * same way, from the same three sources:
 *
 *   * `functions/shared/applicationSections.json` — the field table both runtimes
 *     import directly, so neither can hold a private idea of what the fields are;
 *   * `resolveApplicationGate` — so a company that hides the field, or marks it
 *     Optional, is respected exactly as every wizard step respects it;
 *   * `NEVER_STORED` — the storage module's own strip list, so anything that
 *     stops being persisted later is covered without touching this file.
 *
 * **Scope, deliberately.** Only fields that are *required, gated and never
 * persisted* are checked. Every other required answer is in the draft by
 * construction: it had to be filled to get past the step that collects it, and
 * the draft carries it. Extending this to "every field in the table" would start
 * blocking submissions on rows the wizard does not render, which is a different
 * change with a different risk.
 */

import STANDARD_SECTIONS from '../../../../../functions/shared/applicationSections.json';
import { resolveApplicationGate } from '@/config/applicationGates';
import { NEVER_STORED } from './applicationDraftStorage';

/**
 * Where each never-persisted field is collected, as a semantic step id.
 *
 * Hand-recorded because it is not derivable: the section table groups fields by
 * *subject*, not by wizard page (`referralSource` sits in the `qualifications`
 * section but is rendered on the contact step). Kept honest by
 * `requiredUnpersistedFields.test.js`, which fails if the schema ever grows a
 * never-persisted gated field with no entry here — so the next person is forced
 * to record where their field is asked, rather than the applicant being sent to
 * a page that does not collect it.
 */
export const NEVER_STORED_FIELD_STEP = Object.freeze({
    ssn: 'contact',
});

/**
 * Fallback for a field whose collecting step nobody recorded.
 *
 * Unreachable while the test above passes. `contact` rather than "give up": the
 * first page is where identity questions live, and sending someone to page one
 * with an explicit message is a better failure than silently allowing the
 * submission the server is about to refuse anyway.
 */
const FALLBACK_SEMANTIC_STEP = 'contact';

function isBlank(value) {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    return false;
}

/**
 * Required, never-persisted fields the form does not currently hold.
 *
 * @param {object} applicationConfig The company's saved gate map.
 * @param {object} formData          The live wizard state.
 * @returns {Array<{id: string, label: string, semanticStep: string}>} in schema
 *   order, so the caller can route to the first one and the applicant walks
 *   forward from there.
 */
export function getMissingRequiredUnpersistedFields(applicationConfig, formData) {
    const answers = formData && typeof formData === 'object' ? formData : {};
    const missing = [];

    for (const section of STANDARD_SECTIONS) {
        for (const field of section.fields || []) {
            if (!field.gate) continue;
            if (!NEVER_STORED.includes(field.id)) continue;

            const gate = resolveApplicationGate(applicationConfig, field.gate);
            // Hidden is never required and Optional is never blocking — the same
            // resolution the step itself applies, so the two cannot disagree
            // about what this company actually asked for.
            if (gate.hidden || !gate.required) continue;
            if (!isBlank(answers[field.id])) continue;

            missing.push({
                id: field.id,
                label: field.label || field.id,
                semanticStep: NEVER_STORED_FIELD_STEP[field.id] || FALLBACK_SEMANTIC_STEP,
            });
        }
    }

    return missing;
}

export default getMissingRequiredUnpersistedFields;
