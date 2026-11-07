// functions/shared/unchangedWrite.js
//
// Whether a write would change what a document already holds, so a trigger can
// leave the document alone when it would not. A write that changes nothing
// still costs a write, moves its timestamps, wakes every listener on the
// document and fires its triggers.
//
// Values are compared as Firestore stores them with `ignoreUndefinedProperties`
// (firebaseAdmin.js): a property whose value is undefined is not stored.

const { isDeepStrictEqual } = require('node:util');

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/** `value` as it is stored: undefined properties left out, at any depth. */
function stored(value) {
    if (Array.isArray(value)) return value.map(stored);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stored(entry)]));
}

/** Whether `next`, written, would store exactly what `current` holds. */
function sameStoredValue(current, next) {
    return isDeepStrictEqual(stored(current), stored(next));
}

/**
 * Whether `set(data, { merge: true })` on a document holding `current` (its
 * data, or undefined when there is none) would change any field, the top-level
 * fields named in `ignore` aside. As the Admin SDK merges: a non-empty map is
 * merged key by key; anything else, an empty map included, replaces the field;
 * `deleteSentinel` removes it; an undefined value writes nothing.
 */
function mergeWouldChange(current, data, { deleteSentinel, ignore = [] } = {}) {
    const holds = isPlainObject(current) ? current : {};
    for (const [key, value] of Object.entries(data)) {
        if (ignore.includes(key) || value === undefined) continue;
        const before = holds[key];
        if (deleteSentinel !== undefined && value === deleteSentinel) {
            if (before !== undefined) return true;
            continue;
        }
        if (isPlainObject(value) && Object.keys(value).length > 0) {
            if (before !== undefined && !isPlainObject(before)) return true;
            if (mergeWouldChange(before, value, { deleteSentinel })) return true;
            continue;
        }
        if (!sameStoredValue(before, value)) return true;
    }
    return false;
}

module.exports = { mergeWouldChange, sameStoredValue };
