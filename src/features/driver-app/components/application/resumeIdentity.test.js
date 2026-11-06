// What another device finds a saved application by, and whether the server has
// confirmed holding it. Artificial identities only.
import { describe, expect, it } from 'vitest';
import { canBeFoundElsewhere, heldIdentityTracker, resumeIdentityOf } from './resumeIdentity';

const IDENTIFIED = {
    lastName: 'Driver',
    dob: '1984-03-14',
    ssn: '123-45-6789',
    email: 'ada@example.com',
    phone: '5125550142',
};

describe('resumeIdentityOf', () => {
    it('needs a last name, a date of birth, a nine-digit SSN and an email or a ten-digit phone', () => {
        expect(resumeIdentityOf(IDENTIFIED)).not.toBeNull();
        expect(resumeIdentityOf({ ...IDENTIFIED, email: '' })).not.toBeNull();
        expect(resumeIdentityOf({ ...IDENTIFIED, email: '', phone: '555-0101' })).toBeNull();
        expect(resumeIdentityOf({ ...IDENTIFIED, lastName: ' ' })).toBeNull();
        expect(resumeIdentityOf({ ...IDENTIFIED, dob: '' })).toBeNull();
        expect(resumeIdentityOf({ ...IDENTIFIED, ssn: '123-45-678' })).toBeNull();
        expect(resumeIdentityOf(undefined)).toBeNull();
        expect(canBeFoundElsewhere(IDENTIFIED)).toBe(true);
    });

    it('reads a phone as the server does: punctuation and a leading US 1 aside', () => {
        expect(resumeIdentityOf({ ...IDENTIFIED, phone: '+1 (512) 555-0142' }))
            .toBe(resumeIdentityOf(IDENTIFIED));
    });

    it('changes with any fact another device is matched on', () => {
        const base = resumeIdentityOf(IDENTIFIED);
        for (const change of [{ lastName: 'Rider' }, { dob: '1984-03-15' }, { ssn: '123-45-6780' }, { email: 'pat@example.com' }]) {
            expect(resumeIdentityOf({ ...IDENTIFIED, ...change })).not.toBe(base);
        }
        // The first name is not one of them.
        expect(resumeIdentityOf({ ...IDENTIFIED, firstName: 'Ada' })).toBe(base);
    });
});

describe('heldIdentityTracker', () => {
    it('holds the identity of a save the server confirmed, and only that one', () => {
        const server = heldIdentityTracker();
        expect(server.holds(IDENTIFIED)).toBe(false);

        server.record(IDENTIFIED, { saved: true });
        expect(server.holds(IDENTIFIED)).toBe(true);
        expect(server.holds({ ...IDENTIFIED, ssn: '987-65-4321' })).toBe(false);
    });

    it('does not take an SSN from a save that failed after one without it was confirmed', () => {
        const server = heldIdentityTracker();
        server.record({ ...IDENTIFIED, ssn: '' }, { saved: true });

        // The save carrying the new SSN did not land (`saved: false`, or no answer).
        server.record(IDENTIFIED, { saved: false });
        server.record(IDENTIFIED, undefined);

        expect(server.holds(IDENTIFIED)).toBe(false);
    });

    it('keeps the last confirmed identity when a later save fails', () => {
        const server = heldIdentityTracker();
        server.record(IDENTIFIED, { saved: true });
        server.record({ ...IDENTIFIED, ssn: '987-65-4321' }, { saved: false });

        expect(server.holds(IDENTIFIED)).toBe(true);
        expect(server.holds({ ...IDENTIFIED, ssn: '987-65-4321' })).toBe(false);
    });
});
