/**
 * What the driver is shown when a company edits their employment history.
 *
 * The generic preview renders any array as "N item(s)", so this change read
 * **"2 item(s) → 1 item(s)"** and the driver was asked to approve or reject it.
 * The one thing they need to know is which employer went, and 49 CFR
 * 391.21(b)(10) makes the answer consequential — the application has to account
 * for three years, and the row a recruiter removed may be the reason it does.
 */
import { describe, it, expect } from 'vitest';
import { employerLabel, isEmployerChange, summarizeEmployerChange } from './employerChangeSummary';

const ABC = { employerId: 'aaaaaaaaaaaa', companyName: 'ABC Trucking', startDate: '2020-01', endDate: '2022-06' };
const XYZ = { employerId: 'bbbbbbbbbbbb', companyName: 'XYZ Transport', startDate: '2022-07' };

describe('summarizeEmployerChange', () => {
    it('names the employer that was removed', () => {
        const result = summarizeEmployerChange([ABC, XYZ], [XYZ]);

        expect(result.removed).toEqual([{ label: 'ABC Trucking' }]);
        expect(result.added).toEqual([]);
        expect(result.changed).toEqual([]);
        expect(result.unchanged).toBe(1);
    });

    it('names the employer that was added', () => {
        const added = { companyName: 'New Freight Co' };
        const result = summarizeEmployerChange([ABC], [ABC, added]);

        expect(result.added).toEqual([{ label: 'New Freight Co' }]);
        expect(result.removed).toEqual([]);
    });

    it('reads a rename as a CHANGE, not as a removal plus an addition', () => {
        // The distinction the driver is being asked about, and the one position
        // cannot tell apart. Matching is by the stable employer identity.
        const renamed = { ...ABC, companyName: 'ABC Trucking LLC' };
        const result = summarizeEmployerChange([ABC], [renamed]);

        expect(result.removed).toEqual([]);
        expect(result.added).toEqual([]);
        expect(result.changed).toEqual([{
            label: 'ABC Trucking',
            fields: [{ label: 'Company', from: 'ABC Trucking', to: 'ABC Trucking LLC' }],
        }]);
    });

    it('lists every field that moved, and nothing that did not', () => {
        const result = summarizeEmployerChange(
            [ABC],
            [{ ...ABC, endDate: '2022-08', reasonForLeaving: 'Better route' }],
        );

        expect(result.changed[0].fields).toEqual([
            { label: 'To', from: '2022-06', to: '2022-08' },
            { label: 'Reason for leaving', from: '', to: 'Better route' },
        ]);
    });

    it('is unmoved by a reorder, because identity is not position', () => {
        const result = summarizeEmployerChange([ABC, XYZ], [XYZ, ABC]);

        expect(result.added).toEqual([]);
        expect(result.removed).toEqual([]);
        expect(result.changed).toEqual([]);
        expect(result.unchanged).toBe(2);
    });

    it('ignores the verification mirror entirely', () => {
        // It is not the driver's to approve, and the server strips it anyway. A
        // verification that completed while this review waited must not read as a
        // change the company proposed.
        const result = summarizeEmployerChange(
            [{ ...ABC, verification: { status: 'Completed' } }],
            [{ ...ABC, verification: undefined }],
        );

        expect(result.changed).toEqual([]);
        expect(result.unchanged).toBe(1);
    });

    it('reads a legacy row by its own field names', () => {
        const legacy = { employerId: 'cccccccccccc', name: 'Old Hauling', reason: 'Laid off' };
        const result = summarizeEmployerChange(
            [legacy],
            [{ ...legacy, companyName: 'Old Hauling Inc' }],
        );

        expect(result.changed).toEqual([{
            label: 'Old Hauling',
            fields: [{ label: 'Company', from: 'Old Hauling', to: 'Old Hauling Inc' }],
        }]);
    });

    it('falls back to a position when a row has no name at all', () => {
        expect(employerLabel({}, 2)).toBe('Employer 2');
        expect(summarizeEmployerChange([], [{}]).added).toEqual([{ label: 'Employer 1' }]);
    });

    it('treats an id-less row as its own thing, because nothing identifies it', () => {
        const result = summarizeEmployerChange([{ companyName: 'Nameless Co' }], []);
        expect(result.removed).toEqual([{ label: 'Nameless Co' }]);
    });

    it('survives a missing or malformed value', () => {
        expect(summarizeEmployerChange(undefined, undefined))
            .toEqual({ added: [], removed: [], changed: [], unchanged: 0 });
        expect(summarizeEmployerChange(null, [ABC]).added).toEqual([{ label: 'ABC Trucking' }]);
    });
});

describe('isEmployerChange', () => {
    it('claims the employers field and nothing else', () => {
        expect(isEmployerChange('employers')).toBe(true);
        expect(isEmployerChange('violations')).toBe(false);
        expect(isEmployerChange('firstName')).toBe(false);
    });
});
