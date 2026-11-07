/**
 * The dossier's key facts (У4.7) and Do not text (У4.5): the phone and email as
 * text, the day the record came in, the last call, and the number put on the
 * company's SMS opt-out list from beside the phone.
 *
 * The dossier asks whether its one number is on the list (`checkSmsOptOut`) and
 * adds it with the callable Settings uses (`addSmsOptOut`); it never loads the
 * list (`listSmsOptOuts`). They are mocked here at `httpsCallable`; nothing
 * talks to a server or an SMS provider. All numbers and names are artificial.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
    checkSmsOptOut: vi.fn(),
    listSmsOptOuts: vi.fn(),
    addSmsOptOut: vi.fn(),
    removeSmsOptOut: vi.fn(),
}));
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn() }));

vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_functions, name) => calls[name] }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toast }));

import { DossierKeyFacts } from './DossierKeyFacts';
import { lastCallOf, recordDayOf } from './dossierFacts';
import { optOutKeyOf } from './useDoNotText';

const COMPANY = 'artificial-company-1';
const at = (iso) => ({ toDate: () => new Date(iso), toMillis: () => new Date(iso).getTime() });
/** The day as the viewer's own clock shows it, so the tests hold in any time zone. */
const dayOf = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
/** The server's answer for one number. */
const checked = (listed) => ({ data: { listed } });
const refusal = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });

const lead = (overrides = {}) => ({
    firstName: 'Dana',
    lastName: 'Driver',
    phone: '(555) 010-2030',
    email: 'dana@example.test',
    createdAt: at('2026-10-02T12:00:00Z'),
    ...overrides,
});

beforeEach(() => {
    vi.resetAllMocks();
    calls.checkSmsOptOut.mockImplementation(async () => checked(false));
    calls.addSmsOptOut.mockImplementation(async ({ phone }) => ({
        data: { added: true, entry: { phone: '+15550102030', reason: 'Asked not to be texted', source: 'team', input: phone } },
    }));
});

afterEach(() => vi.resetAllMocks());

function renderFacts(props = {}) {
    return render(
        <DossierKeyFacts appData={lead()} collectionName="leads" companyId={COMPANY} canEdit {...props} />,
    );
}

/** The value beside a fact's label. */
const factValue = (label) => screen.getByText(label, { selector: 'dt' }).nextElementSibling;

describe('what matters, as text', () => {
    it('shows the phone and email, the day a lead was added and that no call was logged', async () => {
        renderFacts();
        await screen.findByRole('button', { name: 'Do not text (555) 010-2030' });

        expect(factValue('Phone')).toHaveTextContent('(555) 010-2030');
        expect(factValue('Email')).toHaveTextContent('dana@example.test');
        expect(factValue('Added')).toHaveTextContent(dayOf('2026-10-02T12:00:00Z'));
        expect(factValue('Last call')).toHaveTextContent('None logged');
    });

    it("names an application's day Applied, as the list does, and falls back to the submission", () => {
        expect(recordDayOf({ createdAt: at('2026-07-11T12:00:00Z') }, 'applications'))
            .toEqual({ label: 'Applied', day: dayOf('2026-07-11T12:00:00Z') });
        expect(recordDayOf({ submittedAt: '2026-07-10T12:00:00.000Z' }, 'applications'))
            .toEqual({ label: 'Applied', day: dayOf('2026-07-10T12:00:00.000Z') });
        expect(recordDayOf({ createdAt: at('2026-10-02T12:00:00Z') }, 'leads'))
            .toEqual({ label: 'Added', day: dayOf('2026-10-02T12:00:00Z') });
        expect(recordDayOf({}, 'applications')).toBeNull();
        expect(recordDayOf({ createdAt: 'not a date' }, 'leads')).toBeNull();
    });

    it('shows the last call as the call log wrote it, with its time', () => {
        renderFacts({
            appData: lead({ lastCallOutcome: 'Connected / Interested', lastContactedAt: at('2026-10-22T12:00:00Z') }),
            companyId: undefined,
        });
        expect(factValue('Last call')).toHaveTextContent(`Connected / Interested · ${dayOf('2026-10-22T12:00:00Z')}`);
    });

    it('drops the time a campaign message wrote over the call, and keeps the result', () => {
        const contacted = at('2026-10-25T12:00:00Z');
        expect(lastCallOf({ lastCallOutcome: 'No Answer', lastContactedAt: contacted, lastBulkMessageAt: contacted }))
            .toEqual({ outcome: 'No Answer', at: '' });
        expect(lastCallOf({
            lastCallOutcome: 'No Answer',
            lastContactedAt: at('2026-10-25T12:00:00Z'),
            lastBulkMessageAt: at('2026-10-20T12:00:00Z'),
        }).at).toContain(dayOf('2026-10-25T12:00:00Z'));
        expect(lastCallOf({ lastCallOutcome: '  ' })).toBeNull();
        expect(lastCallOf(null)).toBeNull();
    });

    it('leaves out a phone or email the record does not have', () => {
        renderFacts({ appData: lead({ phone: '', email: undefined }) });
        expect(screen.queryByText('Phone', { selector: 'dt' })).toBeNull();
        expect(screen.queryByText('Email', { selector: 'dt' })).toBeNull();
        expect(calls.checkSmsOptOut).not.toHaveBeenCalled();
    });
});

describe('Do not text', () => {
    it('asks about its one number, never for the list, and reads Texts off with no action', async () => {
        calls.checkSmsOptOut.mockImplementation(async () => checked(true));
        renderFacts();

        expect(await screen.findByText('Texts off')).toBeInTheDocument();
        expect(calls.checkSmsOptOut).toHaveBeenCalledWith({ companyId: COMPANY, phone: '(555) 010-2030' });
        expect(calls.listSmsOptOuts).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: /Do not text/ })).toBeNull();
        expect(optOutKeyOf('+1 (555) 010-2030')).toBe(optOutKeyOf('5550102030'));
        expect(optOutKeyOf('555-0102')).toBe('');
    });

    it('offers nothing until the server has answered for the number', async () => {
        let answer;
        calls.checkSmsOptOut.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
        renderFacts();

        expect(screen.queryByRole('button', { name: /Do not text/ })).toBeNull();
        expect(screen.queryByText('Texts off')).toBeNull();
        await act(async () => answer(checked(false)));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Do not text (555) 010-2030' })).toBeInTheDocument());
        expect(screen.queryByText('Texts off')).toBeNull();
    });

    it.each([
        ['number', { appData: lead({ phone: '(555) 010-4050' }) }, { companyId: COMPANY, phone: '(555) 010-4050' }],
        ['company', { companyId: 'artificial-company-2' }, { companyId: 'artificial-company-2', phone: '(555) 010-2030' }],
    ])('drops an answer that arrives after the %s changed', async (_what, change, askedNext) => {
        const answers = [];
        calls.checkSmsOptOut.mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
        const { rerender } = renderFacts();
        rerender(<DossierKeyFacts appData={lead()} collectionName="leads" companyId={COMPANY} canEdit {...change} />);
        await waitFor(() => expect(calls.checkSmsOptOut).toHaveBeenLastCalledWith(askedNext));
        const shown = `Do not text ${askedNext.phone}`;

        await act(async () => answers[1](checked(false)));
        await waitFor(() => expect(screen.getByRole('button', { name: shown })).toBeInTheDocument());
        // The first question's answer, for what the dossier no longer shows, changes nothing.
        await act(async () => answers[0](checked(true)));
        expect(screen.getByRole('button', { name: shown })).toBeInTheDocument();
        expect(screen.queryByText('Texts off')).toBeNull();
        expect(answers).toHaveLength(2);
    });

    it('asks first, and adds nothing when the question is cancelled', async () => {
        renderFacts();
        fireEvent.click(await screen.findByRole('button', { name: 'Do not text (555) 010-2030' }));

        const dialog = screen.getByRole('dialog', { name: 'Stop texting (555) 010-2030?' });
        expect(dialog).toHaveTextContent('Only a Company Admin can take it off the list, in Settings → Text messages.');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(calls.addSmsOptOut).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Do not text (555) 010-2030' })).toBeInTheDocument();
    });

    it('puts the number on the list once confirmed, then reads Texts off with focus on it', async () => {
        renderFacts();
        fireEvent.click(await screen.findByRole('button', { name: 'Do not text (555) 010-2030' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Do not text' }));

        // The button the question came from is gone, so focus goes to what replaced it.
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(screen.getByText('Texts off').parentElement).toHaveFocus();
        });
        expect(calls.addSmsOptOut).toHaveBeenCalledWith({ companyId: COMPANY, phone: '(555) 010-2030', reason: undefined });
        expect(toast.showSuccess).toHaveBeenCalledWith('(555) 010-2030 is on the list. SafeHaul will not text it.');
        expect(screen.queryByRole('button', { name: /Do not text/ })).toBeNull();
    });

    it('keeps the question open until the add has answered', async () => {
        let answer;
        calls.addSmsOptOut.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
        renderFacts();
        fireEvent.click(await screen.findByRole('button', { name: 'Do not text (555) 010-2030' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Do not text' }));

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        await act(async () => answer({ data: { added: true, entry: { phone: '+15550102030' } } }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.getByText('Texts off')).toBeInTheDocument();
    });

    it('says so when the number turns out to be listed already', async () => {
        calls.addSmsOptOut.mockImplementation(async () => ({ data: { added: false, entry: { phone: '+15550102030' } } }));
        renderFacts();
        fireEvent.click(await screen.findByRole('button', { name: 'Do not text (555) 010-2030' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Do not text' }));

        await waitFor(() => expect(screen.getByText('Texts off')).toBeInTheDocument());
        expect(toast.showSuccess).toHaveBeenCalledWith('(555) 010-2030 was already on the list.');
    });

    it('keeps the question open with a plain reason when the number cannot be added', async () => {
        calls.addSmsOptOut.mockImplementation(async () => { throw refusal('unavailable', 'fetch failed'); });
        renderFacts();
        fireEvent.click(await screen.findByRole('button', { name: 'Do not text (555) 010-2030' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Do not text' }));

        expect(await screen.findByText('We could not reach SafeHaul. Check your connection and try again.')).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Stop texting (555) 010-2030?' })).toBeInTheDocument();
        expect(screen.queryByText('Texts off')).toBeNull();
        expect(toast.showSuccess).not.toHaveBeenCalled();
    });

    it('still offers the action when the number cannot be checked: adding says whether it was there', async () => {
        calls.checkSmsOptOut.mockImplementation(async () => { throw refusal('internal', 'boom'); });
        calls.addSmsOptOut.mockImplementation(async () => ({ data: { added: false, entry: { phone: '+15550102030' } } }));
        renderFacts();
        fireEvent.click(await screen.findByRole('button', { name: 'Do not text (555) 010-2030' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Do not text' }));

        await waitFor(() => expect(screen.getByText('Texts off')).toBeInTheDocument());
        expect(toast.showSuccess).toHaveBeenCalledWith('(555) 010-2030 was already on the list.');
    });

    it('shows Texts off to someone who cannot edit', async () => {
        calls.checkSmsOptOut.mockImplementation(async () => checked(true));
        renderFacts({ canEdit: false });
        expect(await screen.findByText('Texts off')).toBeInTheDocument();
    });

    it('offers someone who cannot edit no action for a number not on the list', async () => {
        let answer;
        calls.checkSmsOptOut.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
        renderFacts({ canEdit: false });
        // Once the server has answered, so the absence below is not just "still checking".
        await act(async () => answer(checked(false)));
        expect(factValue('Phone')).toHaveTextContent(/^\(555\) 010-2030$/);
        expect(screen.queryByRole('button', { name: /Do not text/ })).toBeNull();
    });

    it('asks the server nothing without a company or a usable number', () => {
        renderFacts({ companyId: undefined });
        renderFacts({ appData: lead({ phone: '555-0102' }) });
        expect(calls.checkSmsOptOut).not.toHaveBeenCalled();
        expect(calls.listSmsOptOuts).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: /Do not text/ })).toBeNull();
    });
});
