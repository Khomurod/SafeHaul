/**
 * The contact half of the resume and "Is this you?" checks: a phone number is
 * the same number with or without the country code, and still has to be one.
 */
const { contactMatches } = require('../../shared/applicationDraft');

describe('contactMatches', () => {
    it('takes a phone with the country code as the same phone without it, either way round', () => {
        expect(contactMatches({ contactPhone: '15551234567' }, { phone: '555-123-4567' })).toBe(true);
        expect(contactMatches({ contactPhone: '5551234567' }, { phone: '+1 (555) 123-4567' })).toBe(true);
        expect(contactMatches({ contactPhone: '5551234567' }, { phone: '(555) 123-4567' })).toBe(true);
    });

    it('still refuses another number, and a stored number too short to be one', () => {
        expect(contactMatches({ contactPhone: '5551234567' }, { phone: '5551234568' })).toBe(false);
        expect(contactMatches({ contactPhone: '1555123' }, { phone: '555123' })).toBe(false);
        expect(contactMatches({ contactPhone: '' }, { phone: '' })).toBe(false);
    });

    it('matches an email regardless of case and spaces, as before', () => {
        expect(contactMatches({ contactEmail: 'Ada@Example.com' }, { email: ' ada@example.com ' })).toBe(true);
        expect(contactMatches({ contactEmail: 'ada@example.com' }, { email: 'bob@example.com' })).toBe(false);
    });
});
