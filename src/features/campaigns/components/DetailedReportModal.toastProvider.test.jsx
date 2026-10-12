// DetailedReportModal under the real ToastProvider. Its read effect lists
// `showError`, so while that helper changed with every notification, a failed
// read that reported itself read the 200 logs again, without end, and any
// notification elsewhere on the page read them again. The other suite stands in
// a stable double for the provider, so it could not see either. All data is
// artificial.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
    collection: vi.fn((_db, ...segments) => ({ __collection: segments.join('/') })),
    query: vi.fn((ref, ...constraints) => ({ ref, constraints })),
    orderBy: vi.fn((field, direction) => ({ __orderBy: [field, direction] })),
    limit: vi.fn((n) => ({ __limit: n })),
    getDocs: vi.fn(),
}));

vi.mock('firebase/firestore', () => fs);
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));

import { ToastProvider, useToast } from '@shared/components/feedback';
import DetailedReportModal from './DetailedReportModal';

function UnrelatedNotice() {
    const { showInfo } = useToast();
    return <button type="button" onClick={() => showInfo('Something else happened')}>raise another notice</button>;
}

function renderInProvider() {
    return render(
        <ToastProvider>
            <UnrelatedNotice />
            <DetailedReportModal companyId="company-1" sessionId="session-1" isOpen onClose={vi.fn()} />
        </ToastProvider>,
    );
}

/** Lets a read that would repeat itself repeat a few times before the count is taken. */
const settle = () => act(() => new Promise((resolve) => { setTimeout(resolve, 50); }));

beforeEach(() => {
    vi.resetAllMocks();
});

describe('DetailedReportModal with the real toast provider', () => {
    it('reads the logs once when the read fails, and says so once', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        // Five failures, then a read that works: a loop shows as a count instead
        // of hanging the run.
        for (let i = 0; i < 5; i += 1) fs.getDocs.mockRejectedValueOnce(new Error('permission-denied'));
        fs.getDocs.mockResolvedValue({ docs: [] });
        renderInProvider();

        await screen.findAllByText('Failed to load delivery details. Check permissions.');
        await settle();

        expect(fs.getDocs).toHaveBeenCalledTimes(1);
        expect(screen.getAllByText('Failed to load delivery details. Check permissions.')).toHaveLength(1);
    });

    it('does not read the logs again when another notification comes and goes', async () => {
        fs.getDocs.mockResolvedValue({ docs: [] });
        renderInProvider();
        await settle();
        expect(fs.getDocs).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'raise another notice' }));
        await screen.findByText('Something else happened');
        await settle();

        expect(fs.getDocs).toHaveBeenCalledTimes(1);
    });
});
