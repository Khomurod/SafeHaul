import { beforeEach, describe, expect, it, vi } from 'vitest';

const callables = vi.hoisted(() => ({ getSignedApplicationFileUrl: vi.fn(), getSignedPevUrl: vi.fn() }));

vi.mock('firebase/functions', () => ({ httpsCallable: (_functions, name) => callables[name] }));
vi.mock('@lib/firebase', () => ({ functions: {} }));

import { signedApplicationFileUrl } from './applicationFileLink';

describe('signedApplicationFileUrl', () => {
    beforeEach(() => {
        callables.getSignedApplicationFileUrl.mockReset().mockResolvedValue({ data: { url: 'https://signed.test/upload' } });
        callables.getSignedPevUrl.mockReset().mockResolvedValue({ data: { url: 'https://signed.test/pev' } });
    });

    it('asks the application-file signer for a driver upload', async () => {
        const path = 'companies/co-1/applications/guest_uploads/1760000000000_ab12cd_cdl.jpg';
        await expect(signedApplicationFileUrl(path)).resolves.toBe('https://signed.test/upload');
        expect(callables.getSignedApplicationFileUrl).toHaveBeenCalledWith({ storagePath: path });
        expect(callables.getSignedPevUrl).not.toHaveBeenCalled();
    });

    it.each([
        'companies/co-1/applications/app-1/pev_requests/PEV_REQUEST_A_abcd1234.pdf',
        'companies/co-1/leads/lead-1/pev_requests/PEV_REQUEST_A_abcd1234.pdf',
    ])('asks the PEV signer for a verification request PDF: %s', async (path) => {
        await expect(signedApplicationFileUrl(path)).resolves.toBe('https://signed.test/pev');
        expect(callables.getSignedPevUrl).toHaveBeenCalledWith({ storagePath: path });
        expect(callables.getSignedApplicationFileUrl).not.toHaveBeenCalled();
    });

    it('fails when no link comes back', async () => {
        callables.getSignedPevUrl.mockResolvedValue({ data: {} });
        await expect(signedApplicationFileUrl('companies/co-1/applications/app-1/pev_requests/x.pdf'))
            .rejects.toThrow('No link was returned for this file.');
    });
});
