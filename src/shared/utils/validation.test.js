import { describe, expect, it } from 'vitest';
import { isValidEmail, isWellFormedEmail } from './validation';

describe('isWellFormedEmail', () => {
    it.each([
        'dispatch@acme.com',
        'Dispatch.Team+hr@Acme-Trucking.co.uk',
        'hr@acmetransport.test',
        "o'brien@haul.ca",
    ])('accepts %p', (email) => {
        expect(isWellFormedEmail(email)).toBe(true);
    });

    // Each of these is in FMCSA's census email column (2026-10-07).
    it.each([
        'NONE',
        '000000',
        'boblucey@aol..com',
        'jrouse247@aol,com',
        'bulltsh_1 @msn.com',
        'DBTESLA@HOTMAIL',
        'mace@mace_usa.com',
        'narvaexpress@.hotmail.com',
        'rkitransport@sbcglobal.net.',
        'antdero@cox.net/harveysseafood@cox.net',
        '',
        null,
        undefined,
    ])('refuses %p', (email) => {
        expect(isWellFormedEmail(email)).toBe(false);
    });

    it('refuses a local part longer than 64 characters, as the verification request does', () => {
        expect(isWellFormedEmail(`${'a'.repeat(64)}@acme.com`)).toBe(true);
        expect(isWellFormedEmail(`${'a'.repeat(65)}@acme.com`)).toBe(false);
    });

    it('is stricter than isValidEmail, which stays as it was', () => {
        expect(isValidEmail('boblucey@aol..com')).toBe(true);
        expect(isWellFormedEmail('boblucey@aol..com')).toBe(false);
    });
});
