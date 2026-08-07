// The browser must FETCH the preserved original, never build one.
//
// The defect this replaces: `generateApplicationPDF` rendered the "official"
// application in the browser, from live application data, every time somebody
// pressed Download. There was no original — only a fresh render of whatever the
// record said at that moment.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const callableSpy = vi.fn();

vi.mock('firebase/functions', () => ({
    httpsCallable: () => (...args) => callableSpy(...args),
}));

vi.mock('@lib/firebase', () => ({ functions: {} }));

const {
    NoPreservedPdfError,
    downloadPreservedApplicationPdf,
    fetchPreservedApplicationPdf,
} = await import('./applicationPdfService');

const args = { companyId: 'company-abc', applicationId: 'app-1' };

describe('fetchPreservedApplicationPdf', () => {
    beforeEach(() => {
        callableSpy.mockReset();
        callableSpy.mockResolvedValue({
            data: {
                url: 'https://signed.storage.test/original.pdf',
                fileName: 'Driver-Application-Marcus-Delgado-2026-07-14.pdf',
                isOriginal: true,
                snapshotId: 'v1',
            },
        });
    });

    it('asks the server for the stored document', async () => {
        const result = await fetchPreservedApplicationPdf(args);

        expect(callableSpy).toHaveBeenCalledWith({
            companyId: 'company-abc',
            applicationId: 'app-1',
            snapshotId: undefined,
        });
        expect(result.url).toBe('https://signed.storage.test/original.pdf');
        expect(result.isOriginal).toBe(true);
    });

    it('can ask for a specific resubmission', async () => {
        await fetchPreservedApplicationPdf({ ...args, snapshotId: 'v2' });
        expect(callableSpy).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 'v2' }));
    });

    it('refuses to call without a company and an application', async () => {
        await expect(fetchPreservedApplicationPdf({ applicationId: 'app-1' })).rejects.toThrow();
        await expect(fetchPreservedApplicationPdf({ companyId: 'c' })).rejects.toThrow();
        expect(callableSpy).not.toHaveBeenCalled();
    });

    it('distinguishes "no preserved record" from every other failure', async () => {
        callableSpy.mockRejectedValue({ code: 'functions/not-found' });
        await expect(fetchPreservedApplicationPdf(args)).rejects.toBeInstanceOf(NoPreservedPdfError);
    });

    it('reports a denial as a denial rather than as a missing document', async () => {
        callableSpy.mockRejectedValue({ code: 'functions/permission-denied' });
        await expect(fetchPreservedApplicationPdf(args)).rejects.toThrow(/do not have permission/);
    });

    it('never falls back to generating a document in the browser', async () => {
        callableSpy.mockRejectedValue({ code: 'functions/internal' });
        await expect(fetchPreservedApplicationPdf(args)).rejects.toThrow(/Could not open/);
        // No jsPDF, no partial file, nothing that could be mistaken for the original.
    });
});

describe('downloadPreservedApplicationPdf', () => {
    beforeEach(() => {
        callableSpy.mockReset();
        callableSpy.mockResolvedValue({
            data: { url: 'https://signed.storage.test/original.pdf', fileName: 'x.pdf', isOriginal: true, snapshotId: 'v1' },
        });
    });

    it('hands the short-lived link to the browser', async () => {
        const navigate = vi.fn();
        const result = await downloadPreservedApplicationPdf(args, { navigate });

        expect(navigate).toHaveBeenCalledWith('https://signed.storage.test/original.pdf');
        expect(result.fileName).toBe('x.pdf');
    });

    it('does not navigate when the document could not be resolved', async () => {
        const navigate = vi.fn();
        callableSpy.mockRejectedValue({ code: 'functions/not-found' });

        await expect(downloadPreservedApplicationPdf(args, { navigate })).rejects.toBeInstanceOf(NoPreservedPdfError);
        expect(navigate).not.toHaveBeenCalled();
    });
});
