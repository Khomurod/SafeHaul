import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
    it('takes the first letter of the first two words, in capitals', () => {
        expect(initialsOf('Maria Garcia')).toBe('MG');
        expect(initialsOf('ana lucia Ferreira-Montgomery')).toBe('AL');
        expect(initialsOf('E2E Admin')).toBe('EA');
    });

    it('shows one letter for one word', () => {
        expect(initialsOf('company_admin')).toBe('C');
        expect(initialsOf('Cher')).toBe('C');
    });

    it('does not lose the second initial to extra whitespace', () => {
        expect(initialsOf('  Maria   Garcia  ')).toBe('MG');
        expect(initialsOf('Maria\tGarcia')).toBe('MG');
    });

    it('skips a word that holds no letter or digit, and a leading mark inside a word', () => {
        expect(initialsOf('— Maria & Garcia')).toBe('MG');
        expect(initialsOf('(Maria) Garcia')).toBe('MG');
    });

    it('keeps a letter outside ASCII whole', () => {
        expect(initialsOf('Đorđe Šimić')).toBe('ĐŠ');
        expect(initialsOf('Ölçer Ünal')).toBe('ÖÜ');
    });

    it('returns nothing when there is no name to abbreviate', () => {
        for (const value of [undefined, null, '', '   ', '— &', 42, {}]) {
            expect(initialsOf(value)).toBe('');
        }
    });
});
