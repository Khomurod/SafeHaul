// Field geometry tools: selection, alignment, size matching, snapping,
// duplication and cross-page copying. Every field below is artificial.
import { describe, expect, it } from 'vitest';
import {
    ALIGNMENT_MODES,
    MIN_FIELD_HEIGHT_PCT,
    MIN_FIELD_WIDTH_PCT,
    SNAP_THRESHOLD_PCT,
    alignFields,
    allPages,
    clampFieldToPage,
    copyFieldsToPages,
    countFieldsByPage,
    duplicateField,
    fieldEdges,
    groupFieldsByPage,
    matchFieldSize,
    removeFields,
    snapFieldPosition,
    toggleSelection,
    updateFields,
} from './fieldGeometry';

const field = (id, overrides = {}) => ({
    id,
    type: 'text',
    label: `Field ${id}`,
    bindingKey: '',
    required: true,
    prefillPolicy: 'editable',
    readOnly: false,
    defaultValue: '',
    page: 1,
    x: 10,
    y: 10,
    width: 20,
    height: 5,
    ...overrides,
});

const ids = () => {
    let n = 0;
    return () => {
        n += 1;
        return `new-${n}`;
    };
};

describe('clampFieldToPage', () => {
    it('keeps a field inside the page', () => {
        expect(clampFieldToPage(field('a', { x: 95, width: 20 }))).toMatchObject({ x: 80, width: 20 });
        expect(clampFieldToPage(field('a', { y: 99, height: 10 }))).toMatchObject({ y: 90, height: 10 });
        expect(clampFieldToPage(field('a', { x: -10, y: -5 }))).toMatchObject({ x: 0, y: 0 });
    });

    it('enforces a usable minimum size', () => {
        const clamped = clampFieldToPage(field('a', { width: 0, height: 0 }));
        expect(clamped.width).toBe(MIN_FIELD_WIDTH_PCT);
        expect(clamped.height).toBe(MIN_FIELD_HEIGHT_PCT);
    });

    it('caps a box larger than the page', () => {
        expect(clampFieldToPage(field('a', { x: 0, width: 400 }))).toMatchObject({ x: 0, width: 100 });
    });

    it('substitutes defaults for unusable numbers', () => {
        const clamped = clampFieldToPage(field('a', { x: NaN, width: 'wide' }));
        expect(Number.isFinite(clamped.x)).toBe(true);
        expect(clamped.width).toBe(25);
    });

    it('passes non-objects through untouched', () => {
        expect(clampFieldToPage(null)).toBeNull();
        expect(clampFieldToPage('nope')).toBe('nope');
    });
});

describe('fieldEdges', () => {
    it('derives edges and centres', () => {
        expect(fieldEdges(field('a', { x: 10, y: 20, width: 30, height: 10 }))).toEqual({
            left: 10,
            right: 40,
            top: 20,
            bottom: 30,
            centerX: 25,
            centerY: 25,
            width: 30,
            height: 10,
        });
    });
});

describe('toggleSelection', () => {
    it('replaces the selection on a plain click', () => {
        expect(toggleSelection(['a', 'b'], 'c')).toEqual(['c']);
    });

    it('adds and removes on an additive click', () => {
        expect(toggleSelection(['a'], 'b', true)).toEqual(['a', 'b']);
        expect(toggleSelection(['a', 'b'], 'a', true)).toEqual(['b']);
    });

    it('clears on a plain click with no id', () => {
        expect(toggleSelection(['a'], null)).toEqual([]);
    });

    it('keeps the first selection first, because it is the alignment anchor', () => {
        let selection = toggleSelection([], 'anchor');
        selection = toggleSelection(selection, 'b', true);
        selection = toggleSelection(selection, 'c', true);
        expect(selection[0]).toBe('anchor');
    });
});

describe('alignFields', () => {
    const fields = [
        field('anchor', { x: 10, y: 10, width: 20, height: 6 }),
        field('b', { x: 50, y: 40, width: 10, height: 4 }),
    ];

    it('aligns to the first-selected field, not the bounding box', () => {
        expect(alignFields(fields, ['anchor', 'b'], 'left')[1].x).toBe(10);
        expect(alignFields(fields, ['anchor', 'b'], 'top')[1].y).toBe(10);
    });

    it('aligns right, centre, bottom and middle by edge, not origin', () => {
        expect(alignFields(fields, ['anchor', 'b'], 'right')[1].x).toBe(20); // 30 - 10
        expect(alignFields(fields, ['anchor', 'b'], 'center')[1].x).toBe(15); // 20 - 5
        expect(alignFields(fields, ['anchor', 'b'], 'bottom')[1].y).toBe(12); // 16 - 4
        expect(alignFields(fields, ['anchor', 'b'], 'middle')[1].y).toBe(11); // 13 - 2
    });

    it('never moves the anchor itself', () => {
        const aligned = alignFields(fields, ['anchor', 'b'], 'left');
        expect(aligned[0]).toBe(fields[0]);
    });

    it('leaves fields on another page alone', () => {
        const crossPage = [fields[0], field('b', { page: 2, x: 50 })];
        expect(alignFields(crossPage, ['anchor', 'b'], 'left')[1].x).toBe(50);
    });

    it('does nothing without at least two selected fields or with an unknown mode', () => {
        expect(alignFields(fields, ['anchor'], 'left')).toBe(fields);
        expect(alignFields(fields, ['anchor', 'b'], 'diagonal')).toBe(fields);
        expect(alignFields(fields, ['missing', 'b'], 'left')).toBe(fields);
    });

    it('clamps a field that alignment would push off the page', () => {
        const wide = [field('anchor', { x: 90, width: 10 }), field('b', { x: 10, width: 40 })];
        expect(alignFields(wide, ['anchor', 'b'], 'left')[1].x).toBe(60);
    });

    it('exposes exactly the six documented modes', () => {
        expect(ALIGNMENT_MODES).toEqual(['left', 'center', 'right', 'top', 'middle', 'bottom']);
    });
});

describe('matchFieldSize', () => {
    const fields = [field('anchor', { width: 30, height: 8 }), field('b', { width: 10, height: 3 })];

    it('matches width, height or both to the anchor', () => {
        expect(matchFieldSize(fields, ['anchor', 'b'], 'width')[1]).toMatchObject({ width: 30, height: 3 });
        expect(matchFieldSize(fields, ['anchor', 'b'], 'height')[1]).toMatchObject({ width: 10, height: 8 });
        expect(matchFieldSize(fields, ['anchor', 'b'], 'both')[1]).toMatchObject({ width: 30, height: 8 });
    });

    it('leaves the anchor untouched and needs two fields', () => {
        expect(matchFieldSize(fields, ['anchor', 'b'], 'width')[0]).toBe(fields[0]);
        expect(matchFieldSize(fields, ['anchor'], 'width')).toBe(fields);
    });

    it('clamps a matched size that would overflow the page', () => {
        const edge = [field('anchor', { width: 60 }), field('b', { x: 70, width: 10 })];
        const matched = matchFieldSize(edge, ['anchor', 'b'], 'width')[1];
        expect(matched.x + matched.width).toBeLessThanOrEqual(100);
    });
});

describe('snapFieldPosition', () => {
    it('snaps to the page centre line', () => {
        const result = snapFieldPosition({ id: 'a', x: 39.8, y: 10, width: 20, height: 5, page: 1 }, []);
        // Centre of the box (49.8) is within threshold of 50.
        expect(result.x).toBeCloseTo(40, 5);
        expect(result.guides).toContainEqual({ axis: 'x', at: 50 });
    });

    it('snaps to a page edge', () => {
        const result = snapFieldPosition({ id: 'a', x: 0.3, y: 0.2, width: 20, height: 5, page: 1 }, []);
        expect(result.x).toBe(0);
        expect(result.y).toBe(0);
    });

    it('snaps to another field on the same page', () => {
        const neighbour = field('n', { x: 60, y: 30, width: 20, height: 5 });
        const result = snapFieldPosition(
            { id: 'a', x: 60.4, y: 50, width: 10, height: 5, page: 1 },
            [neighbour],
        );
        expect(result.x).toBe(60);
        expect(result.guides).toContainEqual({ axis: 'x', at: 60 });
    });

    it('ignores fields on other pages', () => {
        const other = field('n', { page: 2, x: 60 });
        const result = snapFieldPosition(
            { id: 'a', x: 60.4, y: 70, width: 10, height: 5, page: 1 },
            [other],
        );
        expect(result.x).toBe(60.4);
    });

    it('never snaps to the field being dragged', () => {
        const self = field('a', { x: 60, y: 30 });
        const result = snapFieldPosition(
            { id: 'a', x: 60.4, y: 70, width: 10, height: 5, page: 1 },
            [self],
        );
        expect(result.x).toBe(60.4);
    });

    it('leaves a position further than the threshold alone', () => {
        const result = snapFieldPosition(
            { id: 'a', x: 30 + SNAP_THRESHOLD_PCT + 1, y: 70, width: 10, height: 5, page: 1 },
            [field('n', { x: 30, y: 20 })],
        );
        expect(result.x).toBeCloseTo(31.8, 5);
        expect(result.guides.filter((g) => g.axis === 'x')).toEqual([]);
    });

    it('keeps the snapped result on the page', () => {
        const result = snapFieldPosition({ id: 'a', x: 99.8, y: 10, width: 20, height: 5, page: 1 }, []);
        expect(result.x + 20).toBeLessThanOrEqual(100);
    });
});

describe('duplicateField', () => {
    it('gives the copy a new id and offsets it so both are visible', () => {
        const copy = duplicateField(field('a'), ids());
        expect(copy.id).toBe('new-1');
        expect(copy.x).toBeGreaterThan(10);
        expect(copy.y).toBeGreaterThan(10);
    });

    it('preserves everything that defines what the field means', () => {
        const original = field('a', {
            type: 'signature',
            label: 'Driver signature',
            bindingKey: 'full_name',
            required: false,
            prefillPolicy: 'locked',
            readOnly: true,
            defaultValue: '{{full_name}}',
            width: 30,
            height: 8,
        });
        expect(duplicateField(original, ids())).toMatchObject({
            type: 'signature',
            label: 'Driver signature',
            bindingKey: 'full_name',
            required: false,
            prefillPolicy: 'locked',
            readOnly: true,
            defaultValue: '{{full_name}}',
            width: 30,
            height: 8,
            page: 1,
        });
    });

    it('clamps a duplicate of a field already at the edge', () => {
        const copy = duplicateField(field('a', { x: 99, y: 99, width: 10, height: 5 }), ids());
        expect(copy.x + copy.width).toBeLessThanOrEqual(100);
        expect(copy.y + copy.height).toBeLessThanOrEqual(100);
    });

    it('returns null for a non-field', () => {
        expect(duplicateField(null, ids())).toBeNull();
    });
});

describe('copyFieldsToPages', () => {
    const fields = [field('a', { page: 1, x: 70, y: 80 }), field('b', { page: 1, x: 10, y: 10 })];

    it('copies to the requested pages with new ids', () => {
        const { fields: next, created } = copyFieldsToPages(fields, ['a'], [2, 3], ids());
        expect(created).toHaveLength(2);
        expect(created.map((f) => f.page)).toEqual([2, 3]);
        expect(new Set(created.map((f) => f.id)).size).toBe(2);
        expect(created.every((f) => f.id !== 'a')).toBe(true);
        expect(next).toHaveLength(4);
    });

    it('preserves relative geometry and meaning on every copy', () => {
        const { created } = copyFieldsToPages(fields, ['a'], [2], ids());
        expect(created[0]).toMatchObject({
            x: 70,
            y: 80,
            width: 20,
            height: 5,
            type: 'text',
            label: 'Field a',
            required: true,
            page: 2,
        });
    });

    it('skips the page the field is already on', () => {
        const { created } = copyFieldsToPages(fields, ['a'], [1, 2], ids());
        expect(created.map((f) => f.page)).toEqual([2]);
    });

    it('copies several selected fields at once', () => {
        const { created } = copyFieldsToPages(fields, ['a', 'b'], [2], ids());
        expect(created).toHaveLength(2);
    });

    it('clamps every copy inside the page', () => {
        const oversized = [field('a', { page: 1, x: 95, width: 20 })];
        const { created } = copyFieldsToPages(oversized, ['a'], [2], ids());
        expect(created[0].x + created[0].width).toBeLessThanOrEqual(100);
    });

    it('does nothing without a selection, targets or valid page numbers', () => {
        expect(copyFieldsToPages(fields, [], [2], ids()).created).toEqual([]);
        expect(copyFieldsToPages(fields, ['a'], [], ids()).created).toEqual([]);
        expect(copyFieldsToPages(fields, ['a'], [0, -1], ids()).created).toEqual([]);
    });

    it('de-duplicates repeated target pages', () => {
        const { created } = copyFieldsToPages(fields, ['a'], [2, 2, 2], ids());
        expect(created).toHaveLength(1);
    });
});

describe('page helpers', () => {
    it('enumerates all pages', () => {
        expect(allPages(3)).toEqual([1, 2, 3]);
        expect(allPages(0)).toEqual([]);
        expect(allPages(null)).toEqual([]);
    });

    it('groups fields by page in page order', () => {
        const grouped = groupFieldsByPage([field('a', { page: 3 }), field('b', { page: 1 }), field('c', { page: 3 })]);
        expect(grouped.map((g) => g.page)).toEqual([1, 3]);
        expect(grouped[1].fields.map((f) => f.id)).toEqual(['a', 'c']);
    });

    it('counts fields per page', () => {
        expect(countFieldsByPage([field('a'), field('b'), field('c', { page: 2 })])).toEqual({ 1: 2, 2: 1 });
        expect(countFieldsByPage([])).toEqual({});
        expect(countFieldsByPage([null])).toEqual({});
    });
});

describe('bulk update and remove', () => {
    const fields = [field('a'), field('b'), field('c')];

    it('patches only the selected fields and clamps the result', () => {
        const next = updateFields(fields, ['a', 'c'], { x: 200 });
        expect(next[0].x).toBe(80);
        expect(next[1]).toBe(fields[1]);
        expect(next[2].x).toBe(80);
    });

    it('accepts a patch function', () => {
        const next = updateFields(fields, ['b'], (f) => ({ ...f, label: `${f.label}!` }));
        expect(next[1].label).toBe('Field b!');
    });

    it('removes a set of fields', () => {
        expect(removeFields(fields, ['a', 'c']).map((f) => f.id)).toEqual(['b']);
        expect(removeFields(fields, [])).toHaveLength(3);
    });
});
