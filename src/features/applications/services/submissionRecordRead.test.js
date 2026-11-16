/**
 * The frozen submission record is read once while the dossier is open, by its
 * full path, and shared by whoever asks for that path. A missing record and a
 * failed read are read again (a record may still be written), the dossier's
 * closing forgets every record (an application deleted and applied for again
 * gets a new one at the same path), and so does another sign-in.
 *
 * All ids below are artificial.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ reads: [], stored: {}, failing: null, auth: { currentUser: null } }));

vi.mock('@lib/firebase', () => ({ db: {}, auth: fx.auth }));
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    getDoc: async (ref) => {
        fx.reads.push(ref.path);
        if (fx.failing) throw fx.failing;
        const data = fx.stored[ref.path];
        return { exists: () => data !== undefined, data: () => data };
    },
}));

import { forgetSubmissionRecords, readSubmissionRecord } from './submissionRecordRead';

const V1 = { companyId: 'co-1', applicationId: 'app-1', snapshotId: 'v1' };
const PATH = 'companies/co-1/applications/app-1/submission/v1';
const RECORD = { frozen: true, sections: [], agreements: [] };

beforeEach(() => {
    fx.reads = [];
    fx.stored = { [PATH]: RECORD };
    fx.failing = null;
    fx.auth.currentUser = { uid: 'recruiter-1' };
});
afterEach(() => {
    forgetSubmissionRecords();
});

describe('the frozen submission record, read once while the dossier is open', () => {
    it('reads a path once, however many ask, at once or later', async () => {
        const [first, second] = await Promise.all([readSubmissionRecord(V1), readSubmissionRecord({ ...V1 })]);
        const later = await readSubmissionRecord(V1);

        expect(first).toEqual(RECORD);
        expect(second).toBe(first);
        expect(later).toBe(first);
        expect(fx.reads).toEqual([PATH]);
    });

    it('reads another path on its own', async () => {
        fx.stored['companies/co-1/applications/app-2/submission/v1'] = { ...RECORD, applicant: 'second' };
        fx.stored['companies/co-1/applications/app-1/submission/v2'] = { ...RECORD, sequence: 2 };

        await readSubmissionRecord(V1);
        await expect(readSubmissionRecord({ ...V1, applicationId: 'app-2' })).resolves.toMatchObject({ applicant: 'second' });
        await expect(readSubmissionRecord({ ...V1, snapshotId: 'v2' })).resolves.toMatchObject({ sequence: 2 });

        expect(fx.reads).toEqual([
            PATH,
            'companies/co-1/applications/app-2/submission/v1',
            'companies/co-1/applications/app-1/submission/v2',
        ]);
    });

    it('reads a missing record again, so one written since is shown', async () => {
        delete fx.stored[PATH];
        await expect(readSubmissionRecord(V1)).resolves.toBeNull();

        fx.stored[PATH] = RECORD;
        await expect(readSubmissionRecord(V1)).resolves.toEqual(RECORD);
        await readSubmissionRecord(V1);

        expect(fx.reads).toEqual([PATH, PATH]);
    });

    it('reads again after a failed read', async () => {
        fx.failing = Object.assign(new Error('unavailable'), { code: 'unavailable' });
        await expect(readSubmissionRecord(V1)).rejects.toThrow('unavailable');

        fx.failing = null;
        await expect(readSubmissionRecord(V1)).resolves.toEqual(RECORD);
        expect(fx.reads).toEqual([PATH, PATH]);
    });

    it('reads anew once the dossier has closed', async () => {
        await readSubmissionRecord(V1);

        forgetSubmissionRecords();
        fx.stored[PATH] = { ...RECORD, applicant: 'applied again' };

        await expect(readSubmissionRecord(V1)).resolves.toMatchObject({ applicant: 'applied again' });
        expect(fx.reads).toEqual([PATH, PATH]);
    });

    it('never hands a record to another sign-in', async () => {
        await readSubmissionRecord(V1);

        fx.auth.currentUser = { uid: 'recruiter-2' };
        await readSubmissionRecord(V1);
        fx.auth.currentUser = null;
        fx.failing = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

        await expect(readSubmissionRecord(V1)).rejects.toThrow('Missing or insufficient permissions.');
        expect(fx.reads).toEqual([PATH, PATH, PATH]);
    });
});
