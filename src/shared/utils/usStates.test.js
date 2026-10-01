import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { US_STATE_NAMES, toUsStateName } from './usStates';
import { parseAddressPartsFromCdl } from './parseCdlAddress';
import { useUtils } from '../hooks/useUtils';

// The USPS codes a licence prints, written out here rather than imported: the
// point is that every one of them lands on a name the pickers list.
const USPS_CODES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
    'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
    'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

describe('toUsStateName', () => {
    it.each([
        ['TX', 'Texas'],
        ['tx', 'Texas'],
        [' Tx ', 'Texas'],
        ['Texas', 'Texas'],
        ['TEXAS', 'Texas'],
        ['new  york', 'New York'],
        ['NC', 'North Carolina'],
        ['WV', 'West Virginia'],
    ])('maps %p to %p', (raw, expected) => {
        expect(toUsStateName(raw)).toBe(expected);
    });

    it.each([
        // The wizard has never offered the District of Columbia; a writer leaves the
        // field for the applicant rather than storing something no picker can show.
        ['DC'],
        ['Ontario'],
        ['T'],
        ['TXX'],
        [''],
        [null],
        [undefined],
    ])('maps %p to nothing', (raw) => {
        expect(toUsStateName(raw)).toBe('');
    });

    it('names every state code a licence address can parse to, except DC', () => {
        const names = USPS_CODES.map((code) => {
            const parsed = parseAddressPartsFromCdl(`1 MAIN ST, SPRINGFIELD, ${code} 12345`);
            expect(parsed.state).toBe(code);
            return toUsStateName(parsed.state);
        });
        expect(new Set(names).size).toBe(50);
        names.forEach((name) => expect(US_STATE_NAMES).toContain(name));
    });
});

describe('the pickers and the writers share one list', () => {
    it('is the list every state picker renders', () => {
        const { result } = renderHook(() => useUtils());
        expect(result.current.states).toBe(US_STATE_NAMES);
        expect(US_STATE_NAMES).toHaveLength(50);
    });
});
