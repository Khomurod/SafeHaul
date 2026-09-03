/**
 * Putting what the documents said into the application.
 *
 * The rule under test is one sentence: fill what is empty, keep what is there,
 * and say which. Everything else is the shape of the rows it produces, which has
 * to match the rows the driver's own import produces — the same mappers make
 * both, and a lock on one side has to find its row on the other.
 */
import { describe, expect, it } from 'vitest';
import { applyExtractedFields } from './applyExtractedFields';

const EXTRACTED = {
    driver: {
        firstName: 'Dana', lastName: 'Alvarez', dateOfBirth: '1988-03-11',
        fullAddress: '1 Main St, Dallas, TX 75001',
    },
    license: {
        cdlNumber: 'TX1234567', cdlState: 'TX', cdlClass: 'Class A',
        cdlExpiration: '2030-12-31', endorsements: ['H', 'N'], medCardExpiration: '2027-06-30',
    },
    carriers: [{ name: 'Acme Trucking', dotNumber: '123456', firstSeen: '2024-03', lastSeen: '2025-01', recordType: 'inspection' }],
    violations: [{ date: '2023-07-04', charge: 'Speeding 15 over', location: 'Dallas, TX', source: 'psp' }],
    unreadable: [],
};

const OPTIONS = { now: 1000 };

describe('filling an empty application', () => {
    it('fills the driver, the address and the licence', () => {
        const { formData, added } = applyExtractedFields({}, EXTRACTED, OPTIONS);

        expect(formData).toMatchObject({
            firstName: 'Dana', lastName: 'Alvarez', dob: '1988-03-11',
            street: '1 Main St', city: 'Dallas', state: 'TX', zip: '75001',
            cdlNumber: 'TX1234567', cdlState: 'TX', cdlClass: 'Class A',
            cdlExpiration: '2030-12-31', endorsements: 'H,N', medCardExpiration: '2027-06-30',
        });
        expect(added.fields).toBeGreaterThan(8);
    });

    it('turns a PSP carrier into an employer row holding identity and nothing else', () => {
        const { formData, added } = applyExtractedFields({}, EXTRACTED, OPTIONS);

        expect(formData.employers).toHaveLength(1);
        expect(formData.employers[0]).toMatchObject({ companyName: 'Acme Trucking', dotNumber: '123456' });
        // An inspection date is not a hire date, and the report has nothing else.
        expect(formData.employers[0].startDate).toBe('');
        expect(formData.employers[0].endDate).toBe('');
        expect(formData.employers[0].reasonForLeaving).toBe('');
        expect(added.employers).toBe(1);
    });

    it('returns the carriers to lock, whether or not it added a row for them', () => {
        const { lockedCarriers } = applyExtractedFields({}, EXTRACTED, OPTIONS);
        expect(lockedCarriers).toEqual(EXTRACTED.carriers);
    });

    it('adds violations and answers the question they answer', () => {
        const { formData, added } = applyExtractedFields({}, EXTRACTED, OPTIONS);

        expect(formData.violations).toHaveLength(1);
        expect(formData.violations[0]).toMatchObject({ date: '2023-07-04', charge: 'Speeding 15 over' });
        expect(formData['has-violations']).toBe('yes');
        expect(added.violations).toBe(1);
    });
});

describe('an application the recruiter already typed into', () => {
    const TYPED = {
        firstName: 'Dana Marie',
        cdlNumber: 'MINE-1',
        medCardExpiration: '2028-01-01',
        employers: [{ companyName: 'Acme Trucking', dotNumber: '123456', startDate: '2023-01-01' }],
        violations: [{ date: '2023-07-04', charge: 'Speeding 15 over' }],
    };

    it('keeps every value already there, and names them', () => {
        const { formData, kept } = applyExtractedFields(TYPED, EXTRACTED, OPTIONS);

        expect(formData.firstName).toBe('Dana Marie');
        expect(formData.cdlNumber).toBe('MINE-1');
        expect(formData.medCardExpiration).toBe('2028-01-01');
        expect(kept).toEqual(expect.arrayContaining(['firstName', 'cdlNumber', 'medCardExpiration']));
    });

    it('still fills the fields that were blank', () => {
        const { formData } = applyExtractedFields(TYPED, EXTRACTED, OPTIONS);
        expect(formData.lastName).toBe('Alvarez');
        expect(formData.cdlState).toBe('TX');
    });

    it('does not add an employer or a violation it already has', () => {
        const { formData, added } = applyExtractedFields(TYPED, EXTRACTED, OPTIONS);

        expect(formData.employers).toHaveLength(1);
        expect(formData.employers[0].startDate).toBe('2023-01-01');
        expect(formData.violations).toHaveLength(1);
        expect(added).toMatchObject({ employers: 0, violations: 0 });
    });

    it('locks a carrier that was already on the application', () => {
        // Being on the report is what a lock asserts; whether the row happened to
        // be there already has nothing to do with it.
        const { lockedCarriers } = applyExtractedFields(TYPED, EXTRACTED, OPTIONS);
        expect(lockedCarriers).toHaveLength(1);
    });

    it('says nothing was kept when nothing conflicted', () => {
        const { kept } = applyExtractedFields({}, EXTRACTED, OPTIONS);
        expect(kept).toEqual([]);
    });
});

describe('a partial answer', () => {
    it('applies a licence-only reading without inventing the rest', () => {
        const { formData, added } = applyExtractedFields({}, {
            driver: { firstName: 'Dana', lastName: '', dateOfBirth: '', fullAddress: '' },
            license: { cdlNumber: 'TX1234567' },
            carriers: [], violations: [], unreadable: ['psp'],
        }, OPTIONS);

        expect(formData.firstName).toBe('Dana');
        expect(formData.cdlNumber).toBe('TX1234567');
        expect(formData.employers).toEqual([]);
        expect(formData.violations).toEqual([]);
        expect(formData['has-violations']).toBeUndefined();
        expect(added.employers).toBe(0);
    });

    it('survives an empty or missing extraction', () => {
        expect(applyExtractedFields({}, {}, OPTIONS).formData.employers).toEqual([]);
        expect(applyExtractedFields({}, null, OPTIONS).added).toEqual({ employers: 0, violations: 0, fields: 0 });
    });
});
