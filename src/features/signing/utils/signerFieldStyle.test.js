import { describe, it, expect } from 'vitest';
import {
    normalizeSignerField,
    getSignerFieldBoxStyle,
    isPercentFieldSize,
} from './signerFieldStyle';

describe('signerFieldStyle', () => {
    it('normalizeSignerField maps legacy x/y to xPosition/yPosition', () => {
        const out = normalizeSignerField({
            id: 'a',
            x: 12,
            y: 34,
            pageNumber: '2',
        });
        expect(out.xPosition).toBe(12);
        expect(out.yPosition).toBe(34);
        expect(out.pageNumber).toBe(2);
    });

    it('getSignerFieldBoxStyle uses percent units when width < 100', () => {
        const style = getSignerFieldBoxStyle({
            xPosition: 5,
            yPosition: 10,
            width: 4,
            height: 3,
        });
        expect(style.left).toBe('5%');
        expect(style.top).toBe('10%');
        expect(style.width).toBe('4%');
        expect(style.height).toBe('3%');
        expect(style.minWidth).toBeUndefined();
        expect(style.minHeight).toBeUndefined();
    });

    it('isPercentFieldSize treats width >= 100 as legacy pixels', () => {
        expect(isPercentFieldSize({ width: 30 })).toBe(true);
        expect(isPercentFieldSize({ width: 160 })).toBe(false);
    });
});
