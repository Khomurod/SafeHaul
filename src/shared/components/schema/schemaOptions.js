// src/shared/components/schema/schemaOptions.js
//
// Pure helpers the schema renderer and its edit controls share: how an option is
// read, how a multi-choice value is read, and which field types may be edited in
// place. Apart from `SchemaRenderer.jsx` so that file stays what one file should
// hold.

/**
 * Normalize a radio/select option to a { value, label } pair.
 * Schema options come in two shapes: plain strings (['yes', 'no']) and objects
 * ({ label: 'Yes', value: 'yes' } from form-options.js). Rendering the object
 * form directly as a React child throws "Objects are not valid as a React child"
 * (React error #31), which crashes the edit form for any yes/no field.
 */
export function normalizeOption(opt) {
    if (opt && typeof opt === 'object') {
        const value = opt.value;
        return { value, label: opt.label ?? String(value) };
    }
    return { value: opt, label: String(opt) };
}

/** A multi-choice checkbox value, as the wizard stores it ("H,N") or as an array. */
export function listValues(value) {
    const items = Array.isArray(value) ? value : String(value ?? '').split(',');
    return items.map((item) => String(item).trim()).filter(Boolean);
}

/**
 * Types the company editors must not offer as a retypeable value.
 *
 * A file is a document reference: as `<Input type="text">` its box would read
 * "[object Object]", and typing into it would replace the reference with a string
 * that a carrier's prepared application then hands to the driver as their
 * medical card. A signature is an image of somebody's mark and would show as a
 * base64 string. Both stay read-only while the rest of the section edits;
 * documents are attached through their own control. Edit mode has two callers:
 * the carrier's prep editor and the dossier's Edit Application. The names are the
 * schema's own `type` strings.
 */
const NOT_EDITABLE_IN_PLACE = new Set(['file', 'signature', 'array']);

export function isEditableInPlace(type) {
    return !NOT_EDITABLE_IN_PLACE.has(type);
}
