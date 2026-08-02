import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineLeaderboard } from './InlineLeaderboard';

const firestoreMocks = vi.hoisted(() => ({
    getDocs: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    collection: vi.fn(() => 'stats-reference'),
    query: vi.fn(() => 'stats-query'),
    where: vi.fn(),
    orderBy: vi.fn(),
    getDocs: firestoreMocks.getDocs,
}));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));

function snapshotWith(records = []) {
    return {
        forEach(callback) {
            records.forEach((record) => callback({ data: () => record }));
        },
    };
}

describe('InlineLeaderboard', () => {
    beforeEach(() => {
        firestoreMocks.getDocs.mockReset();
    });

    it('uses the DataTable column contract for representative performance data', async () => {
        firestoreMocks.getDocs.mockResolvedValue(snapshotWith([
            {
                byUser: {
                    recruiter1: {
                        name: 'Jordan Recruiter',
                        dials: 18,
                        connected: 7,
                        callback: 3,
                        voicemail: 5,
                    },
                },
            },
        ]));

        const { container } = render(<InlineLeaderboard companyId="company-1" />);

        expect(await screen.findByRole('rowheader', { name: /Jordan Recruiter/i }))
            .toBeInTheDocument();
        const dialsHeader = screen.getByRole('columnheader', { name: 'Dials' });
        const dialsCell = screen.getByRole('cell', { name: '18' });
        expect(dialsHeader).toHaveAttribute('data-align', 'end');
        expect(dialsCell).toHaveAttribute('data-align', 'end');
        expect(screen.getByLabelText('Leaderboard start date'))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refresh leaderboard' }))
            .toBeEnabled();

        const results = await axe(container, {
            rules: { 'color-contrast': { enabled: false } },
        });
        expect(results.violations).toEqual([]);
    });

    it('shows the standardized empty state', async () => {
        firestoreMocks.getDocs.mockResolvedValue(snapshotWith());
        render(<InlineLeaderboard companyId="company-1" />);

        expect(await screen.findByText('No activity yet')).toBeInTheDocument();
        expect(screen.getByText('Make some calls to see team performance.')).toBeInTheDocument();
    });

    it('shows a retryable standardized error without changing the query workflow', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        firestoreMocks.getDocs
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(snapshotWith());

        render(<InlineLeaderboard companyId="company-1" />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to load performance data.',
        );
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(firestoreMocks.getDocs).toHaveBeenCalledTimes(2));
        consoleError.mockRestore();
    });
});
