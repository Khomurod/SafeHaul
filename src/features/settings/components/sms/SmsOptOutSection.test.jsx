/**
 * Settings → Text messages → Opted-out numbers: what the team sees, what each
 * action asks the server, and that only a Company Admin is offered Remove, and
 * only behind a question. All numbers and names here are artificial.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
    listSmsOptOuts: vi.fn(),
    addSmsOptOut: vi.fn(),
    removeSmsOptOut: vi.fn(),
}));
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn() }));

vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_functions, name) => calls[name] }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toast }));

import { SmsOptOutSection } from './SmsOptOutSection';

const COMPANY = 'artificial-company-1';
const entry = (overrides = {}) => ({
    phone: '+15551234567', reason: 'Replied STOP', source: 'team', addedBy: 'uid-1',
    addedByName: 'Rita Recruiter', addedAt: '2026-10-05T15:00:00.000Z', ...overrides,
});
const listed = (entries, extra = {}) => ({ data: { entries, total: entries.length, limit: 300, hasMore: false, ...extra } });
const refusal = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });

beforeEach(() => {
    vi.resetAllMocks();
    calls.listSmsOptOuts.mockImplementation(async () => listed([
        entry(),
        entry({
            phone: '+15550000002', reason: 'STOP keyword', source: 'reply', addedBy: null, addedByName: null,
            addedAt: '2026-10-01T12:00:00.000Z',
        }),
    ]));
    calls.addSmsOptOut.mockImplementation(async ({ phone, reason }) => ({
        data: { added: true, entry: entry({ phone, reason }) },
    }));
    calls.removeSmsOptOut.mockImplementation(async ({ phone }) => ({ data: { phone, removed: true } }));
});

afterEach(() => vi.resetAllMocks());

async function renderSection(props = {}) {
    const utils = render(<SmsOptOutSection companyId={COMPANY} canRemove {...props} />);
    // The row's own header exists only once the list has loaded.
    await screen.findByRole('rowheader', { name: '(555) 123-4567' });
    return utils;
}

describe('the list', () => {
    it('shows each number with why, how and when it was added, and says what the list does', async () => {
        await renderSection();
        expect(calls.listSmsOptOuts).toHaveBeenCalledWith({ companyId: COMPANY });
        expect(screen.getByRole('heading', { level: 2, name: 'Opted-out numbers' })).toBeInTheDocument();
        expect(screen.getByText(/skips these numbers in Contact Attempt texts, campaigns/)).toBeInTheDocument();
        expect(screen.getByText(/A text sent by hand.* is the sender’s responsibility/)).toBeInTheDocument();

        const table = screen.getByRole('table', { name: 'Opted-out numbers' });
        const team = within(table).getByRole('rowheader', { name: '(555) 123-4567' }).closest('tr');
        expect(within(team).getByText('Replied STOP')).toBeInTheDocument();
        expect(within(team).getByText('By Rita Recruiter')).toBeInTheDocument();
        const reply = within(table).getByRole('rowheader', { name: '(555) 000-0002' }).closest('tr');
        expect(within(reply).getByText('From a STOP reply')).toBeInTheDocument();
    });

    it('says when there are more numbers than it shows', async () => {
        calls.listSmsOptOuts.mockImplementation(async () => listed([entry()], { total: 412, hasMore: true }));
        await renderSection();
        expect(screen.getByText('Showing the newest 1 of 412 numbers.')).toBeInTheDocument();
    });

    it('says when the list is empty', async () => {
        calls.listSmsOptOuts.mockImplementation(async () => listed([]));
        render(<SmsOptOutSection companyId={COMPANY} canRemove />);
        expect(await screen.findByText('No opted-out numbers')).toBeInTheDocument();
    });

    it('tells someone refused the list to ask a Company Admin, not that only an admin may see it', async () => {
        calls.listSmsOptOuts.mockImplementation(async () => { throw refusal('permission-denied', 'denied'); });
        render(<SmsOptOutSection companyId={COMPANY} canRemove />);
        expect(await screen.findByText('You do not have access to this company’s settings. Ask a Company Admin.')).toBeInTheDocument();
    });

    it('says when the list could not load, and tries again', async () => {
        calls.listSmsOptOuts.mockImplementation(async () => { throw refusal('unavailable', 'unavailable'); });
        render(<SmsOptOutSection companyId={COMPANY} canRemove />);
        expect(await screen.findByText(/could not reach SafeHaul/)).toBeInTheDocument();

        calls.listSmsOptOuts.mockImplementation(async () => listed([entry()]));
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('rowheader', { name: '(555) 123-4567' })).toBeInTheDocument();
    });
});

describe('adding a number', () => {
    // Side by side on a wide screen, stacked on a phone. Both are design-system
    // fields, whose rows pack at the top (FormControls.test.jsx), so the phone
    // hint wrapping to a second line no longer pushes Reason's input down.
    it('lays out Phone number and Reason as two design-system fields in one row', async () => {
        await renderSection();
        const phone = screen.getByLabelText(/Phone number/).closest('.ds-form-field');
        const reason = screen.getByLabelText(/Reason/).closest('.ds-form-field');
        expect(phone).not.toBeNull();
        expect(reason).not.toBeNull();
        expect(phone.parentElement).toBe(reason.parentElement);
        expect(phone.parentElement).toHaveClass('grid', 'sm:grid-cols-2');
    });

    it('sends the number and the reason, then clears the form and shows the reloaded list', async () => {
        await renderSection();
        calls.listSmsOptOuts.mockImplementation(async () => listed([
            entry({ phone: '+15559876543', reason: 'Asked on a call' }), entry(),
        ]));
        expect(screen.getByText('Add a number when the driver replied STOP or asked not to be texted.')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '(555) 987-6543' } });
        fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Asked on a call' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add number' }));

        expect(await screen.findByRole('rowheader', { name: '(555) 987-6543' })).toBeInTheDocument();
        expect(calls.addSmsOptOut).toHaveBeenCalledWith({ companyId: COMPANY, phone: '(555) 987-6543', reason: 'Asked on a call' });
        expect(calls.listSmsOptOuts).toHaveBeenCalledTimes(2);
        expect(screen.getByLabelText(/Phone number/)).toHaveValue('');
        expect(screen.getByLabelText(/Reason/)).toHaveValue('');
        expect(toast.showSuccess).toHaveBeenCalledWith('(555) 987-6543 is on the list. SafeHaul will not text it.');
    });

    it('keeps a number added while the list was still loading: the older answer does not replace the newer', async () => {
        let firstAnswer;
        calls.listSmsOptOuts.mockImplementationOnce(() => new Promise((resolve) => { firstAnswer = resolve; }));
        calls.listSmsOptOuts.mockImplementation(async () => listed([entry({ phone: '+15559876543' })]));
        render(<SmsOptOutSection companyId={COMPANY} canRemove />);
        fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '(555) 987-6543' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
        expect(await screen.findByRole('rowheader', { name: '(555) 987-6543' })).toBeInTheDocument();

        await act(async () => { firstAnswer(listed([entry()])); });

        expect(screen.getByRole('rowheader', { name: '(555) 987-6543' })).toBeInTheDocument();
        expect(screen.queryByRole('rowheader', { name: '(555) 123-4567' })).not.toBeInTheDocument();
    });

    it('keeps what was typed while an add was on its way', async () => {
        let finish;
        calls.addSmsOptOut.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        await renderSection();
        fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '555-987-6543' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
        fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '555-222-3333' } });

        await act(async () => { finish({ data: { added: true, entry: entry({ phone: '+15559876543' }) } }); });

        expect(screen.getByLabelText(/Phone number/)).toHaveValue('555-222-3333');
    });

    it('asks before the page is left with a number typed and not added', async () => {
        const leaving = () => {
            const event = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        };
        await renderSection();
        expect(leaving()).toBe(false);
        fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '555-987' } });
        expect(leaving()).toBe(true);
    });

    it('says so when the number is already listed', async () => {
        calls.addSmsOptOut.mockImplementation(async () => ({ data: { added: false, entry: entry() } }));
        await renderSection();
        fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '555-123-4567' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
        await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('(555) 123-4567 was already on the list.'));
    });

    it('sends one request for two quick presses', async () => {
        let finish;
        calls.addSmsOptOut.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        await renderSection();
        fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '555-987-6543' } });
        const form = screen.getByRole('button', { name: 'Add number' }).closest('form');
        fireEvent.submit(form);
        fireEvent.submit(form);
        expect(calls.addSmsOptOut).toHaveBeenCalledTimes(1);

        finish({ data: { added: true, entry: entry({ phone: '+15559876543' }) } });
        await waitFor(() => expect(screen.getByLabelText(/Phone number/)).toHaveValue(''));
    });

    it('asks for a whole number before it asks the server', async () => {
        await renderSection();
        fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '555-1234' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
        expect(await screen.findByText(/with its area code/)).toBeInTheDocument();
        expect(calls.addSmsOptOut).not.toHaveBeenCalled();
    });

    it('shows the server’s own refusal and keeps what was typed', async () => {
        calls.addSmsOptOut.mockImplementation(async () => {
            throw refusal('invalid-argument', 'Enter the phone number with its area code, such as (555) 123-4567.');
        });
        await renderSection();
        fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '+99 1234 5678 9012 3456' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
        expect(await screen.findByText(/with its area code, such as/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Phone number/)).toHaveValue('+99 1234 5678 9012 3456');
    });
});

describe('removing a number', () => {
    it('is not offered to a team member who is not a Company Admin', async () => {
        await renderSection({ canRemove: false });
        expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
        // Adding stays open to everyone.
        expect(screen.getByRole('button', { name: 'Add number' })).toBeEnabled();
    });

    it('asks first, and removes nothing when the question is cancelled', async () => {
        await renderSection();
        fireEvent.click(screen.getByRole('button', { name: 'Remove (555) 123-4567' }));
        const confirm = screen.getByRole('dialog', { name: 'Remove (555) 123-4567 from the list?' });
        expect(within(confirm).getByText(/only when the driver asked to receive texts again/)).toBeInTheDocument();
        expect(calls.removeSmsOptOut).not.toHaveBeenCalled();

        fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(calls.removeSmsOptOut).not.toHaveBeenCalled();
    });

    it('removes the number once confirmed, and shows the reloaded list', async () => {
        await renderSection();
        calls.listSmsOptOuts.mockImplementation(async () => listed([
            entry({ phone: '+15550000002', reason: 'STOP keyword', source: 'reply' }),
        ]));
        fireEvent.click(screen.getByRole('button', { name: 'Remove (555) 123-4567' }));
        const confirm = screen.getByRole('dialog', { name: 'Remove (555) 123-4567 from the list?' });
        fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(screen.queryByRole('rowheader', { name: '(555) 123-4567' })).not.toBeInTheDocument());
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('rowheader', { name: '(555) 000-0002' })).toBeInTheDocument();
        expect(calls.removeSmsOptOut).toHaveBeenCalledWith({ companyId: COMPANY, phone: '+15551234567' });
        expect(calls.listSmsOptOuts).toHaveBeenCalledTimes(2);
        expect(toast.showSuccess).toHaveBeenCalledWith('(555) 123-4567 is off the list.');
    });

    it('keeps the question open with the reason when it fails', async () => {
        calls.removeSmsOptOut.mockImplementation(async () => { throw refusal('permission-denied', 'Company admin access required.'); });
        await renderSection();
        fireEvent.click(screen.getByRole('button', { name: 'Remove (555) 123-4567' }));
        const confirm = screen.getByRole('dialog', { name: 'Remove (555) 123-4567 from the list?' });
        fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
        expect(await within(confirm).findByText('Only a Company Admin can remove a number. Ask one of them.')).toBeInTheDocument();
    });
});

describe('accessibility', () => {
    it('has no detectable violations on the section or in the question', async () => {
        const { container } = await renderSection();
        expect((await axe(container)).violations).toEqual([]);
        fireEvent.click(screen.getByRole('button', { name: 'Remove (555) 123-4567' }));
        expect((await axe(screen.getByRole('dialog'))).violations).toEqual([]);
    });
});
