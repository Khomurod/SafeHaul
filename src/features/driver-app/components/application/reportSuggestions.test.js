import { describe, expect, it } from 'vitest';
import {
    carrierAlreadyListed,
    describeSighting,
    employerFromCarrier,
    formatMonth,
    integrationEnabled,
    licenseFillPlan,
    licensePatch,
    normalizeLicenseClass,
    violationAlreadyListed,
    violationFromSuggestion,
} from './reportSuggestions';
import { EMPTY_EMPLOYER } from './steps/components/employmentRowShapes';

describe('integrationEnabled', () => {
    it('is on only for an explicit boolean true on the public profile', () => {
        expect(integrationEnabled({ applicationIntegrations: { psp: { enabled: true } } }, 'psp')).toBe(true);
        expect(integrationEnabled({ applicationIntegrations: { psp: { enabled: 'true' } } }, 'psp')).toBe(false);
        expect(integrationEnabled({ applicationIntegrations: { psp: { enabled: true } } }, 'mvr')).toBe(false);
        expect(integrationEnabled({}, 'psp')).toBe(false);
        expect(integrationEnabled(null, 'psp')).toBe(false);
    });
});

describe('carrier suggestions', () => {
    const acme = { name: 'Acme Trucking', dotNumber: '123456', firstSeen: '2024-03', lastSeen: '2025-01', recordType: 'inspection' };

    it('recognises a carrier already listed by USDOT number or by name', () => {
        expect(carrierAlreadyListed([{ companyName: 'Other', dotNumber: 'USDOT 123456' }], acme)).toBe(true);
        expect(carrierAlreadyListed([{ companyName: '  acme   trucking ', dotNumber: '' }], acme)).toBe(true);
        expect(carrierAlreadyListed([{ companyName: 'Other', dotNumber: '999' }], acme)).toBe(false);
        expect(carrierAlreadyListed(undefined, acme)).toBe(false);
    });

    it('builds an employer row holding the name and number only — no dates', () => {
        const row = employerFromCarrier(acme, 7);
        expect(row).toEqual({ ...EMPTY_EMPLOYER, id: 7, companyName: 'Acme Trucking', dotNumber: '123456' });
        expect(row.startDate).toBe('');
        expect(row.endDate).toBe('');
    });

    it('describes the sighting as what the report proves', () => {
        expect(describeSighting(acme)).toBe('On inspection records from Mar 2024 to Jan 2025');
        expect(describeSighting({ ...acme, recordType: 'crash', lastSeen: '2024-03' })).toBe('On crash records in Mar 2024');
        expect(describeSighting({ ...acme, recordType: 'both', firstSeen: '', lastSeen: '' })).toBe('On inspection and crash records');
        expect(describeSighting({ name: 'X', recordType: 'unknown', firstSeen: '', lastSeen: '2024-07' })).toBe('On records in Jul 2024');
    });

    it('formats months and passes anything else through', () => {
        expect(formatMonth('2024-03')).toBe('Mar 2024');
        expect(formatMonth('2024-03-15')).toBe('Mar 2024');
        expect(formatMonth('')).toBe('');
        expect(formatMonth('spring')).toBe('spring');
    });
});

describe('violation suggestions', () => {
    const speeding = { date: '2023-07-04', charge: 'Speeding 15 over', location: 'Dallas, TX' };

    it('recognises the same charge on the same date, and treats a missing date as a match', () => {
        expect(violationAlreadyListed([{ date: '2023-07-04', charge: 'speeding 15 over' }], speeding)).toBe(true);
        expect(violationAlreadyListed([{ date: '', charge: 'Speeding 15 over' }], speeding)).toBe(true);
        expect(violationAlreadyListed([{ date: '2022-01-01', charge: 'Speeding 15 over' }], speeding)).toBe(false);
        expect(violationAlreadyListed([], speeding)).toBe(false);
    });

    it('never offers a suggestion without a charge', () => {
        expect(violationAlreadyListed([], { date: '2023-07-04', charge: '' })).toBe(true);
    });

    it('builds a row in the wizard shape with the penalty left to the applicant', () => {
        expect(violationFromSuggestion(speeding, 3)).toEqual({ id: 3, date: '2023-07-04', charge: 'Speeding 15 over', location: 'Dallas, TX', penalty: '' });
    });
});

describe('license fill plan', () => {
    const license = { cdlNumber: 'TX1234567', cdlState: 'tx', cdlClass: 'A', cdlExpiration: '2030-12-31', endorsements: ['H', 'N', 'Q'] };

    it('fills only empty fields and keeps every entry the applicant already made', () => {
        const plan = licenseFillPlan({ cdlNumber: 'MINE', cdlClass: '' }, license);
        expect(plan.map((row) => [row.id, row.action])).toEqual([
            ['cdlNumber', 'keep'],
            ['cdlState', 'fill'],
            ['cdlClass', 'fill'],
            ['cdlExpiration', 'fill'],
            ['endorsements', 'fill'],
        ]);
        expect(licensePatch(plan)).toEqual({ cdlState: 'TX', cdlClass: 'Class A', cdlExpiration: '2030-12-31', endorsements: 'H,N' });
        expect(licensePatch(plan)).not.toHaveProperty('cdlNumber');
    });

    it('offers nothing for a value the form cannot hold', () => {
        const plan = licenseFillPlan({}, { cdlClass: 'Commercial', cdlExpiration: '2030-12', endorsements: ['Z'] });
        expect(plan.find((row) => row.id === 'cdlClass').action).toBe('none');
        expect(plan.find((row) => row.id === 'cdlExpiration').action).toBe('none');
        expect(plan.find((row) => row.id === 'endorsements').action).toBe('none');
        expect(licensePatch(plan)).toEqual({});
    });

    it.each([
        ['Class A', 'Class A'],
        ['class b', 'Class B'],
        ['C', 'Class C'],
        ['non-cdl', 'Non-CDL'],
        ['Non CDL', 'Non-CDL'],
        ['Motorcycle', ''],
        ['', ''],
    ])('maps %p to %p', (raw, expected) => {
        expect(normalizeLicenseClass(raw)).toBe(expected);
    });
});
