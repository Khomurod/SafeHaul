/**
 * A Social Security Number as it is shown wherever the full number is not
 * authorized: `***-**-` and its last four digits.
 *
 * The rule exists once per runtime: here for the server (the application PDF,
 * the previous-employer request, the company API) and in
 * `src/shared/utils/maskSsn.js` for the screens. `functions/` is CommonJS and
 * deployed on its own, so they cannot be one module. Both suites run
 * `maskSsn.vectors.json`, so a change to one fails until the other matches.
 *
 * - No value (null, undefined, a blank string) → null. There is no number, and
 *   each caller shows its own "nothing here": "Not provided", "Not on file".
 * - Four digits or more → `***-**-` and the last four digits. Anything else in
 *   the value (separators, a stray space) is dropped first and never shown.
 * - Fewer than four digits ("Unknown", "N/A", "12") → `***-**-****`, never a
 *   piece of the stored text.
 */
function maskSsn(value) {
    if (value === null || value === undefined) return null;
    const text = String(value);
    if (text.trim() === '') return null;
    const digits = text.replace(/\D/g, '');
    return digits.length >= 4 ? `***-**-${digits.slice(-4)}` : '***-**-****';
}

module.exports = { maskSsn };
