/**
 * A short code for a link a person reads out or types: 8 characters from an
 * alphabet without look-alikes (no 0/O, 1/I/L).
 */
export const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SHORT_CODE_LENGTH = 8;

export function newShortCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
    return Array.from(random(SHORT_CODE_LENGTH), (byte) => SHORT_CODE_ALPHABET[byte % SHORT_CODE_ALPHABET.length]).join('');
}
