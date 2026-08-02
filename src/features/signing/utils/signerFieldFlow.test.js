import { describe, expect, it } from 'vitest';
import {
    sortFieldsForFlow,
    isFieldComplete,
    findFirstIncompleteField,
    findNextField,
} from './signerFieldFlow';

const f = (id, overrides = {}) => ({
    id,
    type: 'text',
    required: true,
    pageNumber: 1,
    xPosition: 10,
    yPosition: 10,
    ...overrides,
});

describe('sortFieldsForFlow', () => {
    it('orders by page, then top-to-bottom, then left-to-right', () => {
        const fields = [
            f('p2', { pageNumber: 2, yPosition: 5 }),
            f('low', { yPosition: 80 }),
            f('right', { yPosition: 20, xPosition: 60 }),
            f('left', { yPosition: 20, xPosition: 10 }),
        ];
        expect(sortFieldsForFlow(fields).map((x) => x.id)).toEqual(['left', 'right', 'low', 'p2']);
    });

    it('tolerates string pageNumbers and null entries', () => {
        const fields = [null, f('b', { pageNumber: '2' }), f('a', { pageNumber: '1' })];
        expect(sortFieldsForFlow(fields).map((x) => x.id)).toEqual(['a', 'b']);
    });
});

describe('isFieldComplete', () => {
    it('requires true (not just truthy) for checkboxes', () => {
        const box = f('c', { type: 'checkbox' });
        expect(isFieldComplete(box, 'yes')).toBe(false);
        expect(isFieldComplete(box, true)).toBe(true);
    });

    it('treats whitespace-only text as incomplete', () => {
        expect(isFieldComplete(f('t'), '   ')).toBe(false);
        expect(isFieldComplete(f('t'), 'Jane')).toBe(true);
    });

    it('never blocks on optional or locked fields', () => {
        expect(isFieldComplete(f('o', { required: false }), '')).toBe(true);
        expect(isFieldComplete(f('l', { prefillPolicy: 'locked' }), '')).toBe(true);
    });
});

describe('findFirstIncompleteField / findNextField', () => {
    const ordered = sortFieldsForFlow([
        f('one', { yPosition: 10 }),
        f('locked', { yPosition: 20, prefillPolicy: 'locked' }),
        f('two', { yPosition: 30 }),
        f('optional', { yPosition: 40, required: false }),
    ]);

    it('finds the first required field without a value', () => {
        expect(findFirstIncompleteField(ordered, { one: 'done' })?.id).toBe('two');
        expect(findFirstIncompleteField(ordered, { one: 'a', two: 'b' })).toBeNull();
    });

    it('skips locked fields when advancing', () => {
        expect(findNextField(ordered, 'one')?.id).toBe('two');
    });

    it('returns optional fields in sequence and null at the end', () => {
        expect(findNextField(ordered, 'two')?.id).toBe('optional');
        expect(findNextField(ordered, 'optional')).toBeNull();
        expect(findNextField(ordered, 'missing-id')).toBeNull();
    });
});
