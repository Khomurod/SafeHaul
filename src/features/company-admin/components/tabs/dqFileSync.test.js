/**
 * The DQ tab files a record's uploads (`syncDqFiles`) once while the dossier is
 * open: a later opening of the tab joins a filing still running, and asks
 * nothing after one that finished. A failed filing is tried again on the next
 * opening, another record is filed on its own, and once the dossier closes
 * (`forgetDriverUploadFilings`) the next opening files again.
 *
 * All ids below are artificial.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ calls: [] }));

vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (payload) => new Promise((resolve, reject) => fx.calls.push({ name, payload, resolve, reject })),
}));

import { fileDriverUploads, fileDriverUploadsOnce, forgetDriverUploadFilings } from './dqFileSync';

const LEAD = { companyId: 'co-1', collectionName: 'leads', applicationId: 'rec-1' };
const APPLICATION = { companyId: 'co-1', collectionName: 'applications', applicationId: 'rec-2' };

beforeEach(() => {
    fx.calls = [];
});
afterEach(() => {
    forgetDriverUploadFilings();
});

describe('filing a record\'s uploads once while the dossier is open', () => {
    it('asks the server once, and a later opening that finds it running waits for the same answer', async () => {
        const first = fileDriverUploadsOnce(LEAD);
        const second = fileDriverUploadsOnce(LEAD);

        expect(fx.calls).toHaveLength(1);
        expect(fx.calls[0]).toMatchObject({ name: 'syncDqFiles', payload: LEAD });
        fx.calls[0].resolve({ data: { filed: 2 } });

        await expect(first).resolves.toBe(2);
        await expect(second).resolves.toBe(2);
    });

    it('asks nothing once the filing finished, and answers that it filed nothing new', async () => {
        const first = fileDriverUploadsOnce(LEAD);
        fx.calls[0].resolve({ data: { filed: 1 } });
        await first;

        await expect(fileDriverUploadsOnce(LEAD)).resolves.toBe(0);
        await expect(fileDriverUploadsOnce(LEAD)).resolves.toBe(0);
        expect(fx.calls).toHaveLength(1);
    });

    it('files another record on its own', async () => {
        fileDriverUploadsOnce(LEAD);
        fileDriverUploadsOnce(APPLICATION);
        fileDriverUploadsOnce({ ...LEAD, collectionName: 'applications' });

        expect(fx.calls.map(({ payload }) => payload)).toEqual([LEAD, APPLICATION, { ...LEAD, collectionName: 'applications' }]);
        fx.calls.forEach((call) => call.resolve({ data: { filed: 0 } }));
    });

    it('tries again after a failed filing', async () => {
        const failed = fileDriverUploadsOnce(LEAD);
        fx.calls[0].reject(new Error('unavailable'));
        await expect(failed).rejects.toThrow('unavailable');

        const retried = fileDriverUploadsOnce(LEAD);
        expect(fx.calls).toHaveLength(2);
        fx.calls[1].resolve({ data: { filed: 1 } });
        await expect(retried).resolves.toBe(1);
    });

    it('files again once the dossier has closed', async () => {
        const first = fileDriverUploadsOnce(LEAD);
        fx.calls[0].resolve({ data: { filed: 0 } });
        await first;

        forgetDriverUploadFilings();
        const next = fileDriverUploadsOnce(LEAD);

        expect(fx.calls).toHaveLength(2);
        fx.calls[1].resolve({ data: { filed: 0 } });
        await next;
    });

    it('keeps the explicit filing for an action that needs it: it always asks', async () => {
        const first = fileDriverUploadsOnce(LEAD);
        fx.calls[0].resolve({ data: { filed: 0 } });
        await first;

        const asked = fileDriverUploads(LEAD);
        expect(fx.calls).toHaveLength(2);
        fx.calls[1].resolve({ data: { filed: 3 } });
        await expect(asked).resolves.toBe(3);
    });
});
