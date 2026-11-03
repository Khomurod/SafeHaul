// Dossier tab bodies contract, part 3 of 4: `NotesTab` — the read contract
// (paths, anonymisation, sanitisation, merge-and-sort) and the write contract.
// The shared history arrives as a prop, from the record the dossier has
// already read; the tab never reads that record itself.
// The shared harness — mock state, factories, fixtures and render builders —
// lives in `DossierBodies.contract.support.jsx`; the registrations below
// delegate to it. See that file's header for the scope of this freeze.
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./DossierBodies.contract.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./DossierBodies.contract.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./DossierBodies.contract.support')).firebaseStorageMock());
vi.mock('@shared/utils/activityLogger', async () => (await import('./DossierBodies.contract.support')).activityLoggerMock());
vi.mock('@features/applications/services/applicationPdfService', async () => (await import('./DossierBodies.contract.support')).applicationPdfServiceMock());
vi.mock('@features/auth/services/userService', async () => (await import('./DossierBodies.contract.support')).userServiceMock());

import { NotesTab } from './NotesTab';
import {
    makeRenderNotes,
    resetHarness,
    snap,
    fs,
    logActivity,
    getPortalUser,
} from './DossierBodies.contract.support';

const renderNotes = makeRenderNotes(NotesTab);

// This file queues `*Once` values, so it resets rather than only clearing
// (`.claude/rules/testing.md`); the harness then puts every default back.
beforeEach(() => {
    vi.resetAllMocks();
    resetHarness();
});

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

    /*
     * The loading line and the empty block share one slot, so both are the
     * approved page-state pattern, which is where "the three states of one slot
     * look alike" is a rule rather than a habit — and the empty one is announced
     * when the notes resolve.
     */
    it('uses the approved page-state pattern for both loading and empty', async () => {
        renderNotes();
        expect(screen.getByRole('status')).toHaveClass('ds-page-state');
        expect(screen.getByRole('heading', { name: 'Loading notes...', level: 3 })).toBeInTheDocument();

        await screen.findByText('No notes yet.');
        expect(screen.getByRole('status')).toHaveClass('ds-page-state');
        expect(screen.getByRole('heading', { name: 'No notes yet.', level: 3 })).toBeInTheDocument();
    });

    it('anonymises shared history and marks it as such', async () => {
        renderNotes({ sharedHistory: [{ text: 'Prior note', date: '2026-01-01T00:00:00.000Z' }] });

        expect(await screen.findByText('Previous Recruiter')).toBeInTheDocument();
        expect(screen.getByText('Shared History')).toBeInTheDocument();
        expect(screen.getByText('Prior note')).toBeInTheDocument();
    });

    it('sanitises shared history before showing it', async () => {
        renderNotes({ sharedHistory: [{ text: '<script>alert(1)</script>Prior note', date: '2026-01-01T00:00:00.000Z' }] });

        expect(await screen.findByText('Prior note')).toBeInTheDocument();
        expect(screen.queryByText(/alert\(1\)/)).not.toBeInTheDocument();
    });

    it('sorts local and shared notes newest first', async () => {
        fs.getDocs.mockResolvedValue(snap([
            ['n1', { text: 'older local', author: 'A', createdAt: { seconds: 1000 } }],
        ]));
        renderNotes({ sharedHistory: [{ text: 'newer shared', date: new Date(5_000_000).toISOString() }] });

        await screen.findByText('newer shared');
        const rendered = screen.getAllByText(/older local|newer shared/).map((n) => n.textContent);
        expect(rendered).toEqual(['newer shared', 'older local']);
    });

    it.each([
        ['an object', { text: 'not a list' }],
        ['a string', 'not a list'],
    ])('ignores a shared history that is %s and still shows the local notes', async (_kind, sharedHistory) => {
        fs.getDocs.mockResolvedValue(snap([
            ['n1', { text: 'local note', author: 'A', createdAt: { seconds: 1000 } }],
        ]));
        renderNotes({ sharedHistory });

        expect(await screen.findByText('local note')).toBeInTheDocument();
        expect(screen.queryByText('Previous Recruiter')).not.toBeInTheDocument();
        expect(screen.queryByText('Shared History')).not.toBeInTheDocument();
    });
});

describe('NotesTab — reads', () => {
    const NOTE = ['n1', { text: 'Called back about the start date', author: 'Test Recruiter', createdAt: { seconds: 1_800_000_000 } }];

    it('reads the notes and the writer’s name side by side, and not the record again', async () => {
        let releaseNotes;
        fs.getDocs.mockImplementation(() => new Promise((resolve) => { releaseNotes = resolve; }));
        renderNotes();

        await waitFor(() => expect(fs.getDocs).toHaveBeenCalledTimes(1));
        expect(getPortalUser).toHaveBeenCalledWith('user-1');

        releaseNotes(snap([NOTE]));
        expect(await screen.findByText('Called back about the start date')).toBeInTheDocument();
        // The dossier has already read the record and hands its shared history
        // in; the notes are read once, not again when the tab re-renders.
        expect(fs.getDoc).not.toHaveBeenCalled();
        expect(fs.getDocs).toHaveBeenCalledTimes(1);
    });

    it('does not read the notes again when the dossier re-renders with the same history', async () => {
        const sharedHistory = [{ text: 'Prior note', date: '2026-01-01T00:00:00.000Z' }];
        fs.getDocs.mockResolvedValue(snap([NOTE]));
        const { rerender } = renderNotes({ sharedHistory });
        expect(await screen.findByText('Prior note')).toBeInTheDocument();

        rerender(<NotesTab companyId="co-1" applicationId="app-1" sharedHistory={sharedHistory} />);

        expect(await screen.findByText('Called back about the start date')).toBeInTheDocument();
        expect(fs.getDocs).toHaveBeenCalledTimes(1);
        expect(fs.getDoc).not.toHaveBeenCalled();
    });

    it('shows the notes when the writer’s name cannot be read', async () => {
        fs.getDocs.mockResolvedValue(snap([NOTE]));
        getPortalUser.mockRejectedValue(new Error('offline'));
        renderNotes();

        expect(await screen.findByText('Called back about the start date')).toBeInTheDocument();
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

