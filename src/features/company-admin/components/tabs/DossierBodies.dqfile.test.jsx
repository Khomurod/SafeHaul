// Dossier tab bodies contract, part 1 of 4: `DQFileTab` — file listing and
// expiration status, the preserved application original, the upload and
// delete contracts, and auto-sync from the parent application.
// The shared harness — mock state, factories, fixtures and render builders —
// lives in `DossierBodies.contract.support.jsx`; the registrations below
// delegate to it. See that file's header for the scope of this freeze.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./DossierBodies.contract.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./DossierBodies.contract.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./DossierBodies.contract.support')).firebaseStorageMock());
vi.mock('@shared/utils/activityLogger', async () => (await import('./DossierBodies.contract.support')).activityLoggerMock());
vi.mock('@features/applications/services/applicationPdfService', async () => (await import('./DossierBodies.contract.support')).applicationPdfServiceMock());
vi.mock('@features/auth/services/userService', async () => (await import('./DossierBodies.contract.support')).userServiceMock());

import { DQFileTab } from './DQFileTab';
import {
    makeRenderDq,
    resetHarness,
    snap,
    DQ_FILE,
    fs,
    storageMocks,
    logActivity,
    downloadPreserved,
} from './DossierBodies.contract.support';

const renderDq = makeRenderDq(DQFileTab);

beforeEach(resetHarness);


describe('DQFileTab — file listing and expiration status', () => {
    it('offers the eleven frozen DQ file types with the first as default', async () => {
        renderDq();
        const select = await screen.findByLabelText('File Type');
        expect(select).toHaveValue('Application for Employment');
        expect([...select.options]).toHaveLength(11);
        expect([...select.options].map((o) => o.value)).toContain('Clearinghouse Report (Annual)');
    });

    it('shows the frozen empty state', async () => {
        renderDq();
        expect(await screen.findByText('No DQ files have been uploaded for this driver.')).toBeInTheDocument();
    });

    it.each([
        ['an already-past date', '2020-01-01', 'EXPIRED'],
        ['a far-future date', '2999-01-01', 'Active'],
    ])('renders %s as text, never colour alone', async (_name, expirationDate, label) => {
        fs.getDocs.mockResolvedValue(snap([['f1', { ...DQ_FILE, expirationDate }]]));
        renderDq();
        expect(await screen.findByText(`${label} (${expirationDate})`)).toBeInTheDocument();
    });

    it('announces a load failure with the frozen message', async () => {
        fs.getDocs.mockRejectedValueOnce(new Error('denied'));
        renderDq();
        expect(await screen.findByText('Could not load DQ files. Check permissions.')).toBeInTheDocument();
    });

    it('names both per-row controls by the file they act on', async () => {
        fs.getDocs.mockResolvedValue(snap([['f1', DQ_FILE]]));
        renderDq();

        /*
         * The frozen part is that the name identifies *which* file the control
         * acts on — "Delete" repeated down a column is unusable. It is asserted
         * as a prefix rather than an exact string because `IconButtonLink`
         * appends "(opens in a new tab)" to an `external` link's name, which is
         * additive information, not a change to what the control is called.
         */
        const download = await screen.findByRole('link', { name: /^Download Medical Card: medcard\.pdf/ });
        expect(download).toHaveAttribute('href', DQ_FILE.url);
        expect(download).not.toHaveAttribute('title');
        expect(download).toHaveAccessibleName(expect.stringContaining('opens in a new tab'));
        expect(screen.getByRole('button', { name: 'Delete Medical Card: medcard.pdf' })).toBeInTheDocument();
    });
});

describe('DQFileTab — the preserved application original', () => {
    const PRESERVED = {
        fileType: 'Application for Employment',
        fileName: 'Driver-Application-Marcus-Delgado-2026-07-14.pdf',
        // No durable link, on purpose.
        url: null,
        storagePath: 'application_originals/co-1/app-1/v1.pdf',
        requiresAuditedAccess: true,
        snapshotId: 'v1',
    };

    it('fetches it through the audited callable rather than a bucket link', async () => {
        fs.getDocs.mockResolvedValue(snap([['preserved-1', PRESERVED]]));
        renderDq();

        const download = await screen.findByRole('button', {
            name: /Download Application for Employment/i,
        });
        // A button, not an anchor: there is no URL to put in an href.
        expect(download.tagName).toBe('BUTTON');

        fireEvent.click(download);
        await waitFor(() => expect(downloadPreserved).toHaveBeenCalledWith({
            companyId: 'co-1',
            applicationId: 'app-1',
            snapshotId: 'v1',
        }));
    });

    it('offers no delete control for the evidentiary record', async () => {
        fs.getDocs.mockResolvedValue(snap([['preserved-1', PRESERVED]]));
        renderDq();

        await screen.findByRole('button', { name: /Download Application for Employment/i });
        expect(screen.queryByRole('button', { name: /Delete Application for Employment/i })).toBeNull();
    });

    it('keeps the ordinary link-and-delete controls for every other DQ file', async () => {
        fs.getDocs.mockResolvedValue(snap([['dq-1', DQ_FILE]]));
        renderDq();

        const link = await screen.findByRole('link', { name: /Download Medical Card/i });
        expect(link.getAttribute('href')).toBe(DQ_FILE.url);
        expect(screen.getByRole('button', { name: /Delete Medical Card/i })).toBeTruthy();
    });

    it('announces a failure instead of pretending the document was produced', async () => {
        fs.getDocs.mockResolvedValue(snap([['preserved-1', PRESERVED]]));
        downloadPreserved.mockRejectedValue(new Error('You do not have permission to open this application document.'));
        renderDq();

        fireEvent.click(await screen.findByRole('button', { name: /Download Application for Employment/i }));
        expect(await screen.findByText(/do not have permission/i)).toBeTruthy();
    });
});

describe('DQFileTab — upload contract', () => {
    async function uploadFixture() {
        renderDq();
        const input = await screen.findByLabelText('File');
        const file = new File(['x'], 'road test.pdf', { type: 'application/pdf' });
        fireEvent.change(screen.getByLabelText('File Type'), { target: { value: 'Road Test Certificate' } });
        fireEvent.change(input, { target: { files: [file] } });
        fireEvent.click(screen.getByRole('button', { name: /Upload File/ }));
        return file;
    }

    it('writes to the frozen Storage path, keeping "applications" even for leads', async () => {
        render(<DQFileTab companyId="co-1" applicationId="app-1" collectionName="leads" />);
        const file = new File(['x'], 'road test.pdf', { type: 'application/pdf' });
        fireEvent.change(await screen.findByLabelText('File Type'), { target: { value: 'Road Test Certificate' } });
        fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
        fireEvent.click(screen.getByRole('button', { name: /Upload File/ }));

        await waitFor(() => expect(storageMocks.ref).toHaveBeenCalledWith(
            {},
            'companies/co-1/applications/app-1/dq_files/Road_Test_Certificate_road test.pdf',
        ));
    });

    it('writes the frozen Firestore document shape', async () => {
        await uploadFixture();

        await waitFor(() => expect(fs.addDoc).toHaveBeenCalled());
        expect(fs.addDoc.mock.calls[0][1]).toMatchObject({
            fileType: 'Road Test Certificate',
            fileName: 'road test.pdf',
            url: 'https://example.test/signed',
            storagePath: 'companies/co-1/applications/app-1/dq_files/Road_Test_Certificate_road test.pdf',
            applicantId: null,
            driverId: null,
            userId: null,
            ownerUserIds: ['app-1'],
        });
        expect(fs.addDoc.mock.calls[0][1].createdAt).toBeInstanceOf(Date);
    });

    it('logs the upload with the frozen action and detail string', async () => {
        await uploadFixture();
        await waitFor(() => expect(logActivity).toHaveBeenCalledWith(
            'co-1',
            'applications',
            'app-1',
            'dq_file_uploaded',
            'Uploaded DQ file: Road Test Certificate - road test.pdf',
            'user',
        ));
    });

    it('announces the upload outcome and resets the type to the first option', async () => {
        await uploadFixture();
        expect(await screen.findByText('Upload Complete!')).toBeInTheDocument();
        expect(screen.getByLabelText('File Type')).toHaveValue('Application for Employment');
    });

    it('announces an upload failure with the frozen prefix', async () => {
        storageMocks.uploadBytes.mockRejectedValueOnce(new Error('quota'));
        await uploadFixture();
        expect(await screen.findByText(/Upload failed: quota/)).toBeInTheDocument();
    });

    it('guards the upload when no file is chosen', async () => {
        renderDq();
        await screen.findByLabelText('File Type');
        expect(screen.getByRole('button', { name: /Upload File/ })).toBeDisabled();
    });
});

describe('DQFileTab — delete contract (blocking confirm replaced)', () => {
    it('deletes from Storage then Firestore, then logs, behind an accessible dialog', async () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);
        fs.getDocs.mockResolvedValue(snap([['f1', DQ_FILE]]));

        renderDq();
        fireEvent.click(await screen.findByRole('button', { name: 'Delete Medical Card: medcard.pdf' }));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Are you sure you want to delete "medcard.pdf"?')).toBeInTheDocument();
        expect(confirmSpy).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete file' }));

        await waitFor(() => expect(storageMocks.deleteObject).toHaveBeenCalled());
        await waitFor(() => expect(fs.deleteDoc).toHaveBeenCalled());
        expect(storageMocks.deleteObject.mock.invocationCallOrder[0])
            .toBeLessThan(fs.deleteDoc.mock.invocationCallOrder[0]);
        await waitFor(() => expect(logActivity).toHaveBeenCalledWith(
            'co-1', 'applications', 'app-1',
            'dq_file_deleted',
            'Deleted DQ file: Medical Card - medcard.pdf',
            'user',
        ));
        vi.unstubAllGlobals();
    });

    it('does not delete when the confirmation is cancelled', async () => {
        fs.getDocs.mockResolvedValue(snap([['f1', DQ_FILE]]));
        renderDq();
        fireEvent.click(await screen.findByRole('button', { name: 'Delete Medical Card: medcard.pdf' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
        expect(storageMocks.deleteObject).not.toHaveBeenCalled();
    });
});

describe('DQFileTab — auto-sync from the parent application', () => {
    it('syncs an unsynced parent upload with the frozen payload and expiration', async () => {
        fs.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({
                'medical-card-upload': { url: 'https://example.test/mc', name: 'mc.jpg', storagePath: 'p/mc.jpg' },
                medCardExpiration: '2027-05-01',
                driverId: 'driver-9',
            }),
        });
        renderDq();

        await waitFor(() => expect(fs.addDoc).toHaveBeenCalled());
        expect(fs.addDoc.mock.calls[0][1]).toMatchObject({
            fileType: 'Medical Card',
            fileName: 'mc.jpg',
            url: 'https://example.test/mc',
            storagePath: 'p/mc.jpg',
            isSynced: true,
            sourceField: 'medical-card-upload',
            expirationDate: '2027-05-01',
            ownerUserIds: ['driver-9'],
        });
    });

    it('does not re-sync a file whose url is already present', async () => {
        fs.getDocs.mockResolvedValue(snap([['f1', { ...DQ_FILE, url: 'https://example.test/mc' }]]));
        fs.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ 'medical-card-upload': { url: 'https://example.test/mc' } }),
        });
        renderDq();

        await waitFor(() => expect(fs.getDocs).toHaveBeenCalled());
        expect(fs.addDoc).not.toHaveBeenCalled();
    });
});

