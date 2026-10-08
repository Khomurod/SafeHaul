/**
 * What the delete dialog says stays: a file uploaded before the server began
 * telling a submitted application's files apart (`filesKeptBefore`) is never
 * deleted, so it is never counted among the files that go. The page's flow is
 * `views/UnfinishedApplicationsPage.purge.test.jsx`.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { UnfinishedDeleteDialog } from './UnfinishedDeleteDialog';

const DANA = {
    applicantKey: 'aaaa1111bbbb2222cccc', origin: 'driver', status: 'in_progress', firstName: 'Dana', lastName: 'Alvarez',
    email: 'dana@example.test', phone: '2145550147', lastSemanticStep: 'license', lastStep: 2,
};
const DANA_AGAIN = { ...DANA, applicantKey: 'aaaa1111bbbb2222dddd', email: 'dana.alvarez@example.test', lastSemanticStep: 'employment' };

function show(preview, keep = new Set()) {
    render(<UnfinishedDeleteDialog deletion={{
        target: { entry: DANA, preview: { related: [], filesKeptBefore: '2026-10-12', ...preview } },
        keep,
        toggle: vi.fn(),
        deleting: false,
        error: null,
        confirm: vi.fn(),
        cancel: vi.fn(),
    }}
    />);
    return screen.getByRole('dialog', { name: 'Delete this unfinished application?' });
}

const older = (count) => ({ application: { ...DANA, fileCount: 1, olderFileCount: count } });

describe('the files that stay', () => {
    it('are not counted among those that go, and are said with the day they date from', () => {
        const dialog = show({
            ...older(2),
            related: [{ ...DANA_AGAIN, fileCount: 0, olderFileCount: 1, shares: ['identity'] }],
        });

        expect(within(dialog).getByText('Everything saved for Dana Alvarez will be deleted for good: its answers, 1 uploaded file and any link sent for it.'))
            .toBeInTheDocument();
        expect(within(dialog).getByText(/3 files uploaded before October 12, 2026 stay too, as an application submitted before then may use them\./))
            .toBeInTheDocument();
    });

    it('count only the applications that go', () => {
        const dialog = show({
            ...older(2),
            related: [{ ...DANA_AGAIN, fileCount: 0, olderFileCount: 1, shares: ['identity'] }],
        }, new Set([DANA_AGAIN.applicantKey]));

        expect(within(dialog).getByText(/2 files uploaded before October 12, 2026 stay too/)).toBeInTheDocument();
    });

    it('are one file, said as one', () => {
        const dialog = show(older(1));

        expect(within(dialog).getByText(/One file uploaded before October 12, 2026 stays too, as an application submitted before then may use it\./))
            .toBeInTheDocument();
    });

    it('go unsaid when there are none, or the server did not say from when', () => {
        const none = show(older(0));
        expect(within(none).queryByText(/uploaded before/)).toBeNull();
        expect(within(none).getByText(/A driver who still has this application open/)).toBeInTheDocument();
    });

    it('go unsaid by a server that does not date them', () => {
        const undated = show({ ...older(2), filesKeptBefore: null });
        expect(within(undated).queryByText(/uploaded before/)).toBeNull();
    });
});
