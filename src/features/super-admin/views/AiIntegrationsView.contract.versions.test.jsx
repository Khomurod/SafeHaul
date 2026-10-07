/**
 * Model versions: the table of versions each service uses, "Check versions
 * now", and the auto-select switch.
 *
 * Part of the AiIntegrationsView contract suite. The fixtures, callable stubs,
 * spies and the security-proof context live in
 * `AiIntegrationsView.contract.support.jsx`. Each `vi.mock` below has to stay in
 * this file, because vitest hoists it per file and cannot register one from a
 * helper.
 */

import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./AiIntegrationsView.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./AiIntegrationsView.contract.support')).libFirebaseMock());
vi.mock('firebase/auth', async () => (await import('./AiIntegrationsView.contract.support')).firebaseAuthMock());
vi.mock('@shared/components/feedback', async () => (await import('./AiIntegrationsView.contract.support')).feedbackMock());

import {
    callables,
    reauthenticateWithCredential,
    renderView,
    resetHarness,
    showInfo,
    showSuccess,
    stubCallables,
    versionsFor,
} from './AiIntegrationsView.contract.support';

const lane = (id, models, extra = {}) => ({ id, models: models.map((model) => (typeof model === 'string' ? { id: model, result: null } : model)), status: 'ok', suggested: null, ...extra });
const ROWS = [
    {
        id: 'gemini', displayName: 'Google Gemini', state: 'ready', account: null,
        checkedAt: '2026-10-08T08:25:00.000Z', reason: 'daily',
        lanes: [
            lane('vision', [{ id: 'gemini-3.7-flash', result: 'passed' }, { id: 'gemini-3.6-flash', result: 'busy' }]),
            lane('text', [{ id: 'gemini-3.5-flash-lite', result: 'misread' }], { status: 'failing' }),
        ],
    },
    {
        id: 'groq', displayName: 'Groq', state: 'ready', account: 'key', checkedAt: '2026-10-08T08:25:00.000Z', reason: 'failing',
        lanes: [lane('vision', ['qwen/qwen3.8-27b'], { status: 'unknown' }), lane('text', ['openai/gpt-oss-20b'], { status: null })],
    },
    {
        id: 'mistral', displayName: 'Mistral', state: 'off', account: null, checkedAt: null, reason: null,
        lanes: [lane('vision', ['ministral-14b-2512']), lane('text', ['ministral-14b-2512'])],
    },
    {
        id: 'cerebras', displayName: 'Cerebras', state: 'not_set_up', account: null, checkedAt: null, reason: null,
        lanes: [lane('text', ['llama-4-scout'])],
    },
];

const versionsTable = () => screen.getByRole('table', { name: 'AI model versions' });
const rowFor = (name) => within(versionsTable()).getByRole('rowheader', { name: new RegExp(name) }).closest('tr');
const autoSelectSwitch = () => screen.getByRole('switch', { name: 'Choose versions automatically' });

/** A callable that first answers "sign in again", then whatever `data` is. */
const staleOnce = (data) => {
    let called = false;
    return vi.fn(async () => {
        if (!called) {
            called = true;
            const error = new Error('failed: REAUTH_REQUIRED');
            error.code = 'functions/failed-precondition';
            throw error;
        }
        return { data };
    });
};

beforeEach(() => {
    resetHarness();
    stubCallables({ getAiModelVersions: vi.fn().mockResolvedValue({ data: versionsFor(ROWS) }) });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('the table', () => {
    it('shows each service\'s versions for photos and for text, with what the last check found', async () => {
        await renderView();
        await waitFor(() => expect(within(versionsTable()).getByText('gemini-3.7-flash')).toBeTruthy());

        const gemini = within(rowFor('Google Gemini'));
        expect(gemini.getByText('Working')).toBeTruthy();
        expect(gemini.getByText('Failing')).toBeTruthy();
        expect(gemini.getByText(/— busy at the last check/)).toBeTruthy();
        expect(gemini.getByText(/— read the test licence wrong/)).toBeTruthy();
        expect(gemini.getByText('Daily check')).toBeTruthy();
        // A version that passed carries no note.
        expect(gemini.getByText('gemini-3.7-flash').textContent).toBe('gemini-3.7-flash');
    });

    it('says what the operator must do about the account, and why a service is not checked', async () => {
        await renderView();
        await waitFor(() => expect(rowFor('Groq')).toBeTruthy());

        expect(within(rowFor('Groq')).getByText('Key refused')).toBeTruthy();
        expect(within(rowFor('Groq')).getByText('Not confirmed')).toBeTruthy();
        expect(within(rowFor('Groq')).getByText('After a failure')).toBeTruthy();

        const mistral = within(rowFor('Mistral'));
        expect(mistral.getByText('Off')).toBeTruthy();
        // A stale verdict on a service the check skips would read as current.
        expect(mistral.queryByText('Working')).toBeNull();
        expect(mistral.getByText('Never')).toBeTruthy();

        const cerebras = within(rowFor('Cerebras'));
        expect(cerebras.getByText('Not set up')).toBeTruthy();
        expect(cerebras.getByText('Does not read photos.')).toBeTruthy();
    });

    it('offers a retry in the table when it could not load', async () => {
        let calls = 0;
        const load = vi.fn(async () => {
            calls += 1;
            if (calls === 1) throw Object.assign(new Error('internal'), { code: 'functions/internal' });
            return { data: versionsFor(ROWS) };
        });
        stubCallables({ getAiModelVersions: load });
        await renderView();

        const retry = await within(versionsTable()).findByRole('button', { name: 'Retry' });
        expect(within(versionsTable()).getByText('The model versions could not be loaded.')).toBeTruthy();
        fireEvent.click(retry);

        await waitFor(() => expect(within(versionsTable()).getByText('gemini-3.7-flash')).toBeTruthy());
        expect(load).toHaveBeenCalledTimes(2);
    });
});

describe('Check versions now', () => {
    it('runs the check and shows the table it returns', async () => {
        const after = ROWS.map((row) => (row.id === 'gemini'
            ? { ...row, reason: 'requested', lanes: [lane('vision', ['gemini-3.8-flash']), row.lanes[1]] }
            : row));
        stubCallables({
            getAiModelVersions: vi.fn().mockResolvedValue({ data: versionsFor(ROWS) }),
            checkAiModelVersionsNow: vi.fn().mockResolvedValue({ data: { ...versionsFor(after), skipped: null, checkedCount: 2 } }),
        });
        await renderView();
        await waitFor(() => expect(rowFor('Google Gemini')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'Check versions now' }));

        await waitFor(() => expect(within(rowFor('Google Gemini')).getByText('gemini-3.8-flash')).toBeTruthy());
        expect(callables.checkAiModelVersionsNow).toHaveBeenCalledTimes(1);
        expect(within(rowFor('Google Gemini')).getByText('Check now')).toBeTruthy();
        expect(showSuccess).toHaveBeenCalledWith('Checked 2 services. The table shows the versions in use now.');
    });

    it('says so when a scheduled check is already running', async () => {
        stubCallables({
            getAiModelVersions: vi.fn().mockResolvedValue({ data: versionsFor(ROWS) }),
            checkAiModelVersionsNow: vi.fn().mockResolvedValue({ data: { ...versionsFor(ROWS, { running: true }), skipped: 'running', checkedCount: 0 } }),
        });
        await renderView();
        await waitFor(() => expect(rowFor('Google Gemini')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'Check versions now' }));

        await waitFor(() => expect(showInfo).toHaveBeenCalledWith('A check is already running. Try again in a few minutes.'));
        expect(showSuccess).not.toHaveBeenCalled();
        expect(screen.getByText(/A check is running now\./)).toBeTruthy();
    });

    it('asks for the password on a stale session, then runs the check once', async () => {
        stubCallables({
            getAiModelVersions: vi.fn().mockResolvedValue({ data: versionsFor(ROWS) }),
            checkAiModelVersionsNow: staleOnce({ ...versionsFor(ROWS), skipped: null, checkedCount: 1 }),
        });
        reauthenticateWithCredential.mockResolvedValue({});
        await renderView();
        await waitFor(() => expect(rowFor('Google Gemini')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'Check versions now' }));
        fireEvent.change(await screen.findByLabelText(/password/i), { target: { value: 'correct-horse' } });
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /confirm|continue|verify/i }));

        await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('Checked 1 service. The table shows the versions in use now.'));
        expect(callables.checkAiModelVersionsNow).toHaveBeenCalledTimes(2);
    });

    it('reports nothing when the password prompt is dismissed', async () => {
        stubCallables({
            getAiModelVersions: vi.fn().mockResolvedValue({ data: versionsFor(ROWS) }),
            checkAiModelVersionsNow: staleOnce({ ...versionsFor(ROWS), skipped: null, checkedCount: 1 }),
        });
        await renderView();
        await waitFor(() => expect(rowFor('Google Gemini')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'Check versions now' }));
        await screen.findByLabelText(/password/i);
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        await waitFor(() => expect(screen.queryByLabelText(/password/i)).toBeNull());
        expect(showSuccess).not.toHaveBeenCalled();
        expect(callables.checkAiModelVersionsNow).toHaveBeenCalledTimes(1);
    });
});

describe('the auto-select switch', () => {
    it('shows the lists are kept, and what the check suggests, while it is off', async () => {
        const suggesting = ROWS.map((row) => (row.id === 'gemini'
            ? { ...row, lanes: [row.lanes[0], lane('text', ['gemini-3.5-flash-lite'], { suggested: ['gemini-3.8-flash'] })] }
            : row));
        stubCallables({ getAiModelVersions: vi.fn().mockResolvedValue({ data: versionsFor(suggesting, { autoSelect: false }) }) });
        await renderView();

        await waitFor(() => expect(autoSelectSwitch().getAttribute('aria-checked')).toBe('false'));
        // The ids sit in their own span, so they may break anywhere while the words do not.
        const suggestion = within(rowFor('Google Gemini')).getByText((_, element) => element?.tagName === 'P'
            && element.textContent === 'Suggested: gemini-3.8-flash');
        expect(suggestion).toBeTruthy();
        expect(screen.getByText(/^Off: every list stays exactly as it is\./)).toBeTruthy();
    });

    it('turns it off through the same re-authentication, and says what that means', async () => {
        stubCallables({
            getAiModelVersions: vi.fn().mockResolvedValue({ data: versionsFor(ROWS) }),
            setAiModelAutoSelect: staleOnce(versionsFor(ROWS, { autoSelect: false })),
        });
        reauthenticateWithCredential.mockResolvedValue({});
        await renderView();
        await waitFor(() => expect(autoSelectSwitch().getAttribute('aria-checked')).toBe('true'));

        fireEvent.click(autoSelectSwitch());
        fireEvent.change(await screen.findByLabelText(/password/i), { target: { value: 'correct-horse' } });
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /confirm|continue|verify/i }));

        await waitFor(() => expect(autoSelectSwitch().getAttribute('aria-checked')).toBe('false'));
        expect(callables.setAiModelAutoSelect).toHaveBeenLastCalledWith({ enabled: false });
        expect(showSuccess).toHaveBeenCalledWith('Auto-select is off. Every list stays as it is now.');
    });
});
