/**
 * A PSP carrier's contact details from FMCSA, by its exact USDOT number.
 * Artificial carriers only.
 */
import { describe, expect, it } from 'vitest';
import { dotsToLookUp, fillEmployersFromFmcsa } from './fillEmployersFromFmcsa';

const CENSUS = {
    dot_number: '1234567',
    legal_name: 'ACME TRUCKING LLC',
    dba_name: '',
    phy_street: '100 MAIN ST',
    phy_city: 'DALLAS',
    phy_state: 'TX',
    phy_country: 'US',
    phone: '(214) 555-0100',
    email_address: 'NONE',
};

const PSP_ROW = { id: 1, companyName: 'ACME TRUCKING', dotNumber: '1234567', address: '', city: '', state: '', phone: '', companyEmail: '' };

describe('dotsToLookUp', () => {
    it('asks for each USDOT number once, only where a contact field is blank', () => {
        expect(dotsToLookUp([
            PSP_ROW,
            { ...PSP_ROW, id: 2 },
            { ...PSP_ROW, dotNumber: '7654321', address: 'a', city: 'b', state: 'Texas', phone: '1', companyEmail: 'x@y.test' },
            { ...PSP_ROW, dotNumber: '' },
            { ...PSP_ROW, dotNumber: 'MC-1' },
        ])).toEqual(['1234567']);
        expect(dotsToLookUp(undefined)).toEqual([]);
    });
});

describe('fillEmployersFromFmcsa', () => {
    it('fills the blank address, city, state and phone, and nothing FMCSA lacks', () => {
        const { employers, filled, mismatches } = fillEmployersFromFmcsa([PSP_ROW], [CENSUS]);
        expect(filled).toBe(1);
        expect(mismatches).toEqual([]);
        expect(employers[0]).toEqual({
            ...PSP_ROW,
            address: '100 MAIN ST',
            city: 'DALLAS',
            state: 'Texas',
            phone: '(214) 555-0100',
            // "NONE" is no address to write to.
            companyEmail: '',
        });
    });

    it('keeps what is already there, and never touches the name or the USDOT number', () => {
        const typed = { ...PSP_ROW, phone: '(214) 555-9999' };
        const census = { ...CENSUS, legal_name: 'ACME TRUCKING OF TEXAS LLC' };
        const [row] = fillEmployersFromFmcsa([typed], [census]).employers;
        expect(row.phone).toBe('(214) 555-9999');
        expect(row.companyName).toBe('ACME TRUCKING');
        expect(row.dotNumber).toBe('1234567');
        expect(row.address).toBe('100 MAIN ST');
    });

    it('matches only the exact USDOT number, never a name', () => {
        const byName = { ...PSP_ROW, dotNumber: '' };
        const otherNumber = { ...PSP_ROW, dotNumber: '1234568' };
        const result = fillEmployersFromFmcsa([byName, otherNumber], [CENSUS]);
        expect(result.filled).toBe(0);
        expect(result.employers).toEqual([byName, otherNumber]);
    });

    it('reports a census name unlike the row, the sign of a misread number', () => {
        const census = { ...CENSUS, legal_name: 'BLUE RIVER FREIGHT INC' };
        const { filled, mismatches } = fillEmployersFromFmcsa([PSP_ROW], [census]);
        expect(filled).toBe(1);
        expect(mismatches).toEqual([{ companyName: 'ACME TRUCKING', dotNumber: '1234567', censusName: 'BLUE RIVER FREIGHT INC' }]);
    });

    it('accepts the trade name as the same carrier', () => {
        const census = { ...CENSUS, legal_name: 'JOHN SMITH ENTERPRISES INC', dba_name: 'ACME TRUCKING' };
        expect(fillEmployersFromFmcsa([PSP_ROW], [census]).mismatches).toEqual([]);
    });

    it('changes nothing when FMCSA answered nothing', () => {
        const rows = [PSP_ROW];
        const result = fillEmployersFromFmcsa(rows, []);
        expect(result).toEqual({ employers: rows, filled: 0, mismatches: [] });
        expect(result.employers[0]).toBe(PSP_ROW);
    });
});
