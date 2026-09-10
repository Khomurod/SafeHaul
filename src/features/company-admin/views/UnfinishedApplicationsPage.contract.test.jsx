/**
 * Contract proof for the unified unfinished-applications workspace.
 *
 * The properties worth pinning are mostly about restraint. Answers are saved from
 * the applicant's first Next, which means a carrier can see records nobody has
 * signed, consented to or submitted — so what this screen may show is a narrower
 * question than what it *could* show.
 *
 * ## And, since 2026-09-10, that a merged screen did not merge the rules
 *
 * `Started (unfinished)` and `Start an application` became one place. Both
 * origins now share one table, so the cases below pin the three things that could
 * go wrong in exactly that move: a draft appearing twice, a driver-started row
 * offering a read it must not offer, and a link landing on the wrong applicant.
 * The prep wizard reached from here has its own two suites
 * (`UnfinishedApplicationsPage.prep*`); `unfinishedRowActions.test.js` drives the
 * per-state rules directly.
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
// The prep workspace reached from here uploads through this, which wants a
// ToastProvider. Uploads are the prep suites' subject, not this one's.
vi.mock('@features/driver-app/hooks/useGuestFileUpload', () => ({
    useGuestFileUpload: () => ({ handleFileUpload: vi.fn(), isUploading: false }),
}));

import { UnfinishedApplicationsPage } from './UnfinishedApplicationsPage';

/** The driver started this one herself. The carrier may never read her answers. */
const DRIVER_STARTED = {
    applicantKey: 'key-1',
    origin: 'driver',
    status: 'in_progress',
    firstName: 'Dana',
    lastName: 'Alvarez',
    email: 'dana@example.test',
    phone: '2145550147',
    lastSemanticStep: 'license',
    lastStep: 2,
    createdAt: '2026-08-14T09:00:00Z',
    updatedAt: '2026-08-14T09:20:00Z',
};

/** A driver-started draft with nothing typed yet — the shape that used to break rows. */
const DRIVER_NAMELESS = {
    applicantKey: 'key-2',
    origin: 'driver',
    status: 'in_progress',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    lastSemanticStep: null,
    lastStep: 0,
    createdAt: '2026-08-15T09:00:00Z',
    updatedAt: '2026-08-15T09:00:00Z',
};

/** The carrier's own, not yet sent. Its answers are the carrier's until the driver writes. */
const COMPANY_PREPARED = {
    applicantKey: 'key-3',
    origin: 'company',
    status: 'prepared',
    firstName: 'Marcus',
    lastName: 'Iyer',
    email: 'marcus@example.test',
    phone: '2145550188',
    lastSemanticStep: null,
    lastStep: 0,
    preparedBy: { uid: 'u-1', name: 'Rae Recruiter' },
    lockedEmployerCount: 2,
    createdAt: '2026-08-16T09:00:00Z',
    updatedAt: '2026-08-16T09:00:00Z',
};

/** The carrier prepared it and the driver has since written. The one-way door. */
const COMPANY_TAKEN_OVER = {
    ...COMPANY_PREPARED,
    applicantKey: 'key-4',
    status: 'driver_in_progress',
    firstName: 'Priya',
    lastName: 'Raman',
    email: 'priya@example.test',
    lastSemanticStep: 'employment',
    lastStep: 5,
};

const DRAFTS = [DRIVER_STARTED, DRIVER_NAMELESS];
const ALL_FOUR = [DRIVER_STARTED, DRIVER_NAMELESS, COMPANY_PREPARED, COMPANY_TAKEN_OVER];

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

        await waitFor(() => expect(screen.getByText('Nothing is unfinished.')).toBeTruthy());
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

    it('offers no way to open or edit a DRIVER-started application', async () => {
        render(<UnfinishedApplicationsPage />);
        await waitFor(() => expect(screen.getByText('Dana Alvarez')).toBeTruthy());

        // Reading someone's partial DOT questionnaire before they agreed to submit
        // it is a decision they have not made. Merging the two screens did not
        // change that: `getCompanyPreparedDraft` refuses a draft the carrier did
        // not author outright, so an Open here would be a button that cannot work.
        expect(screen.queryByRole('button', { name: /Open the application for Dana Alvarez/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /^View$/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    });
});

/**
 * The consolidation itself: one list, two origins, different powers.
 */
describe('one workspace for both origins', () => {
    beforeEach(() => {
        callableSpy.mockResolvedValue({ data: { drafts: ALL_FOUR, retentionDays: 30 } });
    });

    it('reads one list, so a prepared draft cannot appear twice', async () => {
        render(<UnfinishedApplicationsPage />);
        await waitFor(() => expect(screen.getByText('Marcus Iyer')).toBeTruthy());

        // The old pair of screens both returned a carrier-prepared draft — this one
        // asks `listApplicationDrafts` and nothing else, so a row is a document.
        const names = httpsCallableSpy.mock.calls.map(([, name]) => name);
        expect(names).toContain('listApplicationDrafts');
        expect(names).not.toContain('listCompanyPreparedApplications');
        for (const name of ['Dana Alvarez', 'Marcus Iyer', 'Priya Raman']) {
            expect(screen.getAllByText(name)).toHaveLength(1);
        }
    });

    it('says who started each one', async () => {
        render(<UnfinishedApplicationsPage />);
        await waitFor(() => expect(screen.getByText('Marcus Iyer')).toBeTruthy());

        // `selector: 'span'` because the first column's HEADER is also "Driver",
        // and a count that silently included a `<th>` would pass for the wrong
        // reason the day a row stopped rendering.
        expect(screen.getAllByText('Driver', { selector: 'span' })).toHaveLength(2);
        expect(screen.getAllByText('Company', { selector: 'span' })).toHaveLength(2);
        // And who at the company, which the old prepared-only table showed.
        expect(screen.getAllByText('Rae Recruiter')).toHaveLength(2);
    });

    it('names each state in the product’s own words, not a draft status', async () => {
        render(<UnfinishedApplicationsPage />);
        await waitFor(() => expect(screen.getByText('Marcus Iyer')).toBeTruthy());

        expect(screen.getByText('Not sent yet')).toBeTruthy();
        expect(screen.getByText('Driver is filling it in')).toBeTruthy();
        expect(screen.getAllByText('Unfinished')).toHaveLength(2);
        // No internal vocabulary reaches the recruiter.
        expect(document.body.innerHTML).not.toContain('driver_in_progress');
        expect(document.body.innerHTML).not.toContain('in_progress');
    });

    it('offers Open on the carrier’s own rows, both before and after takeover', async () => {
        render(<UnfinishedApplicationsPage />);
        await waitFor(() => expect(screen.getByText('Marcus Iyer')).toBeTruthy());

        // Before takeover the carrier is still the author of the answers.
        expect(screen.getByRole('button', { name: /Open the application for Marcus Iyer/i })).toBeInTheDocument();
        // After takeover it may still open the record — and the SERVER decides what
        // comes back (`companyMayReadAnswers`), which is why the button stays. That
        // is the behaviour the continuation work shipped, and merging must not
        // quietly remove the recruiter's way back to their own prepared record.
        expect(screen.getByRole('button', { name: /Open the application for Priya Raman/i })).toBeInTheDocument();
    });

    it('still shows no answers, whatever the origin', async () => {
        callableSpy.mockResolvedValue({
            data: {
                drafts: ALL_FOUR.map((row) => ({
                    ...row,
                    formData: { cdlNumber: 'D9988776' },
                    ssn: '123-45-6789',
                })),
                retentionDays: 30,
            },
        });
        render(<UnfinishedApplicationsPage />);
        await waitFor(() => expect(screen.getByText('Marcus Iyer')).toBeTruthy());

        expect(document.body.innerHTML).not.toContain('D9988776');
        expect(document.body.innerHTML).not.toContain('123-45-6789');
    });

    it('shows how many employers the carrier locked, on its own rows only', async () => {
        render(<UnfinishedApplicationsPage />);
        await waitFor(() => expect(screen.getByText('Marcus Iyer')).toBeTruthy());

        // Kept from the prepared-only table: an orphaned lock used to block a
        // driver's submission invisibly.
        expect(screen.getAllByText('2 employers locked')).toHaveLength(2);
    });

    it('starts a new application from here, and comes back to the list', async () => {
        render(<UnfinishedApplicationsPage />);
        await waitFor(() => expect(screen.getByText('Marcus Iyer')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: /Start an application/i }));
        // The fork the prep workspace opens on.
        await waitFor(() => expect(screen.getByText(/How do you want to fill this in/i)).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
        await waitFor(() => expect(screen.getByText('Marcus Iyer')).toBeTruthy());
        // The worklist reloads, because a save may have added or moved a row.
        expect(callableSpy.mock.calls.length).toBeGreaterThan(1);
    });

    it('stops a row reading "Not sent yet" once its link exists', async () => {
        mintSpy.mockResolvedValue({
            data: {
                inviteToken: 'invite-token-3', applicantKey: 'key-3',
                expiresInDays: 14, requiresIdentity: false,
            },
        });
        render(<UnfinishedApplicationsPage />);
        await waitFor(() => expect(screen.getByText('Not sent yet')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: /Create the driver's link for Marcus Iyer/i }));

        // Minting is what moves a prepared draft to `sent` server-side, so the row
        // must not keep contradicting the link now sitting under it.
        await waitFor(() => expect(screen.queryByText('Not sent yet')).toBeNull());
        expect(screen.getAllByText('Link sent')).toHaveLength(1);
        // And the link the recruiter came for is still on screen, not swapped out
        // for a loading skeleton by a reload.
        expect(screen.getByText(/invite=invite-token-3/)).toBeInTheDocument();
    });

    it('names the mint action for what it is at each stage', async () => {
        render(<UnfinishedApplicationsPage />);
        await waitFor(() => expect(screen.getByText('Marcus Iyer')).toBeTruthy());

        expect(screen.getByRole('button', { name: /Create the driver's link for Marcus Iyer/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create a continuation link for Dana Alvarez/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create a continuation link for Priya Raman/i })).toBeInTheDocument();
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

    /**
     * The one failure that used to produce nothing at all, found in review on
     * 2026-09-09.
     *
     * `useInviteLink` records a refused mint in its `error`, and this screen never
     * read it — so an ended session or a spent rate limit stopped the button
     * spinning and left the recruiter with no link and no explanation. Exactly the
     * silence the clipboard case above already fixed, one step earlier: a lost link
     * this time, not a lost convenience.
     */
    it('says so when the mint itself is refused, and says it on the right row', async () => {
        mintSpy.mockRejectedValue({ code: 'functions/resource-exhausted' });
        render(<UnfinishedApplicationsPage />);
        await screen.findByText('Dana Alvarez');
        fireEvent.click(await screen.findByRole('button', {
            name: /Create a continuation link for Dana Alvarez/i,
        }));

        // Named for what was refused. The shared `describeError` calls this one
        // "too many saves", and nothing here was being saved.
        expect(await screen.findByText(/Too many links created in a row/i)).toBeInTheDocument();
        // Not the clipboard's message: nothing was copied because nothing existed.
        expect(screen.queryByText(/would not let us copy it/i)).not.toBeInTheDocument();
        // And no link was shown, on this row or any other.
        expect(screen.queryByText(/invite=/)).not.toBeInTheDocument();
        // Scoped to the row that asked. The hook holds one error at a time, so an
        // unscoped read would print it under every driver on the screen.
        expect(screen.getAllByText(/Too many links created in a row/i)).toHaveLength(1);
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
