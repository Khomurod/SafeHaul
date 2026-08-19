/**
 * Contract proof for the "Started (unfinished)" screen.
 *
 * The properties worth pinning are mostly about restraint. Answers are now saved
 * from the applicant's first Next, which means a carrier can see records nobody
 * has signed, consented to or submitted — so what this screen may show is a
 * narrower question than what it *could* show.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const callableSpy = vi.fn();
const httpsCallableSpy = vi.fn();

vi.mock('firebase/functions', () => ({
    httpsCallable: (...args) => {
        httpsCallableSpy(...args);
        return callableSpy;
    },
}));
vi.mock('@lib/firebase', () => ({ functions: {}, db: {}, storage: {} }));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'company-1', companyName: 'Acme Freight' } }),
}));

import { UnfinishedApplicationsPage } from './UnfinishedApplicationsPage';

const DRAFTS = [
    {
        applicantKey: 'key-1',
        firstName: 'Dana',
        lastName: 'Alvarez',
        email: 'dana@example.test',
        phone: '2145550147',
        lastSemanticStep: 'license',
        lastStep: 2,
        startedAt: '2026-08-14T09:00:00Z',
        updatedAt: '2026-08-14T09:20:00Z',
    },
    {
        applicantKey: 'key-2',
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        lastSemanticStep: null,
        lastStep: 0,
        startedAt: '2026-08-15T09:00:00Z',
        updatedAt: '2026-08-15T09:00:00Z',
    },
];

beforeEach(() => {
    vi.clearAllMocks();
    callableSpy.mockResolvedValue({ data: { drafts: DRAFTS, retentionDays: 30 } });
});

describe('listing', () => {
    it('asks the server for this company only', async () => {
        render(<UnfinishedApplicationsPage />);

        await waitFor(() => expect(callableSpy).toHaveBeenCalledWith({ companyId: 'company-1' }));
        expect(httpsCallableSpy).toHaveBeenCalledWith(expect.anything(), 'listApplicationDrafts');
    });

    it('shows who to contact and how far they got', async () => {
        render(<UnfinishedApplicationsPage />);

        await waitFor(() => expect(screen.getByText('Dana Alvarez')).toBeTruthy());
        expect(screen.getByText('dana@example.test')).toBeTruthy();
        // The wizard's own step name, not an index the recruiter has to decode.
        expect(screen.getByText('License & credentials')).toBeTruthy();
    });

    it('handles an applicant who has not typed a name yet', async () => {
        render(<UnfinishedApplicationsPage />);

        await waitFor(() => expect(screen.getByText('Name not entered yet')).toBeTruthy());
        expect(screen.getByText('No contact details yet')).toBeTruthy();
    });

    it('says plainly that these are not submitted applications', async () => {
        render(<UnfinishedApplicationsPage />);

        // The distinction is the point: nothing here has been signed or consented
        // to, and a recruiter treating one as a candidate record would be wrong.
        await waitFor(() => expect(screen.getByText(/nothing has been signed/i)).toBeTruthy());
        expect(screen.getByText(/not in the applications pipeline/i)).toBeTruthy();
    });

    it('states the retention window, because these disappear on their own', async () => {
        render(<UnfinishedApplicationsPage />);

        await waitFor(() => expect(screen.getByText(/Kept for 30 days/)).toBeTruthy());
    });

    it('shows an empty state rather than an empty table', async () => {
        callableSpy.mockResolvedValue({ data: { drafts: [], retentionDays: 30 } });
        render(<UnfinishedApplicationsPage />);

        await waitFor(() => expect(screen.getByText('No unfinished applications.')).toBeTruthy());
    });

    it('surfaces a load failure with a retry', async () => {
        callableSpy.mockRejectedValue({ code: 'functions/internal' });
        render(<UnfinishedApplicationsPage />);

        await waitFor(() => expect(
            screen.getByText('Unfinished applications could not be loaded.'),
        ).toBeTruthy());
        fireEvent.click(screen.getAllByRole('button', { name: /try again/i })[0]);
        await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(2));
    });

    it('reports a permission failure as one, without a partial list', async () => {
        callableSpy.mockRejectedValue({ code: 'functions/permission-denied' });
        render(<UnfinishedApplicationsPage />);

        await waitFor(() => expect(
            screen.getByText('You do not have access to this company.'),
        ).toBeTruthy());
        expect(screen.queryByText('Dana Alvarez')).toBeNull();
    });
});

describe('what it does not show', () => {
    it('renders no application answers, even if the server sent some', async () => {
        // Defence in depth: the server sends a contact summary, and this screen
        // has no column that could display an answer if that ever changed.
        callableSpy.mockResolvedValue({
            data: {
                drafts: [{
                    ...DRAFTS[0],
                    formData: { cdlNumber: 'D9988776', 'drug-test-positive': 'yes' },
                    ssn: '123-45-6789',
                }],
                retentionDays: 30,
            },
        });
        render(<UnfinishedApplicationsPage />);

        await waitFor(() => expect(screen.getByText('Dana Alvarez')).toBeTruthy());
        expect(document.body.innerHTML).not.toContain('D9988776');
        expect(document.body.innerHTML).not.toContain('123-45-6789');
        expect(document.body.innerHTML).not.toContain('drug-test-positive');
    });

    it('offers no way to open or edit an unfinished application', async () => {
        render(<UnfinishedApplicationsPage />);
        await waitFor(() => expect(screen.getByText('Dana Alvarez')).toBeTruthy());

        // A contact list, not a pipeline screen. Reading someone's partial DOT
        // questionnaire before they agreed to submit it is a decision they have
        // not made.
        expect(screen.queryByRole('button', { name: /^View$/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Open$/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    });
});
