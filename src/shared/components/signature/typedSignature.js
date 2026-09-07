/**
 * The typed electronic signature — the stored form and its limits.
 *
 * A typed mark is stored as `TEXT_SIGNATURE:<name>`, the convention the driver
 * application already uses, and is never rasterised into an image: the record
 * must be able to say which kind of mark it holds. The server
 * (`functions/employmentVerification/signature.js`) applies the same prefix and
 * the same 2–120 character bounds, and refuses anything else.
 *
 * Kept apart from `SignatureInput.jsx` so that file exports only a component
 * (React Fast Refresh) and so tests and the portal can share these without
 * importing the UI.
 */
export const TYPED_SIGNATURE_PREFIX = 'TEXT_SIGNATURE:';
export const TYPED_SIGNATURE_MIN_LENGTH = 2;
export const TYPED_SIGNATURE_MAX_LENGTH = 120;

/** The Draw | Type choice, in the order the control shows it. */
export const SIGNATURE_METHODS = Object.freeze([
    { value: 'drawn', label: 'Draw' },
    { value: 'typed', label: 'Type' },
]);

/** The stored form of a typed mark, or `null` when the name is too short to be one. */
export function typedSignatureValue(name) {
    const trimmed = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (trimmed.length < TYPED_SIGNATURE_MIN_LENGTH) return null;
    return `${TYPED_SIGNATURE_PREFIX}${trimmed.slice(0, TYPED_SIGNATURE_MAX_LENGTH)}`;
}
