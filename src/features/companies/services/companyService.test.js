/**
 * Settings saves the company's details through `saveCompanySettings`, which
 * writes only the fields it knows. All names and numbers are artificial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updateDoc: vi.fn(async () => {}) }));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    getDocs: vi.fn(),
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    getDoc: vi.fn(),
    updateDoc: (...args) => mocks.updateDoc(...args),
    addDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
}));

import { saveCompanySettings } from './companyService';

beforeEach(() => {
    mocks.updateDoc.mockClear();
});

describe('saveCompanySettings', () => {
    it('writes the flat copies a company created with them keeps in step', async () => {
        await saveCompanySettings('company-1', {
            companyName: 'Artificial Freight Co',
            legal: { mcNumber: '', dotNumber: '1234567' },
            mcNumber: '',
            dotNumber: '1234567',
            email: 'hr@example.test',
        });

        expect(mocks.updateDoc).toHaveBeenCalledWith({ path: 'companies/company-1' }, {
            companyName: 'Artificial Freight Co',
            legal: { mcNumber: '', dotNumber: '1234567' },
            mcNumber: '',
            dotNumber: '1234567',
            email: 'hr@example.test',
        });
    });

    it('writes no flat copy a screen did not send', async () => {
        await saveCompanySettings('company-1', { companyLogoUrl: 'https://storage.example.test/logo.png', dotNumber: 1234567 });

        expect(mocks.updateDoc.mock.calls[0][1]).toEqual({ companyLogoUrl: 'https://storage.example.test/logo.png' });
    });

    it('returns exactly what it wrote, so the screen can show it', async () => {
        const written = await saveCompanySettings('company-1', { companyName: '', companyLogoUrl: 'https://storage.example.test/logo.png' });
        expect(written).toEqual(mocks.updateDoc.mock.calls[0][1]);
        expect(written).toEqual({ companyLogoUrl: 'https://storage.example.test/logo.png' });
    });
});
