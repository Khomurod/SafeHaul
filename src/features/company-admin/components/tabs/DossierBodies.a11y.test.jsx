// Dossier tab bodies contract, part 4 of 4: jsdom axe proofs for all three
// tab bodies in their populated, dialog-open and empty states.
// The shared harness — mock state, factories, fixtures and render builders —
// lives in `DossierBodies.contract.support.jsx`; the registrations below
// delegate to it. See that file's header for the scope of this freeze.
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./DossierBodies.contract.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./DossierBodies.contract.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./DossierBodies.contract.support')).firebaseStorageMock());
vi.mock('@shared/utils/activityLogger', async () => (await import('./DossierBodies.contract.support')).activityLoggerMock());
vi.mock('@features/applications/services/applicationPdfService', async () => (await import('./DossierBodies.contract.support')).applicationPdfServiceMock());
vi.mock('@features/auth/services/userService', async () => (await import('./DossierBodies.contract.support')).userServiceMock());

import { DQFileTab } from './DQFileTab';
import { ActivityHistoryTab } from './ActivityHistoryTab';
import { NotesTab } from './NotesTab';
import {
    makeRenderDq,
    makeRenderActivity,
    makeRenderNotes,
    resetHarness,
    snap,
    DQ_FILE,
    LOGS,
    fs,
} from './DossierBodies.contract.support';

const renderDq = makeRenderDq(DQFileTab);
const renderActivity = makeRenderActivity(ActivityHistoryTab);
const renderNotes = makeRenderNotes(NotesTab);

beforeEach(resetHarness);

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
