import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...path) => ({ path: path.join('/') }),
    getDoc: (...args) => getDoc(...args),
}));
vi.mock('@lib/firebase', () => ({ db: {} }));

import { fetchPublicCompanyName } from './publicCompanyName';

const profile = (data) => ({ exists: () => data !== null, data: () => data });

describe('fetchPublicCompanyName', () => {
    beforeEach(() => vi.resetAllMocks());
    afterEach(() => vi.useRealTimers());

    it("reads the name from the company's public profile, and nowhere else", async () => {
        getDoc.mockResolvedValueOnce(profile({ companyName: '  Acme Freight ' }));
        await expect(fetchPublicCompanyName('co1')).resolves.toBe('Acme Freight');
        expect(getDoc).toHaveBeenCalledWith({ path: 'public_profiles/co1' });
    });

    it.each([
        ['no profile', profile(null)],
        ['no name', profile({})],
        ['the placeholder a nameless company gets', profile({ companyName: 'Untitled Company' })],
    ])('knows no name for %s', async (_label, snap) => {
        getDoc.mockResolvedValueOnce(snap);
        await expect(fetchPublicCompanyName('co1')).resolves.toBeNull();
    });

    it('never rejects', async () => {
        getDoc.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
        await expect(fetchPublicCompanyName('co1')).resolves.toBeNull();
    });

    it('asks nothing without a company id', async () => {
        await expect(fetchPublicCompanyName('')).resolves.toBeNull();
        expect(getDoc).not.toHaveBeenCalled();
    });

    it('gives up after the time it was allowed', async () => {
        vi.useFakeTimers();
        let answer;
        getDoc.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
        const name = fetchPublicCompanyName('co1', { timeoutMs: 1000 });
        await vi.advanceTimersByTimeAsync(1000);
        await expect(name).resolves.toBeNull();
        // The late answer settles, and changes nothing.
        answer(profile({ companyName: 'Acme Freight' }));
    });
});
