/**
 * A company's details read from either shape its document can hold.
 * All names and numbers are artificial test fixtures.
 */
import { describe, expect, it } from 'vitest';
import { companyDetailsFields, companyDetailsOf } from './companyDetails';

const FLAT = {
    companyName: 'Artificial Freight Co',
    dotNumber: '1234567',
    mcNumber: 'MC-987654',
    email: 'hr@example.test',
    phone: '555-0100',
    address: '1 Test Way',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
};

const DETAILS = {
    phone: '555-0100',
    email: 'hr@example.test',
    street: '1 Test Way',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
    mcNumber: 'MC-987654',
    dotNumber: '1234567',
};

describe('companyDetailsOf', () => {
    it('reads a company created with flat details, its address the street line', () => {
        expect(companyDetailsOf(FLAT)).toEqual(DETAILS);
    });

    it('reads the nested details Edit Company and Settings save', () => {
        expect(companyDetailsOf({
            legal: { dotNumber: '1234567', mcNumber: 'MC-987654' },
            contact: { email: 'hr@example.test', phone: '555-0100' },
            address: { street: '1 Test Way', city: 'Springfield', state: 'IL', zip: '62701' },
        })).toEqual(DETAILS);
    });

    it('prefers a saved nested value and fills a blank one from the flat field', () => {
        expect(companyDetailsOf({
            ...FLAT,
            legal: { dotNumber: '7654321', mcNumber: '' },
            contact: { email: 'ops@example.test', phone: '  ' },
            address: { street: '', city: 'Shelbyville', state: '', zip: '' },
        })).toEqual({
            ...DETAILS,
            dotNumber: '7654321',
            email: 'ops@example.test',
            // The saved `address` object took the flat street line's key.
            street: '',
            city: 'Shelbyville',
        });
    });

    it('gives empty strings for a company without details', () => {
        expect(companyDetailsOf(undefined)).toEqual({
            phone: '', email: '', street: '', city: '', state: '', zip: '', mcNumber: '', dotNumber: '',
        });
        expect(companyDetailsOf({ dotNumber: 1234567 }).dotNumber).toBe('1234567');
    });
});

describe('companyDetailsFields', () => {
    it('saves the details in the nested shape the application PDF reads', () => {
        expect(companyDetailsFields(DETAILS)).toEqual({
            contact: { phone: '555-0100', email: 'hr@example.test' },
            address: { street: '1 Test Way', city: 'Springfield', state: 'IL', zip: '62701' },
            legal: { mcNumber: 'MC-987654', dotNumber: '1234567' },
        });
    });

    it('reads back what it saves', () => {
        expect(companyDetailsOf(companyDetailsFields(DETAILS))).toEqual(DETAILS);
    });

    it('saves the flat copies a company holds with the same values, so a cleared detail stays cleared', () => {
        const edited = { ...DETAILS, mcNumber: '', phone: '555-0199' };
        const fields = companyDetailsFields(edited, FLAT);

        expect(fields).toEqual({
            contact: { phone: '555-0199', email: 'hr@example.test' },
            address: { street: '1 Test Way', city: 'Springfield', state: 'IL', zip: '62701' },
            legal: { mcNumber: '', dotNumber: '1234567' },
            phone: '555-0199',
            email: 'hr@example.test',
            city: 'Springfield',
            state: 'IL',
            zip: '62701',
            mcNumber: '',
            dotNumber: '1234567',
        });
        expect(companyDetailsOf({ ...FLAT, ...fields })).toEqual(edited);
    });

    it('adds no flat field a company does not hold', () => {
        const nestedCompany = companyDetailsFields(DETAILS);
        expect(Object.keys(companyDetailsFields(DETAILS, nestedCompany))).toEqual(['contact', 'address', 'legal']);
        expect(Object.keys(companyDetailsFields(DETAILS, { companyName: 'Artificial Freight Co', dotNumber: '1234567' })))
            .toEqual(['contact', 'address', 'legal', 'dotNumber']);
    });
});
