/**
 * The dashboard's "Needs attention" card, for admins and the team alike: the
 * server's counts of what waits on someone, read once when the dashboard opens
 * and kept briefly, each row linking to the page that shows its records. With
 * nothing to show it is one calm line; a failed count says it could not be
 * checked and never breaks the dashboard. All names and ids are artificial.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { axe } from 'vitest-axe';

const zero = { status: 'ok', count: 0 };
const QUIET = {
    windows: { awaitingDays: 7, draftDays: 5, dqDays: 30 },
    rows: {
        sealFailed: zero,
        awaitingSignature: zero,
        pevWaiting: zero,
        pevNoResponse: zero,
        pendingChanges: zero,
        draftsExpiring: zero,
        dqExpiring: { status: 'ok', count: 0, drivers: [] },
    },
};

const fx = vi.hoisted(() => ({
    calls: [],
    answer: null,
    fails: false,
    gate: null,
    user: { uid: 'uid-1' },
}));

vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => async (payload) => {
        fx.calls.push(`${name} ${JSON.stringify(payload)}`);
        if (fx.gate) await fx.gate;
        if (fx.fails) throw Object.assign(new Error('internal'), { code: 'functions/internal' });
        return { data: structuredClone(fx.answer) };
    },
}));
vi.mock('@lib/firebase', () => ({
    functions: {},
    auth: { get currentUser() { return fx.user; } },
}));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));
// The dossier has suites of its own; here it only says which record it opened.
vi.mock('./modals/driver-dossier/DriverDossier', () => ({
    DriverDossier: ({ driverId, companyId, onClose }) => (
        <div role="dialog" aria-label={`Driver file ${driverId} of ${companyId}`}>
            <button type="button" onClick={onClose}>Close the driver file</button>
        </div>
    ),
}));

import { NeedsAttentionCard } from './NeedsAttentionCard';
import { ATTENTION_KEEP_MS, forgetDashboardAttention } from '../hooks/useDashboardAttention';

function Where() {
    const location = useLocation();
    return <p data-testid="where">{`${location.pathname}${location.search}${location.state?.segment ? ` [${location.state.segment}]` : ''}`}</p>;
}

function renderCard() {
    return render(
        <MemoryRouter initialEntries={['/company/dashboard']}>
            <Routes>
                <Route path="*" element={<><NeedsAttentionCard companyId="co-1" /><Where /></>} />
            </Routes>
        </MemoryRouter>,
    );
}

const withRows = (rows) => ({ ...QUIET, rows: { ...QUIET.rows, ...rows } });

beforeEach(() => {
    fx.answer = structuredClone(QUIET);
});

afterEach(() => {
    cleanup();
    forgetDashboardAttention();
    Object.assign(fx, { calls: [], answer: null, fails: false, gate: null, user: { uid: 'uid-1' } });
    vi.restoreAllMocks();
});

describe('reading', () => {
    it('asks the server once, for this company only, and is one calm line when nothing needs attention', async () => {
        renderCard();

        expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
        expect(fx.calls).toEqual(['getDashboardAttention {"companyId":"co-1"}']);
        expect(screen.queryByRole('heading', { name: 'Needs attention' })).toBeNull();
    });

    it('says while it checks, without claiming anything', async () => {
        let open;
        fx.gate = new Promise((resolve) => { open = resolve; });
        renderCard();

        expect(screen.getByRole('status')).toHaveTextContent('Checking what needs attention…');
        expect(screen.queryByText('Nothing needs attention right now.')).toBeNull();

        await act(async () => { open(); });
        expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
    });

    it('keeps the answer briefly: the dashboard opened again soon after does not count again', async () => {
        const now = vi.spyOn(Date, 'now');
        now.mockReturnValue(1_000_000);
        const first = renderCard();
        expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
        first.unmount();

        now.mockReturnValue(1_000_000 + ATTENTION_KEEP_MS - 1);
        const second = renderCard();
        expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
        expect(fx.calls).toHaveLength(1);
        second.unmount();

        now.mockReturnValue(1_000_000 + ATTENTION_KEEP_MS);
        renderCard();
        await waitFor(() => expect(fx.calls).toHaveLength(2));
        expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
    });

    it('reads again for another sign-in', async () => {
        const first = renderCard();
        expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
        first.unmount();

        fx.user = { uid: 'uid-2' };
        renderCard();
        await waitFor(() => expect(fx.calls).toHaveLength(2));
    });
});

describe('the rows', () => {
    it('lists each row with something to show, with a link to the page that shows those records', async () => {
        fx.answer = withRows({
            sealFailed: { status: 'ok', count: 2 },
            awaitingSignature: { status: 'ok', count: 1 },
            pevNoResponse: { status: 'ok', count: 1 },
            draftsExpiring: { status: 'ok', count: 3 },
        });
        renderCard();

        expect(await screen.findByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
        expect(screen.getByText('4 things to look at.')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: '2 signed documents could not be sealed' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: '1 PEV request is marked no response' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /waiting for the employer/ })).toBeNull();
        expect(screen.getByRole('link', { name: 'Open documents' })).toHaveAttribute('href', '/company/e-docs');
        expect(screen.getByRole('link', { name: 'Open sent documents' })).toHaveAttribute('href', '/company/e-docs?view=sent');
        expect(screen.getByRole('link', { name: 'Open unfinished applications' })).toHaveAttribute('href', '/company/drivers/unfinished');
        // The PEV rows have no page of their own.
        expect(screen.getAllByRole('link')).toHaveLength(3);

        fireEvent.click(screen.getByRole('link', { name: 'Open sent documents' }));
        expect(screen.getByTestId('where')).toHaveTextContent('/company/e-docs?view=sent');
    });

    it('says a failed count could not be checked, and still shows the rest', async () => {
        fx.answer = withRows({ sealFailed: { status: 'failed' }, pendingChanges: { status: 'ok', count: 1 } });
        renderCard();

        expect(await screen.findByRole('heading', { name: 'Documents whose seal failed (not checked)' })).toBeInTheDocument();
        expect(screen.getByText('This could not be checked just now.')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: '1 driver has company changes to approve' })).toBeInTheDocument();
        expect(screen.getByText('1 thing to look at. Some could not be checked just now.')).toBeInTheDocument();
    });

    it('says when nothing could be checked but nothing was found either', async () => {
        fx.answer = withRows({ pevWaiting: { status: 'failed' } });
        renderCard();

        expect(await screen.findByText('Some things could not be checked just now.')).toBeInTheDocument();
        expect(screen.queryByText('Nothing needs attention right now.')).toBeNull();
    });

    it('names the hired drivers whose DQ documents expire, each opening the driver\'s file', async () => {
        fx.answer = withRows({
            dqExpiring: {
                status: 'ok',
                count: 3,
                drivers: [
                    { id: 'app-1', name: 'Ben Hauler', date: '2020-01-15' },
                    { id: 'app-2', name: 'Ann Driver', date: '2999-02-01' },
                ],
            },
        });
        renderCard();

        expect(await screen.findByRole('heading', { name: '3 hired drivers have DQ documents that expire within 30 days or have expired' })).toBeInTheDocument();
        expect(screen.getByText('expired Jan 15, 2020')).toBeInTheDocument();
        expect(screen.getByText('expires Feb 1, 2999')).toBeInTheDocument();
        expect(screen.getByText('1 more')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Ann Driver' }));
        expect(screen.getByRole('dialog', { name: 'Driver file app-2 of co-1' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close the driver file' }));
        expect(screen.queryByRole('dialog')).toBeNull();

        fireEvent.click(screen.getByRole('link', { name: 'Open hired drivers' }));
        expect(screen.getByTestId('where')).toHaveTextContent('/company/drivers/applications [hired]');
    });

    it('has no accessibility violations', async () => {
        fx.answer = withRows({
            sealFailed: { status: 'failed' },
            pevWaiting: { status: 'ok', count: 2 },
            dqExpiring: { status: 'ok', count: 1, drivers: [{ id: 'app-1', name: 'Ann Driver', date: '2999-02-01' }] },
        });
        const { container } = renderCard();

        expect(await screen.findByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('when the read fails', () => {
    it('says so in one line with Try again, which reads anew', async () => {
        fx.fails = true;
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        renderCard();

        expect(await screen.findByText('What needs attention could not be checked just now.')).toBeInTheDocument();
        expect(screen.queryByText('Nothing needs attention right now.')).toBeNull();

        fx.fails = false;
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
        expect(fx.calls).toHaveLength(2);
    });

    it('takes an answer without rows as a failed read', async () => {
        fx.answer = { success: true };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        renderCard();

        expect(await screen.findByText('What needs attention could not be checked just now.')).toBeInTheDocument();
    });
});
