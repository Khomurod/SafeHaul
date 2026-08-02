// src/features/signing/utils/templateFieldSerializer.js
//
// Pure, dependency-free serialization of a placed signing field into the exact
// shape persisted on a template / signing_request document.
//
// WHY THIS EXISTS: Firestore rejects writes that contain `undefined` anywhere in
// the payload ("Unsupported field value: undefined"). The signing-field objects
// are assembled across drag/resize/paste/hydrate code paths, so a single missing
// numeric coordinate used to blow up the whole save with an opaque "Action failed".
// Funnelling every field through this serializer guarantees a fully-defined,
// type-correct document — so that class of save failure can never recur.

import { normalizePrefillPolicy } from '@features/signing/utils/prefillEngine';

/** Coerce to a finite number, falling back to `fallback` for NaN/undefined/null/''. */
function num(value, fallback) {
    // Guard null/undefined/'' explicitly: Number(null) and Number('') are 0 (finite),
    // which would let a missing coordinate masquerade as a real 0 instead of the fallback.
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/** Coerce to a non-empty string, falling back to `fallback`. */
function str(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    const s = String(value);
    return s.length > 0 ? s : fallback;
}

/**
 * Serialize one placed field into its persisted document shape.
 * Every property is guaranteed defined and of the correct primitive type.
 *
 * @param {object} field A placed field from the EnvelopeCreator canvas.
 * @returns {object} A Firestore-safe field document (no undefined values).
 */
export function serializeTemplateField(field = {}) {
    const policy = normalizePrefillPolicy(field);
    return {
        id: str(field.id, `field_${Math.random().toString(36).slice(2, 10)}`),
        type: str(field.type, 'text'),
        label: str(field.label, 'Field'),
        pageNumber: num(field.page, 1) || 1,
        xPosition: num(field.x, 0),
        yPosition: num(field.y, 0),
        width: num(field.width, 25),
        height: num(field.height, 5),
        required: typeof field.required === 'boolean' ? field.required : true,
        defaultValue: str(field.defaultValue, ''),
        readOnly: field.readOnly === true || policy === 'locked',
        prefillPolicy: policy,
        bindingKey: str(field.bindingKey, ''),
        prefillGroupKey: str(field.prefillGroupKey, ''),
        fontSize: str(field.fontSize, 'Auto'),
    };
}

/**
 * Serialize an array of placed fields, dropping null/undefined entries.
 *
 * @param {Array<object>} fields
 * @returns {Array<object>} Firestore-safe field documents.
 */
export function serializeTemplateFields(fields = []) {
    return (Array.isArray(fields) ? fields : [])
        .filter((f) => f != null)
        .map(serializeTemplateField);
}
