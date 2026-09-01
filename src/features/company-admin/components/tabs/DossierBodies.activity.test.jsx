// Dossier tab bodies contract, part 2 of 4: `ActivityHistoryTab` — the read
// contract and the five filter rules.
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

import { ActivityHistoryTab } from './ActivityHistoryTab';
import {
    makeRenderActivity,
    resetHarness,
    snap,
    LOGS,
    fs,
} from './DossierBodies.contract.support';

const renderActivity = makeRenderActivity(ActivityHistoryTab);

beforeEach(resetHarness);

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

