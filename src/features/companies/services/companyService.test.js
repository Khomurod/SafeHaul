/**
 * Settings saves the company's details through `saveCompanySettings`, which
 * writes only the fields it knows. All names and numbers are artificial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateDoc: vi.fn(async () => {}),
    getDocs: vi.fn(async () => ({ empty: true, docs: [], forEach: () => {} })),
    addDoc: vi.fn(async () => ({ id: 'company-new' })),
}));

vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'super-admin-1' } } }));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(() => ({ path: 'companies' })),
    getDocs: (...args) => mocks.getDocs(...args),
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    getDoc: vi.fn(),
    updateDoc: (...args) => mocks.updateDoc(...args),
    addDoc: (...args) => mocks.addDoc(...args),
    query: vi.fn(),
    where: vi.fn(),
}));

import { createNewCompany, forgetCompanies, loadCompanies, saveCompanySettings, updateCompany } from './companyService';

beforeEach(() => {
    mocks.updateDoc.mockClear();
    mocks.getDocs.mockClear();
    mocks.addDoc.mockClear();
    forgetCompanies();
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

// Super Admin's screens share one read of every company (`loadCompanies`); a
// company written through this service must not leave that read stale.
describe('loadCompanies and the company writers', () => {
    const companyReads = () => mocks.getDocs.mock.calls.filter(([target]) => target?.path === 'companies').length;

    it('reads every company once while it is kept', async () => {
        await loadCompanies();
        await loadCompanies();
        expect(companyReads()).toBe(1);
    });

    it.each([
        ['saveCompanySettings', () => saveCompanySettings('company-1', { companyName: 'Artificial Freight Co' })],
        ['updateCompany', () => updateCompany('company-1', { companyName: 'Artificial Freight Co' })],
        ['createNewCompany', () => createNewCompany({ appSlug: 'artificial-freight', companyName: 'Artificial Freight Co' })],
    ])('reads every company again after %s', async (_name, write) => {
        await loadCompanies();
        await write();
        await loadCompanies();
        expect(companyReads()).toBe(2);
    });
});
