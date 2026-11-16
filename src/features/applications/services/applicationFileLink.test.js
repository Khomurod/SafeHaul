import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callables = vi.hoisted(() => ({
    getSignedApplicationFileUrl: vi.fn(),
    getSignedApplicationFileUrls: vi.fn(),
    getSignedPevUrl: vi.fn(),
    getSignedDocumentUrl: vi.fn(),
}));
const session = vi.hoisted(() => ({ auth: { currentUser: null } }));

vi.mock('firebase/functions', () => ({ httpsCallable: (_functions, name) => callables[name] }));
vi.mock('@lib/firebase', () => ({ functions: {}, auth: session.auth }));

import {
    FILE_LINK_REUSE_MS,
    MAX_FILES_PER_SIGNING,
    forgetApplicationFileLinks,
    reusableApplicationFileUrl,
    reusableApplicationFileUrls,
    signedApplicationFileUrl,
} from './applicationFileLink';

const UPLOAD = 'companies/co-1/applications/guest_uploads/1760000000000_ab12cd_cdl.jpg';

beforeEach(() => {
    vi.resetAllMocks();
    callables.getSignedApplicationFileUrl.mockResolvedValue({ data: { url: 'https://signed.test/upload' } });
    callables.getSignedPevUrl.mockResolvedValue({ data: { url: 'https://signed.test/pev' } });
    callables.getSignedDocumentUrl.mockResolvedValue({ data: { success: true, url: 'https://signed.test/sealed' } });
    session.auth.currentUser = null;
});

afterEach(() => {
    forgetApplicationFileLinks();
    vi.useRealTimers();
});

describe('signedApplicationFileUrl', () => {
    it('asks the application-file signer for a driver upload', async () => {
        await expect(signedApplicationFileUrl(UPLOAD)).resolves.toBe('https://signed.test/upload');
        expect(callables.getSignedApplicationFileUrl).toHaveBeenCalledWith({ storagePath: UPLOAD });
        expect(callables.getSignedPevUrl).not.toHaveBeenCalled();
    });

    it.each([
        'companies/co-1/applications/app-1/pev_requests/PEV_REQUEST_A_abcd1234.pdf',
        'companies/co-1/leads/lead-1/pev_requests/PEV_REQUEST_A_abcd1234.pdf',
        'companies/co-1/applications/app-1/pev_results/PEV_A_abcd1234.pdf',
        'companies/co-1/leads/lead-1/pev_results/1700000000000_fax.pdf',
    ])('asks the PEV signer for a verification request or result: %s', async (path) => {
        await expect(signedApplicationFileUrl(path)).resolves.toBe('https://signed.test/pev');
        expect(callables.getSignedPevUrl).toHaveBeenCalledWith({ storagePath: path });
        expect(callables.getSignedApplicationFileUrl).not.toHaveBeenCalled();
    });

    it('asks the e-documents signer for a sealed document filed in the DQ file', async () => {
        const sealed = 'secure_documents/co-1/completed/req-1_signed.pdf';
        await expect(signedApplicationFileUrl(sealed)).resolves.toBe('https://signed.test/sealed');
        expect(callables.getSignedDocumentUrl).toHaveBeenCalledWith({ storagePath: sealed });
        expect(callables.getSignedApplicationFileUrl).not.toHaveBeenCalled();
        expect(callables.getSignedPevUrl).not.toHaveBeenCalled();
    });

    it.each([
        'secure_documents/co-1/originals/offer.pdf',
        'secure_documents/co-1/signatures/req-1_sig.png',
        'secure_documents/co-1/completed/nested/req-1_signed.pdf',
    ])('sends any other e-documents path nowhere special: %s', async (path) => {
        await signedApplicationFileUrl(path);
        expect(callables.getSignedDocumentUrl).not.toHaveBeenCalled();
        expect(callables.getSignedApplicationFileUrl).toHaveBeenCalledWith({ storagePath: path });
    });

    it('fails when no link comes back', async () => {
        callables.getSignedPevUrl.mockResolvedValue({ data: {} });
        await expect(signedApplicationFileUrl('companies/co-1/applications/app-1/pev_requests/x.pdf'))
            .rejects.toThrow('No link was returned for this file.');
    });

    it('signs afresh on every press, even after the dossier kept a link', async () => {
        session.auth.currentUser = { uid: 'recruiter-1' };
        await reusableApplicationFileUrl(UPLOAD);
        await signedApplicationFileUrl(UPLOAD);
        await signedApplicationFileUrl(UPLOAD);
        expect(callables.getSignedApplicationFileUrl).toHaveBeenCalledTimes(3);
    });
});

describe('reusableApplicationFileUrl', () => {
    // Each signing answers a link of its own, so a reused link is told from a new one.
    let minted;
    beforeEach(() => {
        vi.useFakeTimers({ now: new Date('2026-11-03T09:00:00Z') });
        minted = 0;
        callables.getSignedApplicationFileUrl.mockImplementation(async () => ({ data: { url: `https://signed.test/link-${++minted}` } }));
        session.auth.currentUser = { uid: 'recruiter-1' };
    });

    it('reuses a link for ten minutes, and one signing in flight serves every caller', async () => {
        let answer;
        callables.getSignedApplicationFileUrl.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
        const first = reusableApplicationFileUrl(UPLOAD);
        const second = reusableApplicationFileUrl(UPLOAD);
        expect(callables.getSignedApplicationFileUrl).toHaveBeenCalledTimes(1);

        answer({ data: { url: 'https://signed.test/held' } });
        await expect(first).resolves.toBe('https://signed.test/held');
        await expect(second).resolves.toBe('https://signed.test/held');

        vi.setSystemTime(Date.now() + FILE_LINK_REUSE_MS - 1);
        await expect(reusableApplicationFileUrl(UPLOAD)).resolves.toBe('https://signed.test/held');
        expect(callables.getSignedApplicationFileUrl).toHaveBeenCalledTimes(1);
    });

    it('signs again once ten minutes have passed', async () => {
        await expect(reusableApplicationFileUrl(UPLOAD)).resolves.toBe('https://signed.test/link-1');

        vi.setSystemTime(Date.now() + FILE_LINK_REUSE_MS);
        await expect(reusableApplicationFileUrl(UPLOAD)).resolves.toBe('https://signed.test/link-2');
        expect(callables.getSignedApplicationFileUrl).toHaveBeenCalledTimes(2);
    });

    it('keeps each file to its own link', async () => {
        const other = UPLOAD.replace('cdl', 'medical');
        await expect(reusableApplicationFileUrl(UPLOAD)).resolves.toBe('https://signed.test/link-1');
        await expect(reusableApplicationFileUrl(other)).resolves.toBe('https://signed.test/link-2');
        expect(callables.getSignedApplicationFileUrl).toHaveBeenLastCalledWith({ storagePath: other });
    });

    it('does not keep a failed signing, so the next view tries again', async () => {
        callables.getSignedApplicationFileUrl.mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/internal' }));
        await expect(reusableApplicationFileUrl(UPLOAD)).rejects.toThrow('internal');

        await expect(reusableApplicationFileUrl(UPLOAD)).resolves.toBe('https://signed.test/link-1');
        expect(callables.getSignedApplicationFileUrl).toHaveBeenCalledTimes(2);
    });

    it('never hands a link to another sign-in', async () => {
        await expect(reusableApplicationFileUrl(UPLOAD)).resolves.toBe('https://signed.test/link-1');

        // Another person signs in on this tab: a new `auth.currentUser`.
        session.auth.currentUser = { uid: 'recruiter-2' };
        await expect(reusableApplicationFileUrl(UPLOAD)).resolves.toBe('https://signed.test/link-2');

        // The first person signs in again: a new object too, so a new link.
        session.auth.currentUser = { uid: 'recruiter-1' };
        await expect(reusableApplicationFileUrl(UPLOAD)).resolves.toBe('https://signed.test/link-3');
        expect(callables.getSignedApplicationFileUrl).toHaveBeenCalledTimes(3);
    });

    it('drops every link at sign-out', async () => {
        await expect(reusableApplicationFileUrl(UPLOAD)).resolves.toBe('https://signed.test/link-1');

        session.auth.currentUser = null;
        callables.getSignedApplicationFileUrl.mockRejectedValueOnce(Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' }));
        await expect(reusableApplicationFileUrl(UPLOAD)).rejects.toThrow('unauthenticated');
        expect(callables.getSignedApplicationFileUrl).toHaveBeenCalledTimes(2);
    });

    it('lets a late failure from an earlier sign-in leave the current link alone', async () => {
        let fail;
        callables.getSignedApplicationFileUrl.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
        const stale = reusableApplicationFileUrl(UPLOAD);

        session.auth.currentUser = { uid: 'recruiter-2' };
        await expect(reusableApplicationFileUrl(UPLOAD)).resolves.toBe('https://signed.test/link-1');

        fail(new Error('internal'));
        await expect(stale).rejects.toThrow('internal');
        await expect(reusableApplicationFileUrl(UPLOAD)).resolves.toBe('https://signed.test/link-1');
        expect(callables.getSignedApplicationFileUrl).toHaveBeenCalledTimes(2);
    });
});

describe('reusableApplicationFileUrls', () => {
    const MEDICAL = UPLOAD.replace('cdl', 'medical');
    const PEV = 'companies/co-1/applications/app-1/pev_results/PEV_A_abcd1234.pdf';
    /** Answers every path it is asked for, each with a link of its own. */
    const signAll = async ({ storagePaths }) => ({
        data: { success: true, results: Object.fromEntries(storagePaths.map((path) => [path, { url: `https://signed.test/together/${path}` }])) },
    });

    beforeEach(() => {
        session.auth.currentUser = { uid: 'recruiter-1' };
        callables.getSignedApplicationFileUrls.mockImplementation(signAll);
    });

    it("signs a record's driver uploads in one call", async () => {
        const links = reusableApplicationFileUrls([UPLOAD, MEDICAL, UPLOAD]);

        await expect(links[UPLOAD]).resolves.toBe(`https://signed.test/together/${UPLOAD}`);
        await expect(links[MEDICAL]).resolves.toBe(`https://signed.test/together/${MEDICAL}`);
        expect(callables.getSignedApplicationFileUrls).toHaveBeenCalledTimes(1);
        expect(callables.getSignedApplicationFileUrls).toHaveBeenCalledWith({ storagePaths: [UPLOAD, MEDICAL] });
        expect(callables.getSignedApplicationFileUrl).not.toHaveBeenCalled();
    });

    it('reuses the links it holds, for the files signed together or one at a time', async () => {
        await reusableApplicationFileUrl(UPLOAD);
        await reusableApplicationFileUrls([MEDICAL])[MEDICAL];

        const links = reusableApplicationFileUrls([UPLOAD, MEDICAL]);

        await expect(links[UPLOAD]).resolves.toBe('https://signed.test/upload');
        await expect(links[MEDICAL]).resolves.toBe(`https://signed.test/together/${MEDICAL}`);
        expect(callables.getSignedApplicationFileUrls).toHaveBeenCalledTimes(1);
        expect(callables.getSignedApplicationFileUrl).toHaveBeenCalledTimes(1);
    });

    it('signs no more than eight files in a call', async () => {
        const paths = Array.from({ length: MAX_FILES_PER_SIGNING + 1 }, (_, i) => UPLOAD.replace('cdl', `file-${i}`));

        const links = reusableApplicationFileUrls(paths);
        await Promise.all(Object.values(links));

        expect(MAX_FILES_PER_SIGNING).toBe(8);
        expect(callables.getSignedApplicationFileUrls.mock.calls.map(([{ storagePaths }]) => storagePaths.length)).toEqual([8, 1]);
    });

    it('sends a verification file to its own signer', async () => {
        const links = reusableApplicationFileUrls([PEV]);

        await expect(links[PEV]).resolves.toBe('https://signed.test/pev');
        expect(callables.getSignedApplicationFileUrls).not.toHaveBeenCalled();
    });

    it('fails a refused file alone, with its reason, and signs it again next time', async () => {
        callables.getSignedApplicationFileUrls.mockResolvedValueOnce({
            data: {
                success: true,
                results: {
                    [UPLOAD]: { url: 'https://signed.test/cdl' },
                    [MEDICAL]: { error: { code: 'permission-denied', message: 'You do not have access to this company.' } },
                },
            },
        });

        const links = reusableApplicationFileUrls([UPLOAD, MEDICAL]);

        await expect(links[UPLOAD]).resolves.toBe('https://signed.test/cdl');
        await expect(links[MEDICAL]).rejects.toMatchObject({
            message: 'You do not have access to this company.',
            code: 'functions/permission-denied',
        });
        await expect(reusableApplicationFileUrls([UPLOAD, MEDICAL])[MEDICAL]).resolves.toBe(`https://signed.test/together/${MEDICAL}`);
        expect(callables.getSignedApplicationFileUrls).toHaveBeenLastCalledWith({ storagePaths: [MEDICAL] });
    });

    it('signs each file on its own when the call fails', async () => {
        callables.getSignedApplicationFileUrls.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'functions/not-found' }));

        const links = reusableApplicationFileUrls([UPLOAD, MEDICAL]);

        await expect(links[UPLOAD]).resolves.toBe('https://signed.test/upload');
        await expect(links[MEDICAL]).resolves.toBe('https://signed.test/upload');
        expect(callables.getSignedApplicationFileUrl.mock.calls).toEqual([[{ storagePath: UPLOAD }], [{ storagePath: MEDICAL }]]);
    });

    it('never hands a link to another sign-in', async () => {
        await reusableApplicationFileUrls([UPLOAD])[UPLOAD];

        session.auth.currentUser = { uid: 'recruiter-2' };
        await reusableApplicationFileUrls([UPLOAD])[UPLOAD];

        expect(callables.getSignedApplicationFileUrls).toHaveBeenCalledTimes(2);
    });
});
