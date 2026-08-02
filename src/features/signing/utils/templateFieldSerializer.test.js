import { describe, it, expect } from 'vitest';
import {
    serializeTemplateField,
    serializeTemplateFields,
} from './templateFieldSerializer';

// Recursively assert no value anywhere in the object is `undefined`,
// because Firestore rejects such writes ("Unsupported field value: undefined").
function assertNoUndefined(obj, path = 'root') {
    expect(obj, `${path} should not be undefined`).not.toBe(undefined);
    if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
            assertNoUndefined(v, `${path}.${k}`);
        }
    }
}

describe('serializeTemplateField — Firestore-safe output', () => {
    it('produces a fully-defined doc from a complete field', () => {
        const out = serializeTemplateField({
            id: 'f1', type: 'signature', label: 'Sign here', page: 2,
            x: 10.5, y: 20.25, width: 30, height: 8, required: false,
            defaultValue: '{{full_name}}', readOnly: false,
            prefillPolicy: 'editable', bindingKey: 'full_name',
            prefillGroupKey: 'sig_group', fontSize: '12',
        });
        expect(out).toEqual({
            id: 'f1', type: 'signature', label: 'Sign here', pageNumber: 2,
            xPosition: 10.5, yPosition: 20.25, width: 30, height: 8,
            required: false, defaultValue: '{{full_name}}', readOnly: false,
            prefillPolicy: 'editable', bindingKey: 'full_name',
            prefillGroupKey: 'sig_group', fontSize: '12',
        });
        assertNoUndefined(out);
    });

    it('never emits undefined even for a completely empty field', () => {
        const out = serializeTemplateField({});
        assertNoUndefined(out);
        expect(typeof out.id).toBe('string');
        expect(out.id.length).toBeGreaterThan(0);
        expect(out.type).toBe('text');
        expect(out.label).toBe('Field');
        expect(out.pageNumber).toBe(1);
        expect(out.xPosition).toBe(0);
        expect(out.yPosition).toBe(0);
        expect(out.width).toBe(25);
        expect(out.height).toBe(5);
        expect(out.required).toBe(true);
        expect(out.prefillPolicy).toBe('editable');
    });

    it('coerces missing/NaN coordinates to safe finite numbers', () => {
        const out = serializeTemplateField({
            id: 'f2', type: 'text', label: 'X',
            x: undefined, y: NaN, width: null, height: 'oops', page: undefined,
        });
        expect(out.xPosition).toBe(0);
        expect(out.yPosition).toBe(0);
        expect(out.width).toBe(25);
        expect(out.height).toBe(5);
        expect(out.pageNumber).toBe(1);
        assertNoUndefined(out);
    });

    it('derives readOnly from a locked prefill policy', () => {
        const out = serializeTemplateField({
            id: 'f3', type: 'date', label: 'Date', prefillPolicy: 'locked',
        });
        expect(out.prefillPolicy).toBe('locked');
        expect(out.readOnly).toBe(true);
    });

    it('falls back to locked policy when readOnly is true but policy is absent', () => {
        const out = serializeTemplateField({ id: 'f4', type: 'date', readOnly: true });
        expect(out.prefillPolicy).toBe('locked');
        expect(out.readOnly).toBe(true);
    });

    it('preserves required:false but defaults a missing required to true', () => {
        expect(serializeTemplateField({ required: false }).required).toBe(false);
        expect(serializeTemplateField({}).required).toBe(true);
        expect(serializeTemplateField({ required: 'yes' }).required).toBe(true); // non-boolean -> default
    });

    it('coerces a numeric defaultValue to a string', () => {
        const out = serializeTemplateField({ defaultValue: 0 });
        // 0 -> '' is acceptable (falls back to empty), but must never be undefined or a number
        expect(typeof out.defaultValue).toBe('string');
        assertNoUndefined(out);
    });
});

describe('serializeTemplateFields — array handling', () => {
    it('drops null/undefined entries and serializes the rest', () => {
        const out = serializeTemplateFields([
            { id: 'a', type: 'text', label: 'A', x: 1, y: 2, width: 3, height: 4 },
            null,
            undefined,
            { id: 'b', type: 'checkbox', label: 'B' },
        ]);
        expect(out).toHaveLength(2);
        expect(out[0].id).toBe('a');
        expect(out[1].id).toBe('b');
        out.forEach((f) => assertNoUndefined(f));
    });

    it('returns an empty array for non-array / empty input', () => {
        expect(serializeTemplateFields(undefined)).toEqual([]);
        expect(serializeTemplateFields(null)).toEqual([]);
        expect(serializeTemplateFields('nope')).toEqual([]);
        expect(serializeTemplateFields([])).toEqual([]);
    });

    it('guarantees JSON round-trips without dropping keys (no undefined holes)', () => {
        const out = serializeTemplateFields([{ id: 'x' }]);
        const round = JSON.parse(JSON.stringify(out));
        expect(round).toEqual(out);
    });
});
