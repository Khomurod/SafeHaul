import { describe, it, expect } from 'vitest';
import { employerRowHasVerifierContact } from '../shared/utils/employmentApplicationHelpers';

describe('employerRowHasVerifierContact', () => {
    it('returns true for 10-digit company phone', () => {
        expect(
            employerRowHasVerifierContact({
                phone: '(555) 123-4567',
            })
        ).toBe(true);
    });

    it('returns true for supervisor phone', () => {
        expect(
            employerRowHasVerifierContact({
                supervisorPhone: '5559876543',
            })
        ).toBe(true);
    });

    it('returns true for valid emails', () => {
        expect(
            employerRowHasVerifierContact({
                companyEmail: 'hr@example.com',
            })
        ).toBe(true);
        expect(
            employerRowHasVerifierContact({
                supervisorEmail: 'boss@example.com',
            })
        ).toBe(true);
    });

    it('returns false when nothing usable is provided', () => {
        expect(employerRowHasVerifierContact({ phone: '555', companyEmail: 'bad' })).toBe(false);
        expect(employerRowHasVerifierContact({})).toBe(false);
    });
});
