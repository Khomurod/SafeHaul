import { describe, expect, it } from 'vitest';
import { saveBarSummary } from './saveBarSummary';

describe('saveBarSummary', () => {
    it('names one change', () => {
        expect(saveBarSummary(['Full Name'])).toBe('1 change · Full Name');
    });

    it('counts and names several, in the order given', () => {
        expect(saveBarSummary(['SMTP Host', 'Signature'])).toBe('2 changes · SMTP Host, Signature');
    });

    // The bar is never drawn on a clean page; this only keeps the summary non-empty.
    it('never returns an empty summary', () => {
        expect(saveBarSummary([])).toBe('Unsaved changes');
    });
});
