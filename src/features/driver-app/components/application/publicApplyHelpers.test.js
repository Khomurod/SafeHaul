import { describe, it, expect } from 'vitest';
import {
    normalizePostApplicationTemplates,
    buildPostApplyDocErrorMessage,
} from './publicApplyHelpers';

describe('normalizePostApplicationTemplates', () => {
    it('returns [] for non-arrays', () => {
        expect(normalizePostApplicationTemplates(undefined)).toEqual([]);
        expect(normalizePostApplicationTemplates(null)).toEqual([]);
        expect(normalizePostApplicationTemplates('tpl1')).toEqual([]);
    });

    it('legacy string entries default to enabled + REQUIRED', () => {
        expect(normalizePostApplicationTemplates(['tpl1'])).toEqual([
            { templateId: 'tpl1', title: 'Complete Form', enabled: true, required: true, order: 0 },
        ]);
    });

    it('object entries without an explicit required flag default to REQUIRED (backward compat)', () => {
        const [tpl] = normalizePostApplicationTemplates([
            { templateId: 'tpl1', title: 'W-9', enabled: true },
        ]);
        expect(tpl.required).toBe(true);
    });

    it('honors an explicit required: false (optional form)', () => {
        const [tpl] = normalizePostApplicationTemplates([
            { templateId: 'tpl1', title: 'Survey', enabled: true, required: false },
        ]);
        expect(tpl.required).toBe(false);
    });

    it('drops disabled and malformed entries', () => {
        const out = normalizePostApplicationTemplates([
            { templateId: 'off', enabled: false },
            { title: 'no id' },
            42,
            '',
            null,
            { templateId: 'ok' },
        ]);
        expect(out.map((t) => t.templateId)).toEqual(['ok']);
    });

    it('supports legacy id field and trims values', () => {
        const [tpl] = normalizePostApplicationTemplates([{ id: '  tpl9  ', title: '  Lease  ' }]);
        expect(tpl.templateId).toBe('tpl9');
        expect(tpl.title).toBe('Lease');
    });

    it('sorts by explicit order, falling back to array position', () => {
        const out = normalizePostApplicationTemplates([
            { templateId: 'b', order: 5 },
            { templateId: 'a', order: 1 },
            { templateId: 'c' }, // index 2
        ]);
        expect(out.map((t) => t.templateId)).toEqual(['a', 'c', 'b']);
    });
});

describe('buildPostApplyDocErrorMessage', () => {
    it('maps callable error codes to safe, actionable messages', () => {
        expect(buildPostApplyDocErrorMessage({ code: 'functions/resource-exhausted' }))
            .toMatch(/wait a minute/i);
        expect(buildPostApplyDocErrorMessage({ code: 'functions/not-found' }))
            .toMatch(/not available/i);
        expect(buildPostApplyDocErrorMessage({ code: 'functions/permission-denied' }))
            .toMatch(/could not verify/i);
        expect(buildPostApplyDocErrorMessage({ code: 'functions/unavailable' }))
            .toMatch(/network/i);
        expect(buildPostApplyDocErrorMessage({ code: 'functions/internal' }))
            .toMatch(/network/i);
    });

    it('surfaces the server message for failed-precondition (actionable detail)', () => {
        expect(buildPostApplyDocErrorMessage({
            code: 'functions/failed-precondition',
            message: 'Template has locked required fields missing prefill values: Bank Name',
        })).toMatch(/Bank Name/);
    });

    it('falls back to a generic retry message', () => {
        expect(buildPostApplyDocErrorMessage({})).toMatch(/try again/i);
        expect(buildPostApplyDocErrorMessage(new Error('boom'))).toBe('boom');
    });
});
