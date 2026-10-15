/**
 * The dossier's Download: the preserved original of the record the dossier
 * opened, by its document id, and a message when there is no file to give.
 * The header's Download button calls this handler (`onDownload`).
 *
 * All identifiers below are artificial.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pdf = vi.hoisted(() => {
    class NoPreservedPdfError extends Error {}
    return { NoPreservedPdfError, download: vi.fn(), showError: vi.fn() };
});

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    doc: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    // The DQ File entries: a live listener, which these tests leave silent.
    onSnapshot: vi.fn(() => () => {}),
}));
vi.mock('@features/applications/services/applicationPdfService', () => ({
    NoPreservedPdfError: pdf.NoPreservedPdfError,
    downloadPreservedApplicationPdf: (...args) => pdf.download(...args),
}));
vi.mock('@features/applications/hooks/useApplicationDetails', () => ({
    useApplicationDetails: () => ({
        appData: { firstName: 'Ann', lastName: 'Baker' },
        collectionName: 'applications',
        handleStatusUpdate: vi.fn(),
        isCompanyAdmin: true,
    }),
}));
vi.mock('@shared/components/feedback', () => ({ useToast: () => ({ showError: pdf.showError }) }));

import { useApplicationView } from './useApplicationView';

afterEach(() => vi.clearAllMocks());

describe("useApplicationView's download", () => {
    const mount = () => renderHook(() => useApplicationView('co-1', 'app-12345678'));

    it('asks for the preserved original of the record the dossier opened', async () => {
        pdf.download.mockResolvedValue({ url: 'https://signed.test/x.pdf' });
        const { result } = mount();

        await result.current.handleDownloadPdf();

        expect(pdf.download).toHaveBeenCalledWith({ companyId: 'co-1', applicationId: 'app-12345678' });
        expect(pdf.showError).not.toHaveBeenCalled();
    });

    it('says so when no PDF was preserved for the application', async () => {
        pdf.download.mockRejectedValue(new pdf.NoPreservedPdfError('No saved PDF for this application yet.'));
        const { result } = mount();

        await result.current.handleDownloadPdf();

        expect(pdf.showError).toHaveBeenCalledWith('No saved PDF for this application yet.');
    });

    it('says so when the download fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        pdf.download.mockRejectedValue(new Error('Network unavailable'));
        const { result } = mount();

        await result.current.handleDownloadPdf();

        expect(pdf.showError).toHaveBeenCalledWith('Network unavailable');
    });
});
