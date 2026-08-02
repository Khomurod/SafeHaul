// Signer-preview projection: it must produce exactly what the send path would,
// and must never perform I/O. Every field and recipient below is artificial.
import { describe, expect, it } from 'vitest';
import {
    SAMPLE_RECIPIENT,
    buildSignerPreview,
    previewFieldValues,
    previewFieldsForPage,
} from './signerPreview';
import { serializeTemplateFields } from './templateFieldSerializer';
import { buildPrefillContext, resolveFieldsForSend } from './prefillEngine';

const field = (id, overrides = {}) => ({
    id,
    type: 'text',
    label: `Field ${id}`,
    page: 1,
    x: 10,
    y: 10,
    width: 25,
    height: 5,
    required: true,
    readOnly: false,
    prefillPolicy: 'editable',
    bindingKey: '',
    defaultValue: '',
    fontSize: 'Auto',
    ...overrides,
});

const NOW = new Date('2026-03-04T12:00:00Z');

describe('buildSignerPreview', () => {
    it('produces exactly what the send path would produce', () => {
        const fields = [
            field('a', { bindingKey: 'full_name', defaultValue: '{{full_name}}' }),
            field('b', { type: 'signature', defaultValue: '' }),
        ];

        const preview = buildSignerPreview({
            fields,
            recipientName: 'Artificial Person',
            recipientEmail: 'nobody@example.invalid',
            recipientPhone: '5550000000',
            companyName: 'Artificial Freight Co',
            now: NOW,
        });

        // The same two functions, in the same order, with the same context.
        const context = buildPrefillContext({
            recipientName: 'Artificial Person',
            recipientEmail: 'nobody@example.invalid',
            recipientPhone: '5550000000',
            companyName: 'Artificial Freight Co',
            now: NOW,
        });
        const expected = serializeTemplateFields(resolveFieldsForSend(fields, context).fields);

        expect(preview.fields).toEqual(expected);
    });

    it('emits signer-shaped geometry, not editor-shaped', () => {
        const preview = buildSignerPreview({ fields: [field('a', { page: 2, x: 30, y: 40 })], now: NOW });
        expect(preview.fields[0]).toMatchObject({ pageNumber: 2, xPosition: 30, yPosition: 40 });
        expect(preview.fields[0].page).toBeUndefined();
    });

    it('falls back to an obviously artificial recipient and says so', () => {
        const preview = buildSignerPreview({
            fields: [field('a', { bindingKey: 'full_name', defaultValue: '{{full_name}}' })],
            now: NOW,
        });
        expect(preview.usedSampleRecipient).toBe(true);
        expect(preview.fields[0].defaultValue).toBe(SAMPLE_RECIPIENT.name);
    });

    it('uses the real recipient when the editor has one', () => {
        const preview = buildSignerPreview({
            fields: [field('a', { bindingKey: 'full_name', defaultValue: '{{full_name}}' })],
            recipientName: 'Artificial Person',
            now: NOW,
        });
        expect(preview.usedSampleRecipient).toBe(false);
        expect(preview.fields[0].defaultValue).toBe('Artificial Person');
    });

    it('reports locked required fields the send would block on', () => {
        const preview = buildSignerPreview({
            fields: [
                field('blocked', {
                    label: 'Policy number',
                    required: true,
                    readOnly: true,
                    prefillPolicy: 'locked',
                    bindingKey: 'policy_number',
                    defaultValue: '{{policy_number}}',
                }),
            ],
            recipientName: 'Artificial Person',
            now: NOW,
        });
        expect(preview.missingLockedRequired).toEqual(['Policy number']);
    });

    it('lists what the recipient would still have to complete', () => {
        const preview = buildSignerPreview({
            fields: [
                field('sig', { type: 'signature', required: true }),
                field('prefilled', { required: true, bindingKey: 'full_name', defaultValue: '{{full_name}}' }),
                field('optional', { required: false }),
            ],
            recipientName: 'Artificial Person',
            now: NOW,
        });
        expect(preview.signerCompletes.map((f) => f.id)).toEqual(['sig']);
    });

    it('does not count a locked field as something the signer completes', () => {
        const preview = buildSignerPreview({
            fields: [
                field('locked', {
                    required: true,
                    readOnly: true,
                    prefillPolicy: 'locked',
                    bindingKey: 'full_name',
                    defaultValue: '{{full_name}}',
                }),
            ],
            recipientName: 'Artificial Person',
            now: NOW,
        });
        expect(preview.signerCompletes).toEqual([]);
    });

    it('orders fields the way the signing room does — page, then top, then left', () => {
        const preview = buildSignerPreview({
            fields: [
                field('third', { page: 2, y: 10 }),
                field('second', { page: 1, y: 50, x: 10 }),
                field('first', { page: 1, y: 10 }),
                field('second-b', { page: 1, y: 50, x: 60 }),
            ],
            now: NOW,
        });
        expect(preview.orderedFields.map((f) => f.id)).toEqual(['first', 'second', 'second-b', 'third']);
    });

    it('handles an empty editor', () => {
        const preview = buildSignerPreview({ fields: [], now: NOW });
        expect(preview.fields).toEqual([]);
        expect(preview.orderedFields).toEqual([]);
        expect(preview.signerCompletes).toEqual([]);
        expect(preview.missingLockedRequired).toEqual([]);
    });
});

describe('previewFieldsForPage', () => {
    it('selects the fields on one page', () => {
        const preview = buildSignerPreview({
            fields: [field('a', { page: 1 }), field('b', { page: 2 }), field('c', { page: 2 })],
            now: NOW,
        });
        expect(previewFieldsForPage(preview.orderedFields, 2).map((f) => f.id)).toEqual(['b', 'c']);
        expect(previewFieldsForPage(preview.orderedFields, 9)).toEqual([]);
        expect(previewFieldsForPage(null, 1)).toEqual([]);
    });
});

describe('previewFieldValues', () => {
    it('shows the prefilled value of an editable field', () => {
        const preview = buildSignerPreview({
            fields: [field('a', { bindingKey: 'full_name', defaultValue: '{{full_name}}' })],
            recipientName: 'Artificial Person',
            now: NOW,
        });
        expect(previewFieldValues(preview.fields)).toEqual({ a: 'Artificial Person' });
    });

    it('leaves locked fields to the signer read-only treatment', () => {
        const preview = buildSignerPreview({
            fields: [
                field('locked', {
                    readOnly: true,
                    prefillPolicy: 'locked',
                    bindingKey: 'full_name',
                    defaultValue: '{{full_name}}',
                }),
            ],
            recipientName: 'Artificial Person',
            now: NOW,
        });
        expect(previewFieldValues(preview.fields)).toEqual({});
    });

    it('leaves an empty field empty', () => {
        const preview = buildSignerPreview({ fields: [field('a', { type: 'signature' })], now: NOW });
        expect(previewFieldValues(preview.fields)).toEqual({});
        expect(previewFieldValues(null)).toEqual({});
    });
});
