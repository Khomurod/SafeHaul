/**
 * The lead import worker's records: a row that gives only a phone is filled in
 * with the shared placeholders (`leadImportPlaceholders.js`), which the lead
 * upload recognises so a re-import never writes one over a lead's real value.
 *
 * All names and phone numbers below are artificial.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LEAD_IMPORT_PLACEHOLDERS } from '@/config/leadImportPlaceholders';

let posted;
beforeAll(async () => {
    vi.spyOn(self, 'postMessage').mockImplementation((message) => { posted = message; });
    await import('./import.worker.js');
});
afterEach(() => { posted = undefined; });

async function parseCsv(text) {
    await self.onmessage({ data: { buffer: new TextEncoder().encode(text).buffer, fileType: 'text/csv', fileName: 'leads.csv' } });
    expect(posted?.success).toBe(true);
    return posted.data;
}

describe('the import worker', () => {
    it('fills a row that gives only a phone with the shared placeholders', async () => {
        const [row] = await parseCsv('Phone\n(555) 123-4567\n');

        expect(row).toMatchObject({
            ...LEAD_IMPORT_PLACEHOLDERS,
            phone: '(555) 123-4567',
            normalizedPhone: '5551234567',
            isEmailPlaceholder: true,
        });
    });

    it('fills only the last name of a one-word name', async () => {
        const [row] = await parseCsv('Name,Phone,Email,Type\nMadonna,5551230000,m@example.com,OTR\n');

        expect(row).toMatchObject({
            firstName: 'Madonna',
            lastName: LEAD_IMPORT_PLACEHOLDERS.lastName,
            email: 'm@example.com',
            isEmailPlaceholder: false,
            driverType: 'OTR',
        });
    });
});

describe("the import worker's column headers", () => {
    it("reads the template's own headers", async () => {
        const [row] = await parseCsv(
            'First Name,Last Name,Email,Phone,City,State,Experience,Job Type\n'
            + 'Ann,Baker,ann@example.com,(555) 123-4567,Austin,TX,5,OTR\n',
        );

        expect(row).toMatchObject({
            firstName: 'Ann', lastName: 'Baker', email: 'ann@example.com', phone: '(555) 123-4567',
            city: 'Austin', state: 'TX', experience: '5', driverType: 'OTR',
        });
    });

    it('reads the usual spellings of a header', async () => {
        const [row] = await parseCsv(
            'Driver Name,E-mail Address,Driver Phone,CDL Experience,Driver Type,State/Province\n'
            + 'Ann Baker,ann@example.com,555.123.4567,3 years,OTR,TX\n',
        );

        expect(row).toMatchObject({
            firstName: 'Ann', lastName: 'Baker', email: 'ann@example.com', phone: '(555) 123-4567',
            experience: '3 years', driverType: 'OTR', state: 'TX',
        });
    });

    it('reads a whole header, not a word inside another column', async () => {
        const [row] = await parseCsv(
            'Mailing Address,Contact Email,Emergency Contact,Phone Number,CDL Expiration,License Type,License State,Full Name\n'
            + '1 Main St,ann@example.com,Bob 5559998888,5551234567,2027-01-31,Class A,NM,Ann Baker\n',
        );

        expect(row).toMatchObject({
            firstName: 'Ann',
            lastName: 'Baker',
            email: 'ann@example.com',
            phone: '(555) 123-4567',
            experience: '',
            driverType: LEAD_IMPORT_PLACEHOLDERS.driverType,
            state: '',
        });
    });
});
