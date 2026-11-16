// Dossier tab bodies contract, `DQFileTab`: a sealed document the server filed
// from a signing request linked to the record (`functions/sealedDocumentDq.js`).
// It opens from a link signed when pressed, through the e-documents signer, and
// removing it only hides it: the sealed PDF stays where the request keeps it.
// The shared harness lives in `DossierBodies.contract.support.jsx`; the file
// links are mocked one level down from it here, at `applicationFileLink`'s
// callable, so the routing to `getSignedDocumentUrl` is what is under test.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callables = vi.hoisted(() => ({
    getSignedDocumentUrl: vi.fn(),
    getSignedApplicationFileUrl: vi.fn(),
    getSignedPevUrl: vi.fn(),
}));

vi.mock('@lib/firebase', async () => ({
    ...(await import('./DossierBodies.contract.support')).libFirebaseMock(),
    functions: {},
}));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/firestore', async () => (await import('./DossierBodies.contract.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./DossierBodies.contract.support')).firebaseStorageMock());
vi.mock('firebase/functions', () => ({ httpsCallable: (_functions, name) => callables[name] }));
vi.mock('@shared/utils/activityLogger', async () => (await import('./DossierBodies.contract.support')).activityLoggerMock());
vi.mock('@features/applications/services/applicationPdfService', async () => (await import('./DossierBodies.contract.support')).applicationPdfServiceMock());
vi.mock('@features/auth/services/userService', async () => (await import('./DossierBodies.contract.support')).userServiceMock());
vi.mock('./dqFileSync', async () => (await import('./DossierBodies.contract.support')).dqFileSyncMock());

import { DQFileTab } from './DQFileTab';
import { makeRenderDq, resetHarness, snap, fs, storageMocks } from './DossierBodies.contract.support';

const renderDq = makeRenderDq(DQFileTab);

/** As `sealDocument` files it (`dq_files/signed_<requestId>`). Artificial. */
const FILED_SIGNED_DOCUMENT = {
    type: 'signed_document',
    fileType: 'Signed document – Offer Letter',
    label: 'Signed document',
    fileName: 'Offer Letter.pdf',
    url: null,
    storagePath: 'secure_documents/co-1/completed/req-1_signed.pdf',
    source: 'signed_document',
    isSynced: true,
    signingRequestId: 'req-1',
    sha256Checksum: 'a'.repeat(64),
};

describe('DQFileTab — a sealed document filed by the server', () => {
    let tab;

    beforeEach(() => {
        resetHarness();
        Object.values(callables).forEach((callable) => callable.mockReset());
        fs.getDocs.mockResolvedValue(snap([['signed_req-1', FILED_SIGNED_DOCUMENT]]));
        callables.getSignedDocumentUrl.mockResolvedValue({ data: { success: true, url: 'https://signed.test/sealed.pdf' } });
        tab = { opener: 'the dossier', location: { href: '' }, close: vi.fn() };
        vi.spyOn(window, 'open').mockImplementation(() => tab);
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it('opens the sealed PDF from a link the e-documents signer signs when it is pressed', async () => {
        renderDq();

        const open = await screen.findByRole('button', {
            name: 'Download Signed document – Offer Letter: Offer Letter.pdf (opens in a new tab)',
        });
        // No stored link: a button, not an anchor to `url`.
        expect(screen.queryByRole('link', { name: /Download Signed document/ })).toBeNull();
        fireEvent.click(open);

        expect(window.open).toHaveBeenCalledWith('', '_blank');
        expect(tab.opener).toBeNull();
        await waitFor(() => expect(tab.location.href).toBe('https://signed.test/sealed.pdf'));
        expect(callables.getSignedDocumentUrl).toHaveBeenCalledWith({ storagePath: FILED_SIGNED_DOCUMENT.storagePath });
        expect(callables.getSignedApplicationFileUrl).not.toHaveBeenCalled();
    });

    it('says so when the sealed PDF is gone, and closes the tab it opened', async () => {
        callables.getSignedDocumentUrl.mockRejectedValue(Object.assign(new Error('gone'), { code: 'functions/not-found' }));
        renderDq();

        fireEvent.click(await screen.findByRole('button', { name: /^Download Signed document – Offer Letter/ }));

        expect(await screen.findByText('This file could not be found. It may have been deleted.')).toBeInTheDocument();
        expect(tab.close).toHaveBeenCalled();
    });

    it('is hidden, not deleted, and the sealed PDF stays', async () => {
        let rows = [['signed_req-1', FILED_SIGNED_DOCUMENT]];
        fs.getDocs.mockImplementation(async () => snap(rows));
        fs.updateDoc.mockImplementation(async (ref, data) => {
            rows = rows.map(([id, row]) => [id, id === ref.id ? { ...row, ...data } : row]);
        });
        renderDq();

        fireEvent.click(await screen.findByRole('button', { name: 'Delete Signed document – Offer Letter: Offer Letter.pdf' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete file' }));

        await waitFor(() => expect(fs.updateDoc).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'signed_req-1' }),
            { removedAt: 'SERVER_TIMESTAMP' },
        ));
        expect(fs.deleteDoc).not.toHaveBeenCalled();
        expect(storageMocks.deleteObject).not.toHaveBeenCalled();
        expect(await screen.findByText('No DQ files have been uploaded for this driver.')).toBeInTheDocument();
    });
});
