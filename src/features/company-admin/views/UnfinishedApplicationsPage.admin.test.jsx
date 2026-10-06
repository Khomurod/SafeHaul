/**
 * What a Company Admin may do in the unfinished-applications workspace.
 *
 * The owner decided on 2026-10-06 that a Company Admin opens every unfinished
 * application — read-only where the driver has written — and may delete any of
 * them. Recruiters keep what `UnfinishedApplicationsPage.contract.test.jsx`
 * pins; these drive the same screen with an admin's claims, and once with a
 * recruiter's to show the two do not bleed into each other.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    byName: {},
    claims: null,
}));

vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => mocks.byName[name] || (async () => {
        throw Object.assign(new Error(`unexpected callable ${name}`), { code: 'functions/internal' });
    }),
}));
vi.mock('@lib/firebase', () => ({ functions: {}, db: {}, storage: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => null }));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({
        currentCompanyProfile: { id: 'company-1', companyName: 'Acme Freight', appSlug: 'acme' },
        currentUserClaims: mocks.claims,
    }),
}));
vi.mock('@features/driver-app/hooks/useGuestFileUpload', () => ({
    useGuestFileUpload: () => ({ handleFileUpload: vi.fn(), isUploading: false }),
}));
// The record view's Open file reports through a toast; nothing here presses it.
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => ({ showError: vi.fn() }) }));

import { UnfinishedApplicationsPage } from './UnfinishedApplicationsPage';

const ADMIN = { roles: { 'company-1': 'company_admin' } };
const RECRUITER = { roles: { 'company-1': 'recruiter' } };

const DRIVER_STARTED = {
    applicantKey: 'aaaa1111bbbb2222cccc',
    origin: 'driver',
    status: 'in_progress',
    firstName: 'Dana',
    lastName: 'Alvarez',
    email: 'dana@example.test',
    phone: '2145550147',
    lastSemanticStep: 'license',
    lastStep: 2,
    updatedAt: '2026-10-05T09:20:00Z',
};
const COMPANY_PREPARED = {
    applicantKey: 'cccc3333dddd4444eeee',
    origin: 'company',
    status: 'prepared',
    firstName: 'Marcus',
    lastName: 'Iyer',
    email: 'marcus@example.test',
    phone: '2145550188',
    lastStep: 0,
    preparedBy: { uid: 'u-1', name: 'Rae Recruiter' },
    updatedAt: '2026-10-04T09:00:00Z',
};
const TAKEN_OVER = {
    ...COMPANY_PREPARED,
    applicantKey: 'dddd4444eeee5555ffff',
    status: 'driver_in_progress',
    firstName: 'Priya',
    lastName: 'Raman',
    email: 'priya@example.test',
};
const ROWS = [DRIVER_STARTED, COMPANY_PREPARED, TAKEN_OVER];

/** What `getApplicationDraft` returns: the row's summary and a snapshot-shaped record. */
function draftResponse(summary = DRIVER_STARTED) {
    return {
        ...summary,
        record: {
            frozen: true,
            schemaVersion: 1,
            submittedAt: null,
            provenance: { source: 'draft', notes: [] },
            sections: [
                {
                    id: 'license',
                    title: 'License & Credentials',
                    answers: [
                        { fieldId: 'cdlNumber', label: 'License Number', type: 'text', presented: true, value: 'D9988776', displayValue: 'D9988776' },
                    ],
                },
                {
                    id: 'documents',
                    title: 'Required Documents',
                    answers: [{
                        fieldId: 'cdl-front', label: 'CDL (Front)', type: 'file', presented: true,
                        value: { name: 'front.jpg', storagePath: 'companies/company-1/applications/guest_uploads/1_front.jpg' },
                        displayValue: 'front.jpg',
                    }],
                },
            ],
            customAnswers: [
                { questionId: 'q1', label: 'Willing to run a dedicated lane?', value: 'Yes', displayValue: 'Yes' },
            ],
            agreements: [],
            employmentCoverage: null,
            signature: null,
        },
    };
}

const listSpy = vi.fn();
const viewSpy = vi.fn();
const deleteSpy = vi.fn();
const preparedSpy = vi.fn();

beforeEach(() => {
    vi.resetAllMocks();
    mocks.claims = ADMIN;
    for (const key of Object.keys(mocks.byName)) delete mocks.byName[key];
    listSpy.mockImplementation(async () => ({ data: { drafts: ROWS, retentionDays: 30 } }));
    viewSpy.mockImplementation(async () => ({ data: draftResponse() }));
    deleteSpy.mockImplementation(async ({ applicantKey }) => ({ data: { deleted: true, applicantKey } }));
    preparedSpy.mockImplementation(async () => ({
        data: { ...COMPANY_PREPARED, formData: { firstName: 'Marcus' }, lockedEmployers: [], readable: true },
    }));
    Object.assign(mocks.byName, {
        listApplicationDrafts: listSpy,
        getApplicationDraft: viewSpy,
        deleteApplicationDraft: deleteSpy,
        getCompanyPreparedDraft: preparedSpy,
    });
});

async function renderList() {
    render(<UnfinishedApplicationsPage />);
    // The row's own control, which cannot exist before the list has loaded.
    await screen.findByRole('button', { name: /Create a continuation link for Dana Alvarez/i });
}

const openButton = (name) => screen.queryByRole('button', { name: new RegExp(`Open the application for ${name}`, 'i') });
const deleteButton = (name) => screen.queryByRole('button', { name: new RegExp(`Delete the application for ${name}`, 'i') });

describe('a Company Admin', () => {
    it('can open and delete every row, whoever started it', async () => {
        await renderList();

        for (const name of ['Dana Alvarez', 'Marcus Iyer', 'Priya Raman']) {
            expect(openButton(name)).toBeInTheDocument();
            expect(deleteButton(name)).toBeInTheDocument();
        }
    });

    it('reads a driver-started application, with what it will never show said plainly', async () => {
        await renderList();

        fireEvent.click(openButton('Dana Alvarez'));

        await screen.findByText('D9988776');
        expect(viewSpy).toHaveBeenCalledWith({ companyId: 'company-1', applicantKey: DRIVER_STARTED.applicantKey });
        expect(screen.getByRole('heading', { level: 1, name: 'Dana Alvarez' })).toBeInTheDocument();
        expect(screen.getByText('Willing to run a dedicated lane?')).toBeInTheDocument();
        expect(screen.getByText(/never saved before the driver submits/i)).toBeInTheDocument();
        // The licence photo can be opened; its storage path is never printed.
        expect(screen.getByRole('button', { name: 'Open file (opens in a new tab)' })).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('guest_uploads');
        // Read-only: nothing on this screen saves.
        expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
        expect(preparedSpy).not.toHaveBeenCalled();
    });

    it('reads a prepared application the driver has taken over, where a recruiter sees progress only', async () => {
        viewSpy.mockImplementation(async () => ({ data: draftResponse(TAKEN_OVER) }));
        await renderList();

        fireEvent.click(openButton('Priya Raman'));

        await screen.findByText('D9988776');
        expect(viewSpy).toHaveBeenCalledWith({ companyId: 'company-1', applicantKey: TAKEN_OVER.applicantKey });
        expect(preparedSpy).not.toHaveBeenCalled();
    });

    it('still edits what the carrier is preparing, in the prep workspace', async () => {
        await renderList();

        fireEvent.click(openButton('Marcus Iyer'));

        await waitFor(() => expect(preparedSpy).toHaveBeenCalled());
        expect(viewSpy).not.toHaveBeenCalled();
    });

    it('comes back to a fresh list from the read-only view', async () => {
        await renderList();
        fireEvent.click(openButton('Dana Alvarez'));
        await screen.findByText('D9988776');

        fireEvent.click(screen.getByRole('button', { name: /Back to unfinished applications/i }));

        await screen.findByRole('button', { name: /Create a continuation link for Dana Alvarez/i });
        expect(listSpy).toHaveBeenCalledTimes(2);
    });

    it('says so when the application is no longer there, and offers the way back', async () => {
        viewSpy.mockImplementation(async () => {
            throw Object.assign(new Error('That unfinished application could not be found. It may have been submitted or deleted, or it may have expired.'), { code: 'functions/not-found' });
        });
        await renderList();

        fireEvent.click(openButton('Dana Alvarez'));

        expect(await screen.findByText('This application is no longer here')).toBeInTheDocument();
        expect(screen.getByText(/It may have been submitted or deleted/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Try again/i })).toBeNull();
    });

    it('offers a retry when the read fails for any other reason', async () => {
        viewSpy.mockImplementationOnce(async () => {
            throw Object.assign(new Error('boom'), { code: 'functions/internal' });
        });
        await renderList();
        fireEvent.click(openButton('Dana Alvarez'));
        expect(await screen.findByText('The application could not be loaded')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

        expect(await screen.findByText('D9988776')).toBeInTheDocument();
        expect(viewSpy).toHaveBeenCalledTimes(2);
    });

    it('treats a record it cannot lay out as a failure, never as an empty submission', async () => {
        // `PreservedApplicationView` has its own empty state, and it speaks of a
        // submission that was not preserved — the wrong sentence for a draft.
        viewSpy.mockImplementation(async () => ({ data: { ...DRIVER_STARTED, record: { sections: 'not a record' } } }));
        await renderList();

        fireEvent.click(openButton('Dana Alvarez'));

        expect(await screen.findByText('The application could not be loaded')).toBeInTheDocument();
        expect(screen.queryByText(/Nothing was preserved/)).toBeNull();
    });

    it('deletes a row only after confirming, and says what happened', async () => {
        await renderList();

        fireEvent.click(deleteButton('Dana Alvarez'));
        const dialog = await screen.findByRole('dialog', { name: 'Delete this unfinished application?' });
        expect(within(dialog).getByText(/Dana Alvarez will be deleted for good/)).toBeInTheDocument();
        // The safe action is the one focused first.
        expect(within(dialog).getByRole('button', { name: 'Keep application' })).toHaveFocus();
        expect(deleteSpy).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete application' }));

        const note = await screen.findByText('Deleted the unfinished application for Dana Alvarez.');
        expect(deleteSpy).toHaveBeenCalledWith({ companyId: 'company-1', applicantKey: DRIVER_STARTED.applicantKey });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(openButton('Dana Alvarez')).toBeNull();
        // The row and its button are gone, so focus moves to what happened.
        await waitFor(() => expect(note.closest('[tabindex="-1"]')).toHaveFocus());
        // The other rows are untouched.
        expect(openButton('Marcus Iyer')).toBeInTheDocument();
    });

    it('keeps the row when the admin changes their mind', async () => {
        await renderList();

        fireEvent.click(deleteButton('Marcus Iyer'));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep application' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(deleteSpy).not.toHaveBeenCalled();
        expect(openButton('Marcus Iyer')).toBeInTheDocument();
    });

    it('keeps the dialog and the row when the server refuses, and says why', async () => {
        deleteSpy.mockImplementation(async () => {
            throw Object.assign(new Error('Company admin access required.'), { code: 'functions/permission-denied' });
        });
        await renderList();

        fireEvent.click(deleteButton('Dana Alvarez'));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete application' }));

        expect(await within(dialog).findByText('Only a Company Admin can delete an unfinished application.')).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(openButton('Dana Alvarez')).toBeInTheDocument();
    });

    it('treats a row that was already gone as gone, rather than as a failure', async () => {
        deleteSpy.mockImplementation(async () => {
            throw Object.assign(new Error('gone'), { code: 'functions/not-found' });
        });
        await renderList();

        fireEvent.click(deleteButton('Dana Alvarez'));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete application' }));

        expect(await screen.findByText(/The application for Dana Alvarez was already gone/)).toBeInTheDocument();
        expect(openButton('Dana Alvarez')).toBeNull();
    });

    it('includes a super admin, as every admin-only screen does', async () => {
        mocks.claims = { globalRole: 'super_admin', roles: { globalRole: 'super_admin' } };
        await renderList();

        expect(openButton('Dana Alvarez')).toBeInTheDocument();
        expect(deleteButton('Dana Alvarez')).toBeInTheDocument();
    });
});

describe('a recruiter on the same screen', () => {
    it.each([
        ['a recruiter', RECRUITER],
        ['an HR user', { roles: { 'company-1': 'hr_user' } }],
        ['an admin of a different company', { roles: { 'company-2': 'company_admin' } }],
    ])('is %s, and gets neither the read nor the delete', async (_who, claims) => {
        mocks.claims = claims;
        await renderList();

        expect(openButton('Dana Alvarez')).toBeNull();
        expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
        // Their own prepared work still opens, as before.
        expect(openButton('Marcus Iyer')).toBeInTheDocument();
        expect(openButton('Priya Raman')).toBeInTheDocument();
    });
});
