/**
 * What the dossier's *Edit Application* may change, and how to say what a
 * proposal left out.
 *
 * The list is the server's own (`functions/shared/applicationEditableFields.json`,
 * the allowlist `proposeApplicationChanges` applies), read here and never copied,
 * so the screen offers exactly the edits the server takes. Every other field
 * shows display-only while editing.
 */
import EDITABLE_FIELD_KEYS from '../../../../functions/shared/applicationEditableFields.json';
import STANDARD_SECTIONS from '../../../../functions/shared/applicationSections.json';
import { getFieldByKey } from '@/config/applicationSchema';

const EDITABLE = new Set(EDITABLE_FIELD_KEYS);
const SECTION_LABELS = new Map(STANDARD_SECTIONS.flatMap((section) => section.fields.map((field) => [field.id, field.label])));

/** Why a field has no box while the application is edited. */
export const DISPLAY_ONLY_REASON = "Fields without a box are display only: they are the driver's own answers, "
    + "documents and signature, which the company can't change.";

/** The fields of an `APPLICATION_SCHEMA` section that stay display-only while editing. */
export function displayOnlyKeys(section) {
    return (section?.fields || []).map((field) => field.key).filter((key) => !EDITABLE.has(key));
}

/** A field's name as the Edit screen shows it, else as the record does. */
function fieldName(key) {
    return getFieldByKey(key)?.label || SECTION_LABELS.get(key) || 'Another field';
}

/**
 * The message's account of the fields a proposal left out (the server's
 * `skipped`), or '' when there were none. One on the list was left out because
 * the record already holds that value; one off it, because it is not the
 * company's to change.
 */
export function skippedSummary(skipped) {
    const keys = (Array.isArray(skipped) ? skipped : []).filter((key) => typeof key === 'string' && key);
    if (keys.length === 0) return '';
    const items = keys.map((key) => `${fieldName(key)} (${EDITABLE.has(key) ? 'no change' : "can't be changed by the company"})`);
    return `Not sent for approval: ${items.join('; ')}.`;
}
