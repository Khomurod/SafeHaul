// How a snapshot is represented in Firestore.
//
// The defect these cover: a repeating answer is rows of cells — an array of
// arrays — and Firestore refuses to store an array inside an array. Every
// application with one filled repeating row was therefore unwritable, on BOTH
// the live submission path and the historical reconstruction, because they share
// the builder. The live path swallowed the error, so applications saved while
// their immutable record and official PDF silently did not exist.
//
// The property being protected is not a shape, it is "Firestore will accept
// this". `findNestedArrayPaths` asserts that directly.

const {
    decodeRepeatingRows,
    decodeStoredSnapshot,
    encodeRepeatingRows,
    encodeSnapshotForStorage,
    findNestedArrayPaths,
} = require('../../shared/submissionSnapshotStorage');

const cell = (label, displayValue) => ({ label, displayValue });

/** A snapshot with two repeating answers, one empty, plus a scalar answer. */
const snapshotWithRows = () => ({
    schemaVersion: 1,
    frozen: true,
    sections: [
        {
            id: 'employment',
            answers: [
                { fieldId: 'employers', repeating: true, rows: [
                    [cell('Employer', 'A'), cell('From', '01/2020')],
                    [cell('Employer', 'B')],
                ] },
                { fieldId: 'unemployment', repeating: true, rows: [] },
                { fieldId: 'first-name', repeating: false, value: 'X' },
            ],
        },
        {
            id: 'addressHistory',
            answers: [
                { fieldId: 'previousAddresses', repeating: true, rows: [[cell('City', 'Y')]] },
            ],
        },
    ],
});

describe('findNestedArrayPaths', () => {
    it('finds an array nested directly in an array', () => {
        expect(findNestedArrayPaths({ a: [[1]] })).toEqual(['$.a[0]']);
    });

    it('accepts an array of maps that each hold an array', () => {
        expect(findNestedArrayPaths({ a: [{ cells: [1, 2] }, { cells: [3] }] })).toEqual([]);
    });

    it('reports every violation, not just the first', () => {
        expect(findNestedArrayPaths({ a: [[1], [2]] })).toHaveLength(2);
    });
});

describe('encoding for storage', () => {
    // The regression test. Before the fix this snapshot could not be written at
    // all, and the error surfaced only against real Firestore.
    it('produces a payload Firestore will accept', () => {
        const raw = snapshotWithRows();
        expect(findNestedArrayPaths(raw).length).toBeGreaterThan(0);
        expect(findNestedArrayPaths(encodeSnapshotForStorage(raw))).toEqual([]);
    });

    it('wraps each row in a map under `cells`', () => {
        expect(encodeRepeatingRows([[cell('A', '1')], [cell('B', '2')]])).toEqual([
            { cells: [cell('A', '1')] },
            { cells: [cell('B', '2')] },
        ]);
    });

    it('is a no-op on rows that are already wrapped, so encoding twice is safe', () => {
        const once = encodeRepeatingRows([[cell('A', '1')]]);
        expect(encodeRepeatingRows(once)).toEqual(once);
    });

    it('leaves an empty row list alone — the shape 33 already-preserved records use', () => {
        expect(encodeRepeatingRows([])).toEqual([]);
    });

    it('leaves `rows: null` alone, because "no columns declared" is a fact about the record', () => {
        const encoded = encodeSnapshotForStorage({
            sections: [{ answers: [{ fieldId: 'employers', repeating: true, rows: null }] }],
        });
        expect(encoded.sections[0].answers[0].rows).toBeNull();
    });

    it('does not mutate the snapshot it was given', () => {
        const raw = snapshotWithRows();
        const before = JSON.stringify(raw);
        encodeSnapshotForStorage(raw);
        expect(JSON.stringify(raw)).toBe(before);
    });

    it('passes through a snapshot with no sections', () => {
        expect(encodeSnapshotForStorage({ schemaVersion: 1 })).toEqual({ schemaVersion: 1 });
        expect(encodeSnapshotForStorage(null)).toBeNull();
    });
});

describe('decoding a stored snapshot', () => {
    // The whole point: what a renderer sees must be exactly what was built.
    it('round-trips the evidentiary content byte for byte', () => {
        const raw = snapshotWithRows();
        expect(decodeStoredSnapshot(encodeSnapshotForStorage(raw))).toEqual(raw);
    });

    it('unwraps rows back into arrays of cells', () => {
        expect(decodeRepeatingRows([{ cells: [cell('A', '1')] }])).toEqual([[cell('A', '1')]]);
    });

    // Records reconstructed before this fix, and any in-memory snapshot that was
    // never written, are already in the rendering shape.
    it('accepts rows that are already arrays, so the pre-fix records still render', () => {
        expect(decodeRepeatingRows([[cell('A', '1')]])).toEqual([[cell('A', '1')]]);
    });

    it('leaves a malformed row visibly malformed rather than coercing it', () => {
        expect(decodeRepeatingRows(['not-a-row'])).toEqual(['not-a-row']);
        expect(decodeRepeatingRows([{ notCells: 1 }])).toEqual([{ notCells: 1 }]);
    });

    it('does not mutate the stored snapshot it was given', () => {
        const stored = encodeSnapshotForStorage(snapshotWithRows());
        const before = JSON.stringify(stored);
        decodeStoredSnapshot(stored);
        expect(JSON.stringify(stored)).toBe(before);
    });

    it('passes through a missing snapshot', () => {
        expect(decodeStoredSnapshot(null)).toBeNull();
        expect(decodeStoredSnapshot(undefined)).toBeUndefined();
    });
});
