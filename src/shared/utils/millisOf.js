/**
 * Milliseconds from a stored time as the browser holds it: a Firestore
 * `Timestamp`, its plain `{ seconds }` form, or a `Date`; null for anything
 * else. Text and numbers are not read as times here: a caller that takes them
 * says so with its own reader.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function millisOf(value) {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    if (value instanceof Date) return value.getTime();
    return null;
}
