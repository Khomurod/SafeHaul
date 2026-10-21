/**
 * Contract for Maintenance → Data cleanup. Check counts and runs at once; Run
 * opens only after a check found something, repeats its numbers in a
 * confirmation, and nothing runs unless that is accepted. After a run the item
 * is checked again, and a run cut off by the time limit says to press Run
 * again.
 *
 * Every number and record path below is artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.fn();
const cleanup = vi.fn();

vi.mock('firebase/functions', () => ({ httpsCallable: (...a) => httpsCallable(...a) }));
vi.mock('@lib/firebase', () => ({ functions: { __functions: true }, auth: { currentUser: null } }));

import { DataCleanupCard } from './DataCleanupCard';

const SSN_FOUND = { item: 'ssnCopies', mode: 'check', done: true, total: 7, counts: { pendingUpdates: 5, driverProfiles: 2 } };
const SSN_CLEAN = { item: 'ssnCopies', mode: 'check', done: true, total: 0, counts: { pendingUpdates: 0, driverProfiles: 0 } };

/** The row of one item, found by its heading. */
const row = (title) => screen.getByRole('heading', { name: title }).closest('section');
const ssnRow = () => row('Old SSN copies');
const button = (name) => within(ssnRow()).getByRole('button', { name });

beforeEach(() => {
    vi.resetAllMocks();
    httpsCallable.mockImplementation(() => cleanup);
});

describe('Data cleanup card', () => {
    it('lists every item, each with Check and a Run that waits for a check', async () => {
        const { container } = render(<DataCleanupCard />);
        expect(screen.getByRole('heading', { level: 3, name: 'Data cleanup' })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
            'Test accounts from the old Deep Diagnostic',
            'Old SSN copies',
            'Old PEV links',
            'Old lead fields',
            'Application search fields',
            'Old SMTP password copies',
        ]);
        expect(screen.getAllByRole('button', { name: 'Run' }).every((b) => b.disabled)).toBe(true);
        expect((await axe(container)).violations).toEqual([]);
    });

    it('checks at once, with the callable, timeout and payload, and shows the numbers', async () => {
        cleanup.mockImplementation(async () => ({ data: SSN_FOUND }));
        const { container } = render(<DataCleanupCard />);

        fireEvent.click(button('Check'));

        await waitFor(() => expect(within(ssnRow()).getByText('Staging records with an SSN').nextSibling).toHaveTextContent('5'));
        expect(httpsCallable).toHaveBeenCalledWith({ __functions: true }, 'dataCleanup', { timeout: 540000 });
        expect(cleanup).toHaveBeenCalledWith({ mode: 'check', item: 'ssnCopies' });
        expect(within(ssnRow()).getByText('Driver profiles with a plain-text SSN').nextSibling).toHaveTextContent('2');
        expect(button('Run')).not.toBeDisabled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('keeps Run closed when the check finds nothing', async () => {
        cleanup.mockImplementation(async () => ({ data: SSN_CLEAN }));
        render(<DataCleanupCard />);
        fireEvent.click(button('Check'));
        await waitFor(() => expect(within(ssnRow()).getByText('Check found nothing to change.')).toBeInTheDocument());
        expect(button('Run')).toBeDisabled();
    });

    it('offers Run when the check stopped at the time limit before finding anything', async () => {
        cleanup.mockImplementation(async () => ({ data: { ...SSN_CLEAN, done: false } }));
        render(<DataCleanupCard />);
        fireEvent.click(button('Check'));
        await waitFor(() => expect(within(ssnRow()).getByText('Check stopped at the time limit; these are the numbers so far.')).toBeInTheDocument());
        expect(button('Run')).not.toBeDisabled();
    });

    it('runs nothing unless the confirmation, which repeats the numbers, is accepted', async () => {
        cleanup.mockImplementation(async () => ({ data: SSN_FOUND }));
        render(<DataCleanupCard />);
        fireEvent.click(button('Check'));
        await waitFor(() => expect(button('Run')).not.toBeDisabled());

        fireEvent.click(button('Run'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('heading', { name: 'Run: Old SSN copies?' })).toBeInTheDocument();
        expect(within(dialog).getByText('Staging records with an SSN').nextSibling).toHaveTextContent('5');
        expect(within(dialog).getByText('Driver profiles with a plain-text SSN').nextSibling).toHaveTextContent('2');

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(cleanup).not.toHaveBeenCalledWith({ mode: 'run', item: 'ssnCopies' });
    });

    it('runs on confirmation, then checks again and shows what is left', async () => {
        const answers = [SSN_FOUND, { ...SSN_FOUND, mode: 'run' }, SSN_CLEAN];
        cleanup.mockImplementation(async () => ({ data: answers.shift() }));
        render(<DataCleanupCard />);
        fireEvent.click(button('Check'));
        await waitFor(() => expect(button('Run')).not.toBeDisabled());

        fireEvent.click(button('Run'));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Run cleanup' }));

        await waitFor(() => expect(within(ssnRow()).getByText('Run finished: 7 changed.')).toBeInTheDocument());
        await waitFor(() => expect(within(ssnRow()).getByText('Check found nothing to change.')).toBeInTheDocument());
        expect(cleanup.mock.calls.map(([payload]) => payload.mode)).toEqual(['check', 'run', 'check']);
        expect(button('Run')).toBeDisabled();
    });

    it('says to press Run again when the run stopped at the time limit', async () => {
        const answers = [SSN_FOUND, { ...SSN_FOUND, mode: 'run', done: false, total: 3 }, { ...SSN_FOUND, total: 4 }];
        cleanup.mockImplementation(async () => ({ data: answers.shift() }));
        render(<DataCleanupCard />);
        fireEvent.click(button('Check'));
        await waitFor(() => expect(button('Run')).not.toBeDisabled());
        fireEvent.click(button('Run'));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Run cleanup' }));

        await waitFor(() => expect(within(ssnRow())
            .getByText('Not finished: 3 changed before the time limit. Press Run again to go on.')).toBeInTheDocument());
        await waitFor(() => expect(button('Run')).not.toBeDisabled());
    });

    it('shows a failure in the item, in the operator’s words', async () => {
        cleanup.mockImplementation(async () => {
            throw Object.assign(new Error('internal'), { code: 'functions/internal' });
        });
        render(<DataCleanupCard />);
        fireEvent.click(button('Check'));
        await waitFor(() => expect(within(ssnRow())
            .getByText('The cleanup could not be completed. Press Check to see what is left.')).toBeInTheDocument());
        expect(button('Run')).toBeDisabled();
    });

    it('names the records with several driver types', async () => {
        cleanup.mockImplementation(async () => ({
            data: {
                item: 'leadFields', mode: 'check', done: true, total: 0,
                counts: { assignedTo: 0, normalizedPhone: 0, driverType: 0, driverTypeSeveral: 1 },
                notes: { driverTypeSeveral: ['companies/c1/leads/lead-1'] },
            },
        }));
        render(<DataCleanupCard />);
        fireEvent.click(within(row('Old lead fields')).getByRole('button', { name: 'Check' }));
        await waitFor(() => expect(within(row('Old lead fields')).getByText('companies/c1/leads/lead-1')).toBeInTheDocument());
    });
});
