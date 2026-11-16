/**
 * Whether a write would change what a document holds (`shared/unchangedWrite.js`),
 * judged as Firestore stores it: a merge writes each field it is given, a
 * non-empty map key by key, and a property whose value is undefined is not
 * stored at all. All values are artificial.
 */
const { mergeWouldChange, sameStoredValue } = require('../../shared/unchangedWrite');

const DELETE = { deleteSentinel: true };

describe('sameStoredValue', () => {
    it('compares arrays and maps by value, not by key order', () => {
        expect(sameStoredValue([{ a: 1, b: 'x' }], [{ b: 'x', a: 1 }])).toBe(true);
        expect(sameStoredValue([{ a: 1 }], [{ a: 2 }])).toBe(false);
        expect(sameStoredValue([{ a: 1 }, { a: 2 }], [{ a: 2 }, { a: 1 }])).toBe(false);
    });

    it('reads an undefined property as the stored value without it', () => {
        expect(sameStoredValue([{ role: 'recruiter' }], [{ userId: undefined, role: 'recruiter' }])).toBe(true);
        expect(sameStoredValue(undefined, [])).toBe(false);
    });
});

describe('mergeWouldChange', () => {
    const held = {
        name: 'Artificial Freight',
        updatedAt: { seconds: 1 },
        config: { ssn: 'required', dob: 'optional' },
        rules: { labels: { a: 'A' }, minimumYears: 3, extra: 'left by an older write' },
        list: [{ id: 't-1' }],
    };

    it('is false when every field it writes already holds that value', () => {
        expect(mergeWouldChange(held, {
            name: 'Artificial Freight',
            config: { ssn: 'required', dob: 'optional' },
            rules: { labels: { a: 'A' }, minimumYears: 3 },
            list: [{ id: 't-1' }],
        })).toBe(false);
    });

    it('ignores the named fields, such as a timestamp', () => {
        expect(mergeWouldChange(held, { name: 'Artificial Freight', updatedAt: 'now' }, { ignore: ['updatedAt'] })).toBe(false);
        expect(mergeWouldChange(held, { name: 'Artificial Freight', updatedAt: 'now' })).toBe(true);
    });

    it('is true when a value, a nested value or an array differs', () => {
        expect(mergeWouldChange(held, { name: 'Other Freight' })).toBe(true);
        expect(mergeWouldChange(held, { config: { ssn: 'hidden' } })).toBe(true);
        expect(mergeWouldChange(held, { list: [{ id: 't-1' }, { id: 't-2' }] })).toBe(true);
        expect(mergeWouldChange(held, { brandColor: '#000000' })).toBe(true);
    });

    it('is true for a delete only while the field is there', () => {
        expect(mergeWouldChange(held, { config: { dob: DELETE } }, { deleteSentinel: DELETE })).toBe(true);
        expect(mergeWouldChange(held, { config: { mvrConsent: DELETE } }, { deleteSentinel: DELETE })).toBe(false);
    });

    it('replaces with an empty map rather than merging it', () => {
        expect(mergeWouldChange(held, { rules: { labels: {} } })).toBe(true);
        expect(mergeWouldChange({ rules: { labels: {} } }, { rules: { labels: {} } })).toBe(false);
    });

    it('is true for anything written to a document that does not exist', () => {
        expect(mergeWouldChange(undefined, { name: 'Artificial Freight' })).toBe(true);
    });

    it('writes nothing for an undefined value', () => {
        expect(mergeWouldChange(held, { name: 'Artificial Freight', logoUrl: undefined })).toBe(false);
    });
});
