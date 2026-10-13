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
