/**
 * Contract freeze + safety proof for the migrated `StatsBackfillPanel`.
 *
 * This panel rewrites `stats_daily`, for one company or for every company on the
 * platform, so the callable names, timeout and payloads are frozen first. The
 * headline fix is that "Run All Companies" previously ran with **no confirmation
 * of any kind**.
 *
 * All company IDs below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: (...a) => httpsCallable(...a) }));
vi.mock('@lib/firebase', () => ({ functions: { __functions: true } }));

import StatsBackfillPanel from './StatsBackfillPanel';

let callable;

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    callable = vi.fn().mockResolvedValue({ data: { dryRun: true, totalActivitiesProcessed: 5 } });
    httpsCallable.mockReturnValue(callable);
});

function enterCompanyId(value = 'artificial-company-id') {
    fireEvent.change(screen.getByLabelText(/Company ID/), { target: { value } });
}

describe('StatsBackfillPanel — frozen callable contracts', () => {
    it('calls backfillCompanyStats with the exact name, timeout and payload', async () => {
        render(<StatsBackfillPanel />);
        enterCompanyId();
        fireEvent.click(screen.getByRole('button', { name: /Dry-Run \(Preview\)/ }));

        await waitFor(() => expect(callable).toHaveBeenCalled());
        expect(httpsCallable).toHaveBeenCalledWith({ __functions: true }, 'backfillCompanyStats', { timeout: 540000 });
        expect(callable).toHaveBeenCalledWith({ companyId: 'artificial-company-id', dryRun: true });
    });

    it('trims the company id and passes dryRun false for the real run', async () => {
        render(<StatsBackfillPanel />);
        enterCompanyId('  padded-id  ');
        fireEvent.click(screen.getByRole('button', { name: /Run Actual Backfill/ }));

        await waitFor(() => expect(callable).toHaveBeenCalledWith({ companyId: 'padded-id', dryRun: false }));
    });

    it('calls backfillAllStats with the exact name, timeout and payload', async () => {
        render(<StatsBackfillPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Dry-Run All/ }));

        await waitFor(() => expect(callable).toHaveBeenCalled());
        expect(httpsCallable).toHaveBeenCalledWith({ __functions: true }, 'backfillAllStats', { timeout: 540000 });
        expect(callable).toHaveBeenCalledWith({ dryRun: true });
    });

    it('keeps the frozen missing-id guard', () => {
        render(<StatsBackfillPanel />);
        // Both single-company buttons are disabled with no id, so the guard is
        // reached by clearing an entered value.
        enterCompanyId('x');
        enterCompanyId('   ');
        expect(screen.getByRole('button', { name: /Dry-Run \(Preview\)/ })).toBeDisabled();
        expect(callable).not.toHaveBeenCalled();
    });
});

describe('StatsBackfillPanel — Run All Companies is confirmed (defect)', () => {
    it('does not call the callable until the confirmation is accepted', async () => {
        render(<StatsBackfillPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Run All Companies/ }));

        // Pre-migration this fired immediately, with no guard at all.
        expect(callable).not.toHaveBeenCalled();
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });

    it('runs with dryRun false once confirmed', async () => {
        render(<StatsBackfillPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Run All Companies/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Run for all companies' }));

        await waitFor(() => expect(callable).toHaveBeenCalledWith({ dryRun: false }));
    });

    it('does not run when the confirmation is cancelled', async () => {
        render(<StatsBackfillPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Run All Companies/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

        expect(callable).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('warns that the action is irreversible and platform-wide', async () => {
        render(<StatsBackfillPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Run All Companies/ }));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveAccessibleName('Run the backfill for every company?');
        expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    });

    it('leaves the non-mutating dry-run unguarded', async () => {
        render(<StatsBackfillPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Dry-Run All/ }));
        // A preview writes nothing, so gating it would only add friction.
        await waitFor(() => expect(callable).toHaveBeenCalledWith({ dryRun: true }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('StatsBackfillPanel — states are announced (defect)', () => {
    it('announces a failure', async () => {
        callable.mockRejectedValueOnce(new Error('backend exploded'));
        render(<StatsBackfillPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Dry-Run All/ }));

        expect(await screen.findByRole('alert')).toHaveTextContent('backend exploded');
    });

    it('falls back to the frozen generic error message', async () => {
        callable.mockRejectedValueOnce(new Error(''));
        render(<StatsBackfillPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Dry-Run All/ }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to run backfill');
    });

    it('announces the result and keeps the dry-run wording', async () => {
        callable.mockResolvedValueOnce({ data: { dryRun: true, totalActivitiesProcessed: 1234 } });
        render(<StatsBackfillPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Dry-Run All/ }));

        expect(await screen.findByText('Dry-Run Complete')).toBeInTheDocument();
        expect(screen.getByText('Preview generated successfully. No data was modified.')).toBeInTheDocument();
        expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    it('uses the written wording for a real run', async () => {
        callable.mockResolvedValueOnce({ data: { dryRun: false, daysWritten: 9 } });
        render(<StatsBackfillPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Run All Companies/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Run for all companies' }));

        expect(await screen.findByText('Backfill Complete')).toBeInTheDocument();
        expect(screen.getByText('Stats have been written to Firestore.')).toBeInTheDocument();
    });

    it('renders the preview table when the result includes one', async () => {
        callable.mockResolvedValueOnce({
            data: { dryRun: true, preview: [{ dateKey: '2026-07-01', totalDials: 10, connected: 4, userCount: 2 }] },
        });
        render(<StatsBackfillPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Dry-Run All/ }));

        const table = await screen.findByRole('table', { name: 'Backfill preview by day' });
        expect(within(table).getByText('2026-07-01')).toBeInTheDocument();
    });
});

describe('StatsBackfillPanel — preserved product copy', () => {
    it('keeps the customer-naming help text verbatim pending an owner decision', () => {
        render(<StatsBackfillPanel />);
        // Recorded as a product/legal item in the roadmap. Rewriting operator
        // copy that names a real customer is not a migration decision.
        expect(
            screen.getByText('⚠️ This will process all companies. Only run after verifying Ray Star LLC results.'),
        ).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<StatsBackfillPanel />);
        expect((await axe(container)).violations).toEqual([]);
    });
});
