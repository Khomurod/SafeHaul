/**
 * PEV — signature normalisation for the previous-employer portal.
 *
 * The respondent signs the §391.23 response either by drawing on the canvas
 * (a PNG data URL) or, since 2026-09-06 (audit step J), by typing their full
 * name — stored as `TEXT_SIGNATURE:<name>`, the convention the driver
 * application already uses for typed marks. Under the ESIGN Act
 * (15 U.S.C. §7006(5)) and UETA a name typed with intent to sign is an
 * electronic signature, so both forms are stored with equal standing and the
 * method is recorded beside the mark.
 *
 * Everything the client sends is untrusted. This module accepts exactly two
 * shapes and refuses everything else with `invalid-argument`, so a JPEG, an
 * SVG, a `javascript:` URL, a control character or a two-megabyte payload can
 * never reach Cloud Storage, the response record or the generated PDF. The
 * method is derived from the validated mark — a client's claim is checked
 * against it, never trusted on its own — and an older client that sends no
 * method at all is still accepted.
 */
const { HttpsError } = require("firebase-functions/v2/https");

const TYPED_SIGNATURE_PREFIX = 'TEXT_SIGNATURE:';
const TYPED_SIGNATURE_MIN_LENGTH = 2;
const TYPED_SIGNATURE_MAX_LENGTH = 120;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
// Two megabytes of base64 is ~1.5 MB of PNG: far above anything a signature
// canvas produces, and small enough that decoding it cannot exhaust memory.
const DRAWN_SIGNATURE_MAX_BASE64_LENGTH = 2000000;
// Padded base64 only — the shape `canvas.toDataURL('image/png')` produces.
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
// Every PNG file starts with these eight bytes (ISO/IEC 15948 §5.2).
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Unicode general category Cc: the C0 controls, DEL and the C1 range. None
// belongs in a person's name, and any of them can corrupt the PDF text run
// or a log line.
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

const SIGNATURE_METHODS = Object.freeze(['drawn', 'typed']);

function refuse(message) {
    return new HttpsError('invalid-argument', message);
}

function normaliseDrawn(signatureData) {
    const base64 = signatureData.slice(PNG_DATA_URL_PREFIX.length);
    if (base64.length === 0) throw refuse('The drawn signature is empty.');
    if (base64.length > DRAWN_SIGNATURE_MAX_BASE64_LENGTH) throw refuse('The drawn signature is too large.');
    if (!BASE64_PATTERN.test(base64)) throw refuse('The drawn signature is not a valid PNG image.');
    const png = Buffer.from(base64, 'base64');
    if (png.length < PNG_MAGIC.length || !png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
        throw refuse('The drawn signature is not a valid PNG image.');
    }
    return { kind: 'drawn', png };
}

function normaliseTyped(signatureData) {
    const name = signatureData.slice(TYPED_SIGNATURE_PREFIX.length).trim();
    if (name.length < TYPED_SIGNATURE_MIN_LENGTH) throw refuse('Please type your full name to sign.');
    if (name.length > TYPED_SIGNATURE_MAX_LENGTH) {
        throw refuse(`The typed signature cannot exceed ${TYPED_SIGNATURE_MAX_LENGTH} characters.`);
    }
    if (CONTROL_CHARACTER_PATTERN.test(name)) {
        throw refuse('The typed signature contains characters that cannot be part of a name.');
    }
    return { kind: 'typed', name };
}

/**
 * Validate the signature a respondent submitted.
 *
 * @param {unknown} signatureData   `data:image/png;base64,…`, `TEXT_SIGNATURE:<name>`, or nothing
 * @param {unknown} signatureMethod `'drawn'`, `'typed'`, or nothing (older clients)
 * @returns {{kind: 'none'} | {kind: 'drawn', png: Buffer} | {kind: 'typed', name: string}}
 * @throws {HttpsError} `invalid-argument` for any other shape, for a method that
 *   contradicts the mark, and for a method given without a mark.
 */
function normaliseSignature(signatureData, signatureMethod) {
    const hasData = signatureData !== undefined && signatureData !== null && signatureData !== '';
    const hasMethod = signatureMethod !== undefined && signatureMethod !== null && signatureMethod !== '';

    if (!hasData) {
        if (hasMethod) throw refuse('A signature method was given without a signature.');
        return { kind: 'none' };
    }
    if (typeof signatureData !== 'string') throw refuse('The signature must be a string.');
    if (hasMethod && !SIGNATURE_METHODS.includes(signatureMethod)) {
        throw refuse('The signature method must be "drawn" or "typed".');
    }

    let signature;
    if (signatureData.startsWith(PNG_DATA_URL_PREFIX)) {
        signature = normaliseDrawn(signatureData);
    } else if (signatureData.startsWith(TYPED_SIGNATURE_PREFIX)) {
        signature = normaliseTyped(signatureData);
    } else {
        throw refuse('The signature must be a drawn PNG image or a typed name.');
    }

    if (hasMethod && signatureMethod !== signature.kind) {
        throw refuse('The signature method does not match the signature.');
    }
    return signature;
}

module.exports = {
    normaliseSignature,
    SIGNATURE_METHODS,
    TYPED_SIGNATURE_PREFIX,
    TYPED_SIGNATURE_MIN_LENGTH,
    TYPED_SIGNATURE_MAX_LENGTH,
    DRAWN_SIGNATURE_MAX_BASE64_LENGTH,
};
