/**
 * The value constraints real Firestore enforces and an in-memory double does not.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every submission snapshot for a driver who listed even one previous address or
 * employer was rejected by production Firestore with
 * `INVALID_ARGUMENT: Property array contains an invalid nested entity`, because a
 * repeating answer is rows of cells — an array of arrays — and Firestore's rule
 * is that "an array cannot contain another array value as an element".
 *
 * 1219 unit tests passed throughout. The doubles are plain objects, so they
 * accepted a payload the real database would never take, and the defect reached
 * production on both the live submission path and the historical migration. It
 * surfaced only on the first real write.
 *
 * A double that accepts what the real thing rejects is not a cheap
 * approximation, it is a false pass. Applying this in the doubles closes that
 * whole class of gap rather than the one instance of it.
 */

/**
 * Paths where an array is nested directly inside an array.
 *
 * Firestore permits a map inside an array, and an array inside that map. It
 * forbids only an array whose element is itself an array.
 */
function nestedArrayPaths(value, path, insideArray, found) {
    if (Array.isArray(value)) {
        if (insideArray) found.push(path);
        value.forEach((item, index) => nestedArrayPaths(item, `${path}[${index}]`, true, found));
        return found;
    }
    if (value && typeof value === 'object') {
        // A Date, a sentinel and a Timestamp are leaf values, not maps to walk.
        if (value instanceof Date) return found;
        for (const [key, inner] of Object.entries(value)) {
            nestedArrayPaths(inner, `${path}.${key}`, false, found);
        }
    }
    return found;
}

/**
 * Throw the error real Firestore throws when `data` cannot be stored.
 *
 * The message and gRPC code match production so a test asserting on the failure
 * is asserting on the real one.
 *
 * @param {object} data Document data as passed to set/create/update/add.
 * @param {string} [where] Document path, for a message a human can act on.
 */
function assertStorableValue(data, where = '') {
    const offending = nestedArrayPaths(data, '$', false, []);
    if (offending.length === 0) return;

    const error = new Error(
        '3 INVALID_ARGUMENT: Property array contains an invalid nested entity.'
        + ` Firestore cannot store an array inside an array — offending path(s): ${offending.slice(0, 5).join(', ')}`
        + (where ? ` (writing ${where})` : ''),
    );
    error.code = 3;
    throw error;
}

module.exports = { assertStorableValue, nestedArrayPaths };
