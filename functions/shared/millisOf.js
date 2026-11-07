/**
 * Milliseconds from a stored time: a Firestore `Timestamp` (what a read returns)
 * or a `Date` (what the same process wrote, and what test doubles hold); null
 * for anything else. Text and numbers are not read as times here: a caller that
 * takes them says so with its own reader.
 */
function millisOf(value) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return null;
}

module.exports = { millisOf };
