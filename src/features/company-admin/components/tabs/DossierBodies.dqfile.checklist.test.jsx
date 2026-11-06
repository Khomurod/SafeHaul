// Dossier tab bodies contract, `DQFileTab`: what the DQ file holds and what it
// does not (the checklist above the list), and the valid-until dates — on a team
// upload of a CDL, medical card or MVR, and set or cleared on a record of those
// kinds. Dates are judged by the UTC day. The shared harness lives in
// `DossierBodies.contract.support.jsx`. All names and files are artificial.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./DossierBodies.contract.support')).libFirebaseMock());
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/firestore', async () => (await import('./DossierBodies.contract.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./DossierBodies.contract.support')).firebaseStorageMock());
vi.mock('@shared/utils/activityLogger', async () => (await import('./DossierBodies.contract.support')).activityLoggerMock());
vi.mock('@features/applications/services/applicationPdfService', async () => (await import('./DossierBodies.contract.support')).applicationPdfServiceMock());
vi.mock('@features/auth/services/userService', async () => (await import('./DossierBodies.contract.support')).userServiceMock());
vi.mock('./dqFileSync', async () => (await import('./DossierBodies.contract.support')).dqFileSyncMock());
vi.mock('@features/applications/services/applicationFileLink', async () => (await import('./DossierBodies.contract.support')).applicationFileLinkMock());

import { DQFileTab } from './DQFileTab';
import { fs, logActivity, resetHarness, snap, SYNCED_DRIVER_UPLOAD } from './DossierBodies.contract.support';

const renderDq = (props = {}) => render(<DQFileTab companyId="co-1" applicationId="app-1" {...props} />);

beforeEach(() => {
    resetHarness();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T15:00:00Z'));
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const checklist = () => screen.getByRole('region', { name: "What's in the file" });
/** The list of files, below the checklist (whose medical card row shows the same date). */
const fileList = () => screen.getByRole('heading', { name: 'Files' }).parentElement;
/** The checklist's row for an item, found by its label. */
const row = (label) => within(checklist()).getByText(label).closest('li');

describe('DQFileTab — what the file holds and what it does not', () => {
    it('lists each item with what the file holds, above the files', async () => {
        fs.getDocs.mockResolvedValue(snap([
            ['application-pdf-v1', { fileType: 'Application for Employment', fileName: 'Driver-Application.pdf', url: null, source: 'preserved_submission', requiresAuditedAccess: true, snapshotId: 'v1' }],
            ['license_front', { ...SYNCED_DRIVER_UPLOAD, type: 'license_front', expirationDate: '2029-06-30' }],
            ['medical_card', { type: 'medical_card', fileType: 'Medical Card', fileName: 'med.jpg', isSynced: true, expirationDate: '2026-10-01', storagePath: 'companies/co-1/applications/guest_uploads/1_med.jpg' }],
        ]));
        renderDq();

        expect(await screen.findByRole('region', { name: "What's in the file" })).toBeInTheDocument();
        expect(within(row('Application for employment')).getByText('In file')).toBeInTheDocument();
        expect(within(row('CDL')).getByText('Valid until Jun 30, 2029')).toBeInTheDocument();
        expect(within(row('Medical card')).getByText('Expired')).toBeInTheDocument();
        expect(within(row('Medical card')).getByText('Expired on Oct 1, 2026')).toBeInTheDocument();
        expect(within(row('MVR')).getByText('Missing')).toBeInTheDocument();
        // No employers on the record: nothing to verify, and not counted as missing.
        expect(within(row('Previous employers, last 3 years')).getByText('None listed')).toBeInTheDocument();
        expect(within(row('Previous employers, last 3 years')).getByText('No employers listed for the last three years.')).toBeInTheDocument();
        // Optional, and only shown: never counted as missing.
        expect(within(row('PSP report')).getByText('Optional')).toBeInTheDocument();
        expect(within(row('PSP report')).getByText('Not in file')).toBeInTheDocument();
        expect(within(checklist()).getByText('3 missing, 1 expired.')).toBeInTheDocument();
        // It says what the file holds; it claims nothing more.
        expect(checklist()).not.toHaveTextContent(/complian(t|ce) (file|achieved)|complete DQ/i);

        // The checklist, then the files, then the upload form.
        const lists = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
        expect(lists).toEqual(["What's in the file", 'Files', 'Upload a file']);
    });

    it("lists the employers of the three years with what each verification says", async () => {
        renderDq({
            appData: {
                lifecycle: { submittedAt: '2026-10-01T12:00:00.000Z' },
                employers: [
                    { companyName: 'Prairie Line Freight', endDate: '', verification: { status: 'Completed' } },
                    { companyName: 'Lakeshore Hauling', endDate: '2024-05', verification: { status: 'Sent' } },
                    { companyName: 'Old Mesa Carriers', endDate: '2019-02' },
                ],
            },
        });

        const pev = await waitFor(() => row('Previous employers, last 3 years'));
        // Employers are verified, not filed: the badge says how far that went.
        expect(within(pev).getByText('Not all done')).toBeInTheDocument();
        expect(within(pev).getByText('Prairie Line Freight: answered')).toBeInTheDocument();
        expect(within(pev).getByText('Lakeshore Hauling: request sent, no answer yet')).toBeInTheDocument();
        expect(within(pev).queryByText(/Old Mesa Carriers/)).toBeNull();
    });

    it('says every employer of the three years is done (answered or no answer after the attempts), not "in file"', async () => {
        renderDq({
            appData: {
                lifecycle: { submittedAt: '2026-10-01T12:00:00.000Z' },
                employers: [
                    { companyName: 'Prairie Line Freight', endDate: '', verification: { status: 'Completed' } },
                    { companyName: 'Lakeshore Hauling', endDate: '2024-05', verification: { status: 'No Response' } },
                ],
            },
        });

        const pev = await waitFor(() => row('Previous employers, last 3 years'));
        expect(within(pev).getByText('All done')).toBeInTheDocument();
        expect(within(pev).queryByText('In file')).toBeNull();
    });

    it("opens the upload form on an item the file lacks or holds expired, with the item's type chosen", async () => {
        fs.getDocs.mockResolvedValue(snap([
            ['license_front', { ...SYNCED_DRIVER_UPLOAD, type: 'license_front', expirationDate: '2029-06-30' }],
            ['medical_card', { type: 'medical_card', fileType: 'Medical Card', fileName: 'med.jpg', isSynced: true, expirationDate: '2026-10-01', storagePath: 'companies/co-1/applications/guest_uploads/1_med.jpg' }],
        ]));
        renderDq();

        const upload = await waitFor(() => within(row('MVR')).getByRole('button', { name: 'Upload MVR' }));
        // What the file holds needs nothing.
        expect(within(row('CDL')).queryByRole('button')).toBeNull();
        expect(within(row('PSP report')).getByRole('button', { name: 'Upload PSP report' })).toBeInTheDocument();

        fireEvent.click(upload);
        expect(screen.getByLabelText('File Type')).toHaveValue('MVR (Annual)');
        // A dated type starts at its date, so the forward path meets it before the file.
        await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Valid until (optional)')));

        // An undated one starts at the file.
        fireEvent.click(within(row('PSP report')).getByRole('button', { name: 'Upload PSP report' }));
        expect(screen.queryByLabelText('Valid until (optional)')).toBeNull();
        await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('File')));

        // An expired one is renewed the same way.
        fireEvent.click(within(row('Medical card')).getByRole('button', { name: 'Upload Medical card' }));
        expect(screen.getByLabelText('File Type')).toHaveValue('Medical Card');
    });

    it('leads from the employers to the Previous Employment tab, where they are verified', async () => {
        const onOpenTab = vi.fn();
        renderDq({
            onOpenTab,
            appData: {
                lifecycle: { submittedAt: '2026-10-01T12:00:00.000Z' },
                employers: [{ companyName: 'Prairie Line Freight', endDate: '', verification: { status: 'Sent' } }],
            },
        });

        const pev = await waitFor(() => row('Previous employers, last 3 years'));
        fireEvent.click(within(pev).getByRole('button', { name: 'Open Previous Employment' }));
        expect(onOpenTab).toHaveBeenCalledWith('pev');
        expect(within(pev).queryByRole('button', { name: /^Upload/ })).toBeNull();
    });

    it('offers no way to another tab where none was given', async () => {
        renderDq();
        const pev = await waitFor(() => row('Previous employers, last 3 years'));
        expect(within(pev).queryByRole('button')).toBeNull();
    });

    it('waits for the files before it says anything is missing', async () => {
        let resolve;
        fs.getDocs.mockImplementation(() => new Promise((done) => { resolve = done; }));
        renderDq();

        await screen.findByText('Loading DQ files...');
        expect(screen.queryByRole('region', { name: "What's in the file" })).toBeNull();
        resolve(snap([]));
        expect(await screen.findByRole('region', { name: "What's in the file" })).toBeInTheDocument();
    });

    it('is not shown when the files could not be read', async () => {
        fs.getDocs.mockRejectedValue(new Error('denied'));
        renderDq();

        expect(await screen.findByText('Could not load DQ files. Check permissions.')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: "What's in the file" })).toBeNull();
    });
});

describe('DQFileTab — a valid-until date on a team upload', () => {
    const choose = async (type) => {
        fireEvent.change(await screen.findByLabelText('File Type'), { target: { value: type } });
        fireEvent.change(screen.getByLabelText('File'), { target: { files: [new File(['x'], 'card.pdf', { type: 'application/pdf' })] } });
    };

    it('asks for it on a medical card, an MVR and a CDL, and saves it as a calendar day', async () => {
        renderDq();
        for (const type of ['Medical Card', 'MVR (Annual)', 'CDL']) {
            fireEvent.change(await screen.findByLabelText('File Type'), { target: { value: type } });
            expect(screen.getByLabelText('Valid until (optional)')).toHaveAttribute('type', 'date');
        }

        await choose('Medical Card');
        fireEvent.change(screen.getByLabelText('Valid until (optional)'), { target: { value: '2028-02-29' } });
        fireEvent.click(screen.getByRole('button', { name: /Upload File/ }));

        await waitFor(() => expect(fs.addDoc).toHaveBeenCalled());
        expect(fs.addDoc.mock.calls[0][1]).toMatchObject({ fileType: 'Medical Card', fileName: 'card.pdf', expirationDate: '2028-02-29' });
        // The field empties with the rest of the form.
        await screen.findByText('Upload Complete!');
        fireEvent.change(screen.getByLabelText('File Type'), { target: { value: 'Medical Card' } });
        expect(screen.getByLabelText('Valid until (optional)')).toHaveValue('');
    });

    it('stores no date when none was given, and offers none for a type without one', async () => {
        renderDq();
        await choose('Medical Card');
        fireEvent.click(screen.getByRole('button', { name: /Upload File/ }));
        await waitFor(() => expect(fs.addDoc).toHaveBeenCalled());
        expect(fs.addDoc.mock.calls[0][1]).not.toHaveProperty('expirationDate');

        fireEvent.change(screen.getByLabelText('File Type'), { target: { value: 'Road Test Certificate' } });
        expect(screen.queryByLabelText('Valid until (optional)')).toBeNull();
    });
});

describe('DQFileTab — the date on a record', () => {
    const MEDICAL = { fileType: 'Medical Card', fileName: 'medcard.pdf', url: 'https://example.test/medcard.pdf', storagePath: 'companies/co-1/applications/app-1/dq_files/1_Medical_Card_medcard.pdf', expirationDate: '2027-01-31' };

    it('shows it on the record in words', async () => {
        fs.getDocs.mockResolvedValue(snap([['f1', MEDICAL], ['f2', { ...MEDICAL, fileName: 'old.pdf', expirationDate: '2026-11-20' }]]));
        renderDq();

        await screen.findByRole('button', { name: /^Delete Medical Card: old\.pdf/ });
        expect(within(fileList()).getByText('Valid until Jan 31, 2027')).toBeInTheDocument();
        expect(within(fileList()).getByText('Expires on Nov 20, 2026, in 16 days')).toBeInTheDocument();
    });

    it('sets it, logs it, and gives the focus back to the control that opened it', async () => {
        let rows = [['f1', MEDICAL]];
        fs.getDocs.mockImplementation(async () => snap(rows));
        fs.updateDoc.mockImplementation(async (ref, data) => {
            rows = rows.map(([id, record]) => [id, id === ref.id ? { ...record, ...data } : record]);
        });
        renderDq();

        const edit = await screen.findByRole('button', { name: 'Set the valid-until date of Medical Card: medcard.pdf' });
        fireEvent.click(edit);
        const input = screen.getByLabelText('Valid until');
        expect(input).toHaveValue('2027-01-31');
        expect(document.activeElement).toBe(input);
        fireEvent.change(input, { target: { value: '2028-01-31' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save date' }));

        await waitFor(() => expect(within(fileList()).getByText('Valid until Jan 31, 2028')).toBeInTheDocument());
        expect(fs.updateDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }), { expirationDate: '2028-01-31' });
        expect(logActivity).toHaveBeenCalledWith(
            'co-1', 'applications', 'app-1', 'dq_file_updated',
            'Set the valid-until date of DQ file: Medical Card - medcard.pdf to 2028-01-31', 'user',
        );
        expect(screen.queryByLabelText('Valid until')).toBeNull();
        await waitFor(() => expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Set the valid-until date of Medical Card: medcard.pdf' }),
        ));
    });

    it('clears it when the field is left empty', async () => {
        // The list is read again after the save, and shows what was stored.
        let rows = [['f1', MEDICAL]];
        fs.getDocs.mockImplementation(async () => snap(rows));
        fs.updateDoc.mockImplementation(async (ref, data) => {
            rows = rows.map(([id, record]) => [id, id === ref.id
                ? { ...record, expirationDate: data.expirationDate === 'DELETE_FIELD' ? undefined : data.expirationDate }
                : record]);
        });
        renderDq();

        fireEvent.click(await screen.findByRole('button', { name: /^Set the valid-until date of Medical Card/ }));
        fireEvent.change(screen.getByLabelText('Valid until'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save date' }));

        await waitFor(() => expect(within(fileList()).queryByText('Valid until Jan 31, 2027')).toBeNull());
        expect(screen.queryByLabelText('Valid until')).toBeNull();
        expect(fs.updateDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }), { expirationDate: 'DELETE_FIELD' });
        expect(logActivity).toHaveBeenCalledWith(
            'co-1', 'applications', 'app-1', 'dq_file_updated',
            'Cleared the valid-until date of DQ file: Medical Card - medcard.pdf', 'user',
        );
    });

    it('says why when it cannot save, and keeps the editor open', async () => {
        fs.getDocs.mockResolvedValue(snap([['f1', MEDICAL]]));
        fs.updateDoc.mockRejectedValue(new Error('permission-denied'));
        renderDq();

        fireEvent.click(await screen.findByRole('button', { name: /^Set the valid-until date of Medical Card/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Save date' }));

        expect(await screen.findByText('Could not save the date: permission-denied')).toBeInTheDocument();
        expect(screen.getByLabelText('Valid until')).toBeInTheDocument();
        expect(logActivity).not.toHaveBeenCalled();
    });

    it("is offered on the driver's CDL, medical card and TWIC records, never on other documents", async () => {
        fs.getDocs.mockResolvedValue(snap([
            ['license_front', { ...SYNCED_DRIVER_UPLOAD, type: 'license_front' }],
            ['twic_card', { ...SYNCED_DRIVER_UPLOAD, type: 'twic_card', fileType: 'TWIC Card', fileName: 'twic.jpg' }],
            ['f1', { fileType: 'Road Test Certificate', fileName: 'road.pdf', url: 'https://example.test/road.pdf', storagePath: 'companies/co-1/applications/app-1/dq_files/1_road.pdf' }],
            ['application-pdf-v1', { fileType: 'Application for Employment', fileName: 'Driver-Application.pdf', url: null, requiresAuditedAccess: true, snapshotId: 'v1' }],
        ]));
        renderDq();

        expect(await screen.findByRole('button', { name: 'Set the valid-until date of CDL Front: cdl-front.jpg' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Set the valid-until date of TWIC Card: twic.jpg' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /valid-until date of Road Test/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /valid-until date of Application/ })).toBeNull();
    });
});
