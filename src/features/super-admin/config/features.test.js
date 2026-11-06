import { describe, expect, it } from 'vitest';
import { COMPANY_FEATURES, isFeatureOn } from './features';

const company = (features) => ({ id: 'co-1', features });

describe('company features', () => {
    it('lists the five stored keys in order, Facebook leads under its stored key', () => {
        expect(COMPANY_FEATURES.map(({ key, label }) => [key, label])).toEqual([
            ['pev', 'PEV'],
            ['campaignsEnabled', 'Campaigns'],
            ['eDocs', 'E-Docs'],
            ['importLeads', 'Import Leads'],
            ['callTracking', 'Facebook leads'],
        ]);
    });

    it.each(['pev', 'campaignsEnabled', 'eDocs', 'importLeads'])('keeps %s on unless switched off', (key) => {
        expect(isFeatureOn(company({}), key)).toBe(true);
        expect(isFeatureOn(company(undefined), key)).toBe(true);
        expect(isFeatureOn(null, key)).toBe(true);
        expect(isFeatureOn(company({ [key]: true }), key)).toBe(true);
        expect(isFeatureOn(company({ [key]: false }), key)).toBe(false);
    });

    it('keeps Facebook leads off unless a super admin switched it on', () => {
        expect(isFeatureOn(company({}), 'callTracking')).toBe(false);
        expect(isFeatureOn(company(undefined), 'callTracking')).toBe(false);
        expect(isFeatureOn(null, 'callTracking')).toBe(false);
        expect(isFeatureOn(company({ callTracking: false }), 'callTracking')).toBe(false);
        expect(isFeatureOn(company({ callTracking: true }), 'callTracking')).toBe(true);
    });

    it('reads a key it does not list as every other: on unless switched off', () => {
        expect(isFeatureOn(company({}), 'somethingNew')).toBe(true);
        expect(isFeatureOn(company({ somethingNew: false }), 'somethingNew')).toBe(false);
    });
});
