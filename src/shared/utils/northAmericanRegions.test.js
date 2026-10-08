import { describe, expect, it } from 'vitest';
import {
    EMPLOYER_REGION_GROUPS, EMPLOYER_REGION_NAMES, fmcsaRegionOutsideUs, regionNameFromFmcsa,
} from './northAmericanRegions';
import { US_STATE_NAMES } from './usStates';

// Every region code FMCSA's census held for Canada and Mexico on 2026-10-07,
// written out rather than imported: each must land on a listed name. The census
// had no Nunavut carrier; the list offers it anyway.
const CENSUS_CODES = {
    CA: ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'ON', 'PE', 'QC', 'SK', 'YT'],
    MX: [
        'AG', 'BN', 'BS', 'CH', 'CI', 'CL', 'CP', 'CS', 'DF', 'DG', 'GE', 'GJ', 'HD', 'JA', 'MC', 'MR',
        'MX', 'NA', 'NL', 'OA', 'PU', 'QE', 'QI', 'SI', 'SL', 'SO', 'TA', 'TB', 'TL', 'VC', 'YU', 'ZA',
    ],
};

describe('the employer regions', () => {
    it('lists the US states first, then Canada, then Mexico, every name once', () => {
        expect(EMPLOYER_REGION_GROUPS.map((group) => group.label)).toEqual(['United States', 'Canada', 'Mexico']);
        expect(EMPLOYER_REGION_GROUPS[0].options).toBe(US_STATE_NAMES);
        expect(EMPLOYER_REGION_GROUPS.map((group) => group.options.length)).toEqual([51, 13, 32]);
        // A stored name has to say which country it is in.
        expect(new Set(EMPLOYER_REGION_NAMES).size).toBe(EMPLOYER_REGION_NAMES.length);
    });

    it.each(Object.entries(CENSUS_CODES))('names every %s code the census holds', (country, codes) => {
        const group = EMPLOYER_REGION_GROUPS.find((entry) => entry.label === (country === 'CA' ? 'Canada' : 'Mexico'));
        const names = codes.map((code) => regionNameFromFmcsa(country, code));
        expect(names.every((name) => group.options.includes(name))).toBe(true);
        expect(new Set(names).size).toBe(codes.length);
    });
});

describe('regionNameFromFmcsa', () => {
    it.each([
        ['CA', 'NL', 'Newfoundland and Labrador'],
        ['MX', 'NL', 'Nuevo León'],
        // Checked against the cities each code holds: Juárez is in CI, Saltillo in CH.
        ['MX', 'CI', 'Chihuahua'],
        ['MX', 'CH', 'Coahuila'],
        ['MX', 'DF', 'Mexico City'],
        ['MX', 'MX', 'State of Mexico'],
        [' ca ', 'qc', 'Quebec'],
        ['US', 'DC', 'District of Columbia'],
        [null, 'TX', 'Texas'],
        ['', 'TX', 'Texas'],
    ])('reads %p %p as %p', (country, code, expected) => {
        expect(regionNameFromFmcsa(country, code)).toBe(expected);
    });

    it.each([
        ['US', 'PR'],
        ['US', 'Texas'],
        ['GT', 'GU'],
        ['CA', 'TX'],
        ['MX', ''],
        ['CA', null],
    ])('reads %p %p as nothing', (country, code) => {
        expect(regionNameFromFmcsa(country, code)).toBe('');
    });
});

describe('a region outside the US, by its name', () => {
    it.each([
        ['Ontario', { country: 'CA', code: 'ON' }],
        ['Newfoundland and Labrador', { country: 'CA', code: 'NL' }],
        ['Nuevo León', { country: 'MX', code: 'NL' }],
        [' Chihuahua ', { country: 'MX', code: 'CI' }],
        ['Texas', null],
        ['', null],
        [undefined, null],
    ])('%s is %j', (name, expected) => {
        expect(fmcsaRegionOutsideUs(name)).toEqual(expected);
    });

    it('reads every listed name back to the code it was read from', () => {
        for (const [country, codes] of Object.entries(CENSUS_CODES)) {
            for (const code of codes) expect(fmcsaRegionOutsideUs(regionNameFromFmcsa(country, code))).toEqual({ country, code });
        }
    });
});
