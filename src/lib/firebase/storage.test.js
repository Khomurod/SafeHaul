import { beforeEach, describe, expect, it, vi } from 'vitest';

// Freeze the company-logo Storage contract that the branding-upload UI depends
// on. Firebase Storage is mocked; only path construction and the returned URL
// are asserted. Artificial values only — no production bucket or credentials.
const storageMocks = vi.hoisted(() => ({
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
}));

vi.mock('./config.js', () => ({ storage: { __brand: 'test-storage' } }));
vi.mock('firebase/storage', () => ({
    ref: storageMocks.ref,
    uploadBytes: storageMocks.uploadBytes,
    getDownloadURL: storageMocks.getDownloadURL,
}));

import { uploadCompanyLogo } from './storage.js';

describe('uploadCompanyLogo Storage contract', () => {
    beforeEach(() => {
        storageMocks.ref.mockReset();
        storageMocks.uploadBytes.mockReset();
        storageMocks.getDownloadURL.mockReset();
    });

    it('writes to company_assets/{companyId}/logo.{ext} and returns the download URL', async () => {
        storageMocks.ref.mockReturnValue({ __ref: 'logo-ref' });
        storageMocks.uploadBytes.mockResolvedValue({ ref: { __ref: 'snapshot-ref' } });
        storageMocks.getDownloadURL.mockResolvedValue('https://cdn.example.test/company-1/logo.png');

        const file = new File(['x'], 'logo.png', { type: 'image/png' });
        const url = await uploadCompanyLogo('company-1', file);

        expect(storageMocks.ref).toHaveBeenCalledWith(
            { __brand: 'test-storage' },
            'company_assets/company-1/logo.png',
        );
        expect(storageMocks.uploadBytes).toHaveBeenCalledWith({ __ref: 'logo-ref' }, file);
        expect(storageMocks.getDownloadURL).toHaveBeenCalledWith({ __ref: 'snapshot-ref' });
        expect(url).toBe('https://cdn.example.test/company-1/logo.png');
    });

    it('derives the extension from the uploaded file name', async () => {
        storageMocks.ref.mockReturnValue({ __ref: 'logo-ref' });
        storageMocks.uploadBytes.mockResolvedValue({ ref: { __ref: 'snapshot-ref' } });
        storageMocks.getDownloadURL.mockResolvedValue('https://cdn.example.test/company-9/logo.svg');

        await uploadCompanyLogo('company-9', new File(['<svg/>'], 'brand-mark.svg', { type: 'image/svg+xml' }));

        expect(storageMocks.ref).toHaveBeenCalledWith(
            { __brand: 'test-storage' },
            'company_assets/company-9/logo.svg',
        );
    });

    it('requires a company id and a file', async () => {
        await expect(uploadCompanyLogo('', new File(['x'], 'logo.png')))
            .rejects.toThrow('Company ID and file are required for upload.');
        await expect(uploadCompanyLogo('company-1', null))
            .rejects.toThrow('Company ID and file are required for upload.');
        expect(storageMocks.ref).not.toHaveBeenCalled();
    });

    it('maps an upload failure to the stable user-facing error', async () => {
        storageMocks.ref.mockReturnValue({ __ref: 'logo-ref' });
        storageMocks.uploadBytes.mockRejectedValue(new Error('network'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(uploadCompanyLogo('company-1', new File(['x'], 'logo.png')))
            .rejects.toThrow('File upload failed. Please try again.');
        consoleError.mockRestore();
    });
});
