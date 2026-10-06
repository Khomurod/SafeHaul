import { describe, it, expect } from 'vitest';
import {
    normalizePostApplicationTemplates,
    buildPostApplyDocErrorMessage,
    parseIsoFromLooseDate,
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

describe('parseIsoFromLooseDate', () => {
    it('reads a two-digit year in the nearer century, so a birth year is not in the future', () => {
        // A licence's "03/11/88" used to fill 2088, and the wizard then told the
        // driver they must be at least 21.
        const year = new Date().getFullYear();
        const twoDigits = (value) => String(value % 100).padStart(2, '0');
        expect(parseIsoFromLooseDate('03/11/88')).toBe('1988-03-11');
        expect(parseIsoFromLooseDate(`06/30/${twoDigits(year + 3)}`)).toBe(`${year + 3}-06-30`);
        expect(parseIsoFromLooseDate(`06/30/${twoDigits(year + 20)}`)).toBe(`${year + 20 - 100}-06-30`);
    });

    it('still reads four-digit years and ISO dates as printed', () => {
        expect(parseIsoFromLooseDate('03/11/1988')).toBe('1988-03-11');
        expect(parseIsoFromLooseDate('2030-12-31')).toBe('2030-12-31');
        expect(parseIsoFromLooseDate('')).toBe('');
    });
});
