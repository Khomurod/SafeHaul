// Re-importing a lead the company already has: the file adds what it gives and
// the lead keeps the rest. A row without an email, a city or a name must not
// write a placeholder over the lead's real email, a blank over its city, or the
// import's "Unknown Driver" and "unidentified" over its name and type; the lead
// keeps the source it arrived by. The harness is the contract's
// (`useCompanyLeadUpload.contract.support.js`).
//
// All names, emails and phone numbers below are artificial.
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./useCompanyLeadUpload.contract.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./useCompanyLeadUpload.contract.support')).firebaseFirestoreMock());

import { useCompanyLeadUpload } from './useCompanyLeadUpload';
import {
    makeMountHook,
    resetHarness,
    restoreHarness,
    primeQueries,
    snapshot,
    fs,
    LEADS_PATH,
} from './useCompanyLeadUpload.contract.support';

const mountHook = makeMountHook(useCompanyLeadUpload);

beforeEach(resetHarness);
afterEach(restoreHarness);

const matchByPhone = () => primeQueries({
    dedupe: (target) => ((target.constraints || []).some((c) => c.field === 'normalizedPhone')
        ? snapshot([{ id: 'existing-1', ref: { __kind: 'doc', path: `${LEADS_PATH}/existing-1` } }])
        : snapshot([])),
});

// What the import worker hands over for a row that gives only a phone number:
// its placeholders for the name and type (`leadImportPlaceholders.js`).
const PHONE_ONLY_ROW = {
    firstName: 'Unknown',
    lastName: 'Driver',
    email: 'placeholder_abc@placeholder.safehaulapp.com',
    isEmailPlaceholder: true,
    phone: '(555) 123-4567',
    normalizedPhone: '5551234567',
    driverType: 'unidentified',
    experience: '',
    city: '',
    state: '',
};

describe('useCompanyLeadUpload — re-importing a lead it already has', () => {
    it('writes only what the file gives, never a placeholder, a blank or a default', async () => {
        matchByPhone();
        const { result } = await mountHook();

        await act(async () => { await result.current.uploadLeads([PHONE_ONLY_ROW], 'file'); });

        expect(fs.update).toHaveBeenCalledTimes(1);
        const [ref, payload] = fs.update.mock.calls[0];
        expect(ref.path).toBe(`${LEADS_PATH}/existing-1`);
        expect(payload).toEqual({
            phone: '(555) 123-4567',
            normalizedPhone: '5551234567',
            updatedAt: '__serverTimestamp__',
        });
        expect(result.current.stats).toEqual({ created: 0, updated: 1 });
    });

    it("writes a real email the file gives, replacing the lead's placeholder", async () => {
        matchByPhone();
        const { result } = await mountHook();

        await act(async () => {
            await result.current.uploadLeads([{
                ...PHONE_ONLY_ROW,
                firstName: 'Ann',
                lastName: 'Baker',
                email: 'ann@example.com',
                isEmailPlaceholder: false,
                city: 'Austin',
            }], 'file');
        });

        expect(fs.update.mock.calls[0][1]).toEqual({
            firstName: 'Ann',
            lastName: 'Baker',
            email: 'ann@example.com',
            isEmailPlaceholder: false,
            phone: '(555) 123-4567',
            normalizedPhone: '5551234567',
            city: 'Austin',
            updatedAt: '__serverTimestamp__',
        });
    });

    it('still creates a new lead with the defaults, so it reads sensibly', async () => {
        const { result } = await mountHook();

        await act(async () => { await result.current.uploadLeads([PHONE_ONLY_ROW], 'file'); });

        expect(fs.update).not.toHaveBeenCalled();
        expect(fs.set.mock.calls[0][1]).toMatchObject({
            firstName: 'Unknown',
            lastName: 'Driver',
            driverType: 'unidentified',
            isEmailPlaceholder: true,
            source: 'Company Import (File)',
        });
    });
});
