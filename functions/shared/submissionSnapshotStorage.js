// functions/shared/submissionSnapshotStorage.js
//
// How a submission snapshot is REPRESENTED in Firestore — and nothing else.
//
// WHY THIS EXISTS
// ---------------
// A repeating answer is rows of cells: `[[{label, displayValue}, ...], ...]`.
// That is what the record means, and every renderer — the PDF, the recruiter
// view, the driver's own copy — reads it that way.
//
// Firestore will not store it. Its rule is flat: "an array cannot contain
// another array value as an element". A snapshot for a driver who listed even
// one previous address was therefore rejected outright with
// `INVALID_ARGUMENT: Property array contains an invalid nested entity`, and
// because both the live submission handler and the historical reconstruction
// build their records with the same builder, neither could persist one. The
// live handler caught the failure, stamped a `failed` marker and let the
// driver's submission succeed, so the loss was silent: the application saved,
// its immutable record and official PDF did not exist, and nobody was told.
//
// THE FIX IS A REPRESENTATION, NOT A CHANGE TO THE RECORD
// ------------------------------------------------------
// Each row is wrapped in a map on the way to Firestore and unwrapped on the way
// back:
//
//     in memory   [[cellA, cellB], [cellC]]
//     in storage  [{ cells: [cellA, cellB] }, { cells: [cellC] }]
//
// An array of maps, each holding an array, is explicitly supported. Nothing
// about what the record ASSERTS changes: the same cells, in the same order, in
// the same rows. The evidentiary structure every consumer depends on is
// untouched, which is why this fix needs no renderer to change and cannot alter
// a single preserved PDF.
//
// The encoding lives here, at the storage boundary, so the wrapped shape never
// escapes into application code. `decodeStoredSnapshot` is applied to every read
// of a stored snapshot; `encodeSnapshotForStorage` to the one write.
//
// TOLERANCE IS REQUIRED, NOT DEFENSIVE
// ------------------------------------
// Three shapes already exist in production and all three must keep working:
//
//   * `rows: []` — a submitted application with no repeating entries. Identical
//     under both representations, which is why the 33 records reconstructed
//     before this fix are unaffected by it.
//   * `rows: null` / absent — a record written before columns were declared. It
//     keeps its raw records in `value`, and `resolveRepeatingRows` lays them out
//     under current column names.
//   * `rows: [[...]]` — the in-memory shape. Never reachable from Firestore, but
//     decode accepts it so that a snapshot which never round-tripped (the PDF is
//     rendered from the in-memory record on a fresh submission) behaves
//     identically to one that did.

/** The key each wrapped row stores its cells under. */
const ROW_CELLS_KEY = 'cells';

/** A wrapped row, as stored: `{ cells: [...] }`. */
function isWrappedRow(row) {
    return Boolean(row)
        && typeof row === 'object'
        && !Array.isArray(row)
        && Array.isArray(row[ROW_CELLS_KEY]);
}

/**
 * Rows as Firestore can hold them.
 *
 * A row that is already wrapped is passed through, so encoding twice is a no-op
 * and a re-encoded snapshot cannot end up double-wrapped.
 */
function encodeRepeatingRows(rows) {
    if (!Array.isArray(rows)) return rows;
    return rows.map((row) => {
        if (isWrappedRow(row)) return row;
        if (!Array.isArray(row)) return row;
        return { [ROW_CELLS_KEY]: row };
    });
}

/**
 * Rows as every renderer expects them: an array of rows, each an array of cells.
 *
 * Accepts either representation, so a caller never has to know which one it
 * holds. Anything that is not a row shape is passed through untouched rather
 * than coerced — a malformed record must stay visibly malformed, not be quietly
 * turned into an empty one.
 */
function decodeRepeatingRows(rows) {
    if (!Array.isArray(rows)) return rows;
    return rows.map((row) => (isWrappedRow(row) ? row[ROW_CELLS_KEY] : row));
}

/**
 * Apply `transform` to every repeating answer's `rows`, returning a new
 * snapshot. Sections and answers are copied rather than mutated: a stored
 * snapshot handed to a renderer must not be altered under it, and an in-memory
 * one must not be altered by being written.
 */
function mapSnapshotRows(snapshot, transform) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    if (!Array.isArray(snapshot.sections)) return snapshot;

    return {
        ...snapshot,
        sections: snapshot.sections.map((section) => {
            if (!section || !Array.isArray(section.answers)) return section;
            return {
                ...section,
                answers: section.answers.map((answer) => {
                    // `rows: null` means "no columns were declared", which is a
                    // fact about the record. Leave it exactly as it is.
                    if (!answer || !Array.isArray(answer.rows)) return answer;
                    return { ...answer, rows: transform(answer.rows) };
                }),
            };
        }),
    };
}

/** A snapshot Firestore will accept. Call once, immediately before writing. */
function encodeSnapshotForStorage(snapshot) {
    return mapSnapshotRows(snapshot, encodeRepeatingRows);
}

/** A snapshot every consumer can render. Call on every read from Firestore. */
function decodeStoredSnapshot(snapshot) {
    return mapSnapshotRows(snapshot, decodeRepeatingRows);
}

/**
 * Every path in `value` that Firestore would reject for nesting an array
 * directly inside an array. Empty means storable.
 *
 * Exported because this is the property the fix exists to guarantee, and a test
 * that asserts it directly is worth more than one that asserts a shape.
 */
function findNestedArrayPaths(value, path = '$', insideArray = false, found = []) {
    if (Array.isArray(value)) {
        if (insideArray) found.push(path);
        value.forEach((item, index) => findNestedArrayPaths(item, `${path}[${index}]`, true, found));
        return found;
    }
    if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
            findNestedArrayPaths(inner, `${path}.${key}`, false, found);
        }
    }
    return found;
}

module.exports = {
    ROW_CELLS_KEY,
    decodeRepeatingRows,
    decodeStoredSnapshot,
    encodeRepeatingRows,
    encodeSnapshotForStorage,
    findNestedArrayPaths,
    isWrappedRow,
};
