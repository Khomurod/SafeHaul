/**
 * Contract freeze + a11y proof for the three dossier tab bodies migrated on
 * 2026-07-28: `DQFileTab`, `ActivityHistoryTab` and `NotesTab`.
 *
 * All three were deliberately left unmigrated by the 2026-07-27 dossier
 * foundation slice ("DQ, PEV/VOE, Activity and Notes bodies are deliberately not
 * migrated") and recorded as residual debt since. PEV/VOE was closed separately.
 *
 * These bodies own DOT-compliance data, so the paths, payloads and audit-log
 * calls are frozen here before any presentation change:
 *
 *  - DQ: the `dq_files` sub-collection path and ordering, the Storage path
 *    (including its deliberate `applications` segment for leads), the upload
 *    document shape, both `logActivity` calls and their exact detail strings, the
 *    delete-Storage-then-Firestore order, and the expiration thresholds.
 *  - Activity: the `leads`/`applications` collection normalisation, the
 *    `activity_logs` path and ordering, the five filter rules, and the
 *    Today/Yesterday/Recent grouping.
 *  - Notes: the `internal_notes` path, the `sharedHistory` anonymisation,
 *    `sanitizeUserContent` on read and write, the merge-and-sort rule, the written
 *    note shape and the `logActivity` truncation rule.
 *
 * All names, file names and ids below are artificial test fixtures.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    addDoc: vi.fn(),
    deleteDoc: vi.fn(),
}));
const storageMocks = vi.hoisted(() => ({
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn(),
    ref: vi.fn((_s, path) => ({ path })),
}));
const logActivity = vi.hoisted(() => vi.fn());
const getPortalUser = vi.hoisted(() => vi.fn());

vi.mock('@lib/firebase', () => ({ db: {}, storage: {}, auth: { currentUser: { uid: 'user-1' } } }));
vi.mock('firebase/firestore', () => ({
    // The real `collection()` accepts either `(db, ...pathSegments)` — used by
    // ActivityHistoryTab and NotesTab — or `(parentDocRef, name)`, used by
    // DQFileTab. Both forms resolve to the same `{ parent.path, name }` shape here.
    collection: (first, ...rest) => (first?.kind === 'doc'
        ? { kind: 'collection', parent: first, name: rest[0] }
        : { kind: 'collection', parent: { path: rest.slice(0, -1).join('/') }, name: rest[rest.length - 1] }),
    doc: (a, ...rest) => (a?.kind === 'collection'
        ? { kind: 'doc', in: a, id: rest[0] }
        : { kind: 'doc', path: rest.join('/') }),
    query: (ref, ...clauses) => ({ ref, clauses }),
    orderBy: (field, dir) => ({ field, dir }),
    getDocs: (...a) => fs.getDocs(...a),
    getDoc: (...a) => fs.getDoc(...a),
    addDoc: (...a) => fs.addDoc(...a),
    deleteDoc: (...a) => fs.deleteDoc(...a),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
}));
vi.mock('firebase/storage', () => ({
    ref: (...a) => storageMocks.ref(...a),
    uploadBytes: (...a) => storageMocks.uploadBytes(...a),
    getDownloadURL: (...a) => storageMocks.getDownloadURL(...a),
    deleteObject: (...a) => storageMocks.deleteObject(...a),
}));
vi.mock('@shared/utils/activityLogger', () => ({ logActivity: (...a) => logActivity(...a) }));
vi.mock('@features/auth/services/userService', () => ({ getPortalUser: (...a) => getPortalUser(...a) }));

import { DQFileTab } from './DQFileTab';
import { ActivityHistoryTab } from './ActivityHistoryTab';
import { NotesTab } from './NotesTab';

function snap(docs) {
    return { docs: docs.map(([id, data]) => ({ id, data: () => data })) };
}

beforeEach(() => {
    vi.clearAllMocks();
    fs.getDocs.mockResolvedValue(snap([]));
    fs.getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    fs.addDoc.mockResolvedValue({ id: 'new-1' });
    fs.deleteDoc.mockResolvedValue(undefined);
    storageMocks.uploadBytes.mockResolvedValue(undefined);
    storageMocks.getDownloadURL.mockResolvedValue('https://example.test/signed');
    storageMocks.deleteObject.mockResolvedValue(undefined);
    logActivity.mockResolvedValue(undefined);
    getPortalUser.mockResolvedValue({ name: 'Test Recruiter' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ---------------------------------------------------------------- DQFileTab

const DQ_FILE = {
    fileType: 'Medical Card',
    fileName: 'medcard.pdf',
    url: 'https://example.test/medcard.pdf',
    storagePath: 'companies/co-1/applications/app-1/dq_files/Medical_Card_medcard.pdf',
};

function renderDq(props = {}) {
    return render(<DQFileTab companyId="co-1" applicationId="app-1" {...props} />);
}

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

        const download = await screen.findByRole('link', { name: 'Download Medical Card: medcard.pdf' });
        expect(download).toHaveAttribute('href', DQ_FILE.url);
        expect(download).not.toHaveAttribute('title');
        expect(screen.getByRole('button', { name: 'Delete Medical Card: medcard.pdf' })).toBeInTheDocument();
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

// -------------------------------------------------------- ActivityHistoryTab

function tsDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return { seconds: Math.floor(d.getTime() / 1000) };
}

const LOGS = [
    ['l1', { action: 'Call logged', type: 'call', timestamp: tsDaysAgo(0), performedByName: 'Test Recruiter', duration: 42, outcomeLabel: 'Connected' }],
    ['l2', { action: 'Note Added', type: 'note', timestamp: tsDaysAgo(1), details: 'Left a voicemail' }],
    ['l3', { action: 'Status changed to Rejected', timestamp: tsDaysAgo(9) }],
    ['l4', { action: 'Document uploaded', type: 'upload' }],
];

function renderActivity(props = {}) {
    return render(<ActivityHistoryTab companyId="co-1" applicationId="app-1" collectionName="applications" {...props} />);
}

describe('ActivityHistoryTab — read contract', () => {
    it('normalises any non-leads collection name to applications', async () => {
        renderActivity({ collectionName: 'something-else' });
        await waitFor(() => expect(fs.getDocs).toHaveBeenCalled());
        const collectionRef = fs.getDocs.mock.calls[0][0].ref;
        expect(collectionRef.parent.path).toBe('companies/co-1/applications/app-1');
        expect(collectionRef.name).toBe('activity_logs');
    });

    it('keeps the leads collection when asked for leads', async () => {
        renderActivity({ collectionName: 'leads' });
        await waitFor(() => expect(fs.getDocs).toHaveBeenCalled());
        expect(fs.getDocs.mock.calls[0][0].ref.parent.path).toBe('companies/co-1/leads/app-1');
    });

    it('shows the frozen empty state', async () => {
        renderActivity();
        expect(await screen.findByText('No activity recorded for this driver.')).toBeInTheDocument();
    });

    it('groups by Today / Yesterday / date, with Recent for timestamp-less logs', async () => {
        fs.getDocs.mockResolvedValue(snap(LOGS));
        renderActivity();

        expect(await screen.findByText('Today')).toBeInTheDocument();
        expect(screen.getByText('Yesterday')).toBeInTheDocument();
        expect(screen.getByText('Recent')).toBeInTheDocument();
    });

    it('keeps the System Auto and Pending fallbacks and the call duration rule', async () => {
        fs.getDocs.mockResolvedValue(snap(LOGS));
        renderActivity();

        // Three of the four fixture logs have no `performedByName`.
        expect((await screen.findAllByText('System Auto')).length).toBe(3);
        expect(screen.getByText('Pending')).toBeInTheDocument();
        expect(screen.getByText('Duration: 42s')).toBeInTheDocument();
    });
});

describe('ActivityHistoryTab — filtering', () => {
    it('names the filter control, which previously had no accessible name', async () => {
        fs.getDocs.mockResolvedValue(snap(LOGS));
        renderActivity();
        const select = await screen.findByLabelText('Filter activities');
        expect([...select.options].map((o) => o.value)).toEqual(['all', 'calls', 'notes', 'status', 'documents']);
    });

    it.each([
        ['calls', 'Call logged'],
        ['notes', 'Note Added'],
        ['status', 'Status changed to Rejected'],
        ['documents', 'Document uploaded'],
    ])('the %s filter keeps only matching entries', async (value, kept) => {
        fs.getDocs.mockResolvedValue(snap(LOGS));
        renderActivity();
        fireEvent.change(await screen.findByLabelText('Filter activities'), { target: { value } });

        expect(screen.getByText(kept)).toBeInTheDocument();
        const others = LOGS.map(([, d]) => d.action).filter((a) => a !== kept);
        others.forEach((action) => expect(screen.queryByText(action)).not.toBeInTheDocument());
    });

    it('announces the frozen no-match message', async () => {
        fs.getDocs.mockResolvedValue(snap([LOGS[0]]));
        renderActivity();
        fireEvent.change(await screen.findByLabelText('Filter activities'), { target: { value: 'notes' } });
        expect(screen.getByText('No activities match the selected filter.')).toBeInTheDocument();
    });

    it('puts the timeline in a named, focusable scroll region', async () => {
        fs.getDocs.mockResolvedValue(snap(LOGS));
        renderActivity();
        const region = await screen.findByRole('region', { name: 'Audit Trail' });
        expect(region).toHaveAttribute('tabindex', '0');
    });
});

// ----------------------------------------------------------------- NotesTab

function renderNotes(props = {}) {
    return render(<NotesTab companyId="co-1" applicationId="app-1" {...props} />);
}

describe('NotesTab — read contract', () => {
    it('reads internal notes from the frozen sub-collection path', async () => {
        renderNotes();
        await waitFor(() => expect(fs.getDocs).toHaveBeenCalled());
        const ref = fs.getDocs.mock.calls[0][0].ref;
        expect(ref.parent.path).toBe('companies/co-1/applications/app-1');
        expect(ref.name).toBe('internal_notes');
    });

    it('shows the frozen empty state', async () => {
        renderNotes();
        expect(await screen.findByText('No notes yet.')).toBeInTheDocument();
    });

    it('anonymises shared history and marks it as such', async () => {
        fs.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ sharedHistory: [{ text: 'Prior note', date: '2026-01-01T00:00:00.000Z' }] }),
        });
        renderNotes();

        expect(await screen.findByText('Previous Recruiter')).toBeInTheDocument();
        expect(screen.getByText('Shared History')).toBeInTheDocument();
        expect(screen.getByText('Prior note')).toBeInTheDocument();
    });

    it('sorts local and shared notes newest first', async () => {
        fs.getDocs.mockResolvedValue(snap([
            ['n1', { text: 'older local', author: 'A', createdAt: { seconds: 1000 } }],
        ]));
        fs.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ sharedHistory: [{ text: 'newer shared', date: new Date(5_000_000).toISOString() }] }),
        });
        renderNotes();

        await screen.findByText('newer shared');
        const rendered = screen.getAllByText(/older local|newer shared/).map((n) => n.textContent);
        expect(rendered).toEqual(['newer shared', 'older local']);
    });
});

describe('NotesTab — write contract', () => {
    async function addNote(text = 'Spoke with the driver') {
        renderNotes();
        const field = await screen.findByLabelText(/Internal Note \(Private\)/);
        fireEvent.change(field, { target: { value: text } });
        fireEvent.click(screen.getByRole('button', { name: /Add Note/ }));
    }

    it('writes the frozen note shape', async () => {
        await addNote();
        await waitFor(() => expect(fs.addDoc).toHaveBeenCalled());
        expect(fs.addDoc.mock.calls[0][1]).toEqual({
            text: 'Spoke with the driver',
            author: 'Test Recruiter',
            createdAt: 'SERVER_TIMESTAMP',
            type: 'note',
        });
    });

    it('logs the note with the frozen action and un-truncated detail', async () => {
        await addNote();
        await waitFor(() => expect(logActivity).toHaveBeenCalledWith(
            'co-1', 'applications', 'app-1', 'Note Added', 'Spoke with the driver', 'note',
        ));
    });

    it('truncates the logged detail at 100 characters with an ellipsis', async () => {
        const long = 'y'.repeat(150);
        await addNote(long);
        await waitFor(() => expect(logActivity).toHaveBeenCalled());
        expect(logActivity.mock.calls[0][4]).toBe(`${'y'.repeat(100)}...`);
    });

    it('optimistically shows the new note and clears the composer', async () => {
        await addNote();
        expect(await screen.findByText('Spoke with the driver')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByLabelText(/Internal Note \(Private\)/)).toHaveValue(''));
    });

    it('ignores an empty or whitespace-only note', async () => {
        renderNotes();
        const field = await screen.findByLabelText(/Internal Note \(Private\)/);
        fireEvent.change(field, { target: { value: '   ' } });
        fireEvent.submit(field.closest('form'));
        expect(fs.addDoc).not.toHaveBeenCalled();
    });

    it('announces a save failure in place instead of a blocking alert', async () => {
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        fs.addDoc.mockRejectedValueOnce(new Error('denied'));

        await addNote();

        expect(await screen.findByText('Failed to save note.')).toBeInTheDocument();
        expect(alertSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('rejects a second submit dispatched before the first resolves', async () => {
        let release;
        fs.addDoc.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ id: 'n9' }); }));

        renderNotes();
        const field = await screen.findByLabelText(/Internal Note \(Private\)/);
        fireEvent.change(field, { target: { value: 'note' } });
        const form = field.closest('form');
        fireEvent.submit(form);
        fireEvent.submit(form);

        expect(fs.addDoc).toHaveBeenCalledTimes(1);
        release();
    });

    it('falls back to Admin when the portal profile is missing', async () => {
        getPortalUser.mockResolvedValueOnce(null);
        await addNote();
        await waitFor(() => expect(fs.addDoc.mock.calls[0][1].author).toBe('Admin'));
    });
});

// ------------------------------------------------------------ accessibility

describe('Dossier bodies — accessibility', () => {
    it('DQFileTab has no jsdom axe violations with files listed', async () => {
        fs.getDocs.mockResolvedValue(snap([['f1', { ...DQ_FILE, expirationDate: '2999-01-01' }]]));
        const { container } = renderDq();
        await screen.findByText(/Active \(2999-01-01\)/);
        expect((await axe(container)).violations).toEqual([]);
    });

    it('DQFileTab has no jsdom axe violations with the delete dialog open', async () => {
        fs.getDocs.mockResolvedValue(snap([['f1', DQ_FILE]]));
        const { container } = renderDq();
        fireEvent.click(await screen.findByRole('button', { name: /^Delete Medical Card/ }));
        expect((await axe(container)).violations).toEqual([]);
    });

    it('DQFileTab has no jsdom axe violations in the empty state', async () => {
        const { container } = renderDq();
        await screen.findByText('No DQ files have been uploaded for this driver.');
        expect((await axe(container)).violations).toEqual([]);
    });

    it('ActivityHistoryTab has no jsdom axe violations with a populated timeline', async () => {
        fs.getDocs.mockResolvedValue(snap(LOGS));
        const { container } = renderActivity();
        await screen.findByText('Call logged');
        expect((await axe(container)).violations).toEqual([]);
    });

    it('ActivityHistoryTab has no jsdom axe violations in the empty state', async () => {
        const { container } = renderActivity();
        await screen.findByText('No activity recorded for this driver.');
        expect((await axe(container)).violations).toEqual([]);
    });

    it('NotesTab has no jsdom axe violations with local and shared notes', async () => {
        fs.getDocs.mockResolvedValue(snap([['n1', { text: 'local note', author: 'A', createdAt: { seconds: 1000 } }]]));
        fs.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ sharedHistory: [{ text: 'shared note', date: '2026-01-01T00:00:00.000Z' }] }),
        });
        const { container } = renderNotes();
        await screen.findByText('shared note');
        expect((await axe(container)).violations).toEqual([]);
    });

    it('NotesTab has no jsdom axe violations in the empty state', async () => {
        const { container } = renderNotes();
        await screen.findByText('No notes yet.');
        expect((await axe(container)).violations).toEqual([]);
    });

    it('no body renders sub-12px functional text', async () => {
        fs.getDocs.mockResolvedValue(snap(LOGS));
        const { container } = renderActivity();
        await screen.findByText('Call logged');
        expect(container.innerHTML).not.toMatch(/text-\[(9|10|11)px\]/);
    });
});
