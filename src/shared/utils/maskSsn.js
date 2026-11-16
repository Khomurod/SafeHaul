/**
 * A Social Security Number as every screen shows it: `***-**-` and its last
 * four digits. The full number is never shown masked any other way.
 *
 * The rule exists once per runtime: here for the screens and in
 * `functions/shared/maskSsn.js` for the server (the application PDF, the
 * previous-employer request, the company API). Both suites run
 * `functions/shared/maskSsn.vectors.json`, so a change to one fails until the
 * other matches.
 *
 * - No value (null, undefined, a blank string) → null. There is no number, and
 *   each screen shows its own "nothing here": a dash, `***-**-****`,
 *   "REDACTED (ON FILE)".
 * - Four digits or more → `***-**-` and the last four digits. Anything else in
 *   the value (separators, a stray space) is dropped first and never shown.
 * - Fewer than four digits ("Unknown", "N/A", "12") → `***-**-****`, never a
 *   piece of the stored text.
 */
export function maskSsn(value) {
    if (value === null || value === undefined) return null;
    const text = String(value);
    if (text.trim() === '') return null;
    const digits = text.replace(/\D/g, '');
    return digits.length >= 4 ? `***-**-${digits.slice(-4)}` : '***-**-****';
}
