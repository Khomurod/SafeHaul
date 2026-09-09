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
/**
 * Per-name callables, with `callableSpy` as the default.
 *
 * The list and the mint are different callables reached from one screen, and a
 * single shared double would have the mint resolving a list of drafts — which is
 * the shape of failure that looks like a passing test.
 */
const byName = {};

vi.mock('firebase/functions', () => ({
    httpsCallable: (...args) => {
        httpsCallableSpy(...args);
        return byName[args[1]] || callableSpy;
    },
}));
vi.mock('@lib/firebase', () => ({ functions: {}, db: {}, storage: {} }));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({
        currentCompanyProfile: { id: 'company-1', companyName: 'Acme Freight', appSlug: 'acme' },
    }),
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

const mintSpy = vi.fn();
const writeTextSpy = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(byName)) delete byName[key];
    callableSpy.mockResolvedValue({ data: { drafts: DRAFTS, retentionDays: 30 } });
    byName.mintApplicationInvite = mintSpy;
    mintSpy.mockResolvedValue({
        data: {
            inviteToken: 'invite-token-1', applicantKey: 'key-1',
            expiresInDays: 14, requiresIdentity: true,
        },
    });
    // happy-dom ships a real `navigator.clipboard`, and redefining the property on
    // the instance does not displace it — so this spies on the method that is
    // actually there rather than substituting an object nothing reads.
    writeTextSpy.mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeTextSpy);
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

/**
 * Sending an unfinished applicant back to their own work.
 *
 * Until 2026-09-09 this screen had one control — Refresh — because
 * `mintApplicationInvite` refused any draft the carrier had not itself prepared.
 * So a recruiter watching somebody stop at the licence page could only ask them
 * to start again, which throws away every answer the draft feature exists to
 * keep. The cases below are the workflow and the restraint that goes with it.
 */
describe('the continuation link', () => {
    it('mints one for the row it was pressed on, and copies it', async () => {
        render(<UnfinishedApplicationsPage />);
        await screen.findByText('Dana Alvarez');

        fireEvent.click(await screen.findByRole('button', {
            name: /Create a continuation link for Dana Alvarez/i,
        }));

        await waitFor(() => expect(mintSpy).toHaveBeenCalledWith({
            companyId: 'company-1', applicantKey: 'key-1',
        }));
        await waitFor(() => expect(writeTextSpy)
            .toHaveBeenCalledWith('http://localhost:3000/apply/acme?invite=invite-token-1&k=key-1'));
    });

    it('shows the link, its life and what it will not do', async () => {
        render(<UnfinishedApplicationsPage />);
        await screen.findByText('Dana Alvarez');
        fireEvent.click(await screen.findByRole('button', {
            name: /Create a continuation link for Dana Alvarez/i,
        }));

        expect(await screen.findByText(/apply\/acme\?invite=invite-token-1/)).toBeInTheDocument();
        // The link is a pointer, and the screen says so: a recruiter must not read
        // this as a way to see the driver's half-finished answers.
        expect(screen.getByText(/will not show you their answers/i)).toBeInTheDocument();
        expect(screen.getByText(/Works for 14 days/i)).toBeInTheDocument();
    });

    it('never shows one driver’s link under another driver’s button', async () => {
        // Structural, not a matter of remembering to reset: the hook holds one link
        // and does not watch which row asked, so a plain read would leave Dana's
        // URL under the next row's Copy button — one press from sending a stranger
        // somebody else's application.
        render(<UnfinishedApplicationsPage />);
        await screen.findByText('Dana Alvarez');
        fireEvent.click(await screen.findByRole('button', {
            name: /Create a continuation link for Dana Alvarez/i,
        }));
        await screen.findByText(/apply\/acme\?invite=invite-token-1/);

        // The second row still offers to CREATE one, and shows no URL.
        expect(screen.getByRole('button', {
            name: /Create a continuation link for starter@example.test|Create a continuation link for this applicant/i,
        })).toBeInTheDocument();
        expect(screen.getAllByText(/invite=invite-token-1/)).toHaveLength(1);
    });

    it('says so when the clipboard refuses, because the link is not lost', async () => {
        writeTextSpy.mockRejectedValue(new Error('denied'));
        render(<UnfinishedApplicationsPage />);
        await screen.findByText('Dana Alvarez');
        fireEvent.click(await screen.findByRole('button', {
            name: /Create a continuation link for Dana Alvarez/i,
        }));

        expect(await screen.findByText(/would not let us copy it/i)).toBeInTheDocument();
        expect(screen.getByText(/apply\/acme\?invite=invite-token-1/)).toBeInTheDocument();
    });

    it('still shows no answers anywhere on the screen', async () => {
        // The whole point of the restraint above, re-asserted now that the screen
        // has an action: `listApplicationDrafts` returns no `formData`, and nothing
        // added here asks for any.
        render(<UnfinishedApplicationsPage />);
        await screen.findByText('Dana Alvarez');

        const names = httpsCallableSpy.mock.calls.map(([, name]) => name);
        expect(names).not.toContain('getCompanyPreparedDraft');
        expect(names).not.toContain('resumeApplicationDraft');
    });
});
