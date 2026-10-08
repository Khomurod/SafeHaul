/**
 * Deleting an unfinished application with everything in it, as a Company Admin
 * does it on the page: what the dialog says will go, the same driver's other
 * applications ticked and untickable, and what the list says afterwards.
 *
 * The owner decided on 2026-10-07 that deleting one deletes the same driver's
 * other unfinished application too, shown first. The server's side of it is
 * `functions/test/unit/applicationDrafts.purge.test.js`.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ byName: {} }));

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
        currentUserClaims: { roles: { 'company-1': 'company_admin' } },
    }),
}));
vi.mock('@features/driver-app/hooks/useGuestFileUpload', () => ({
    useGuestFileUpload: () => ({ handleFileUpload: vi.fn(), isUploading: false }),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => ({ showError: vi.fn() }) }));

import { UnfinishedApplicationsPage } from './UnfinishedApplicationsPage';

const DANA = {
    applicantKey: 'aaaa1111bbbb2222cccc', origin: 'driver', status: 'in_progress', firstName: 'Dana', lastName: 'Alvarez',
    email: 'dana@example.test', phone: '2145550147', lastSemanticStep: 'license', lastStep: 2, updatedAt: '2026-10-05T09:20:00Z',
};
const DANA_AGAIN = {
    ...DANA, applicantKey: 'aaaa1111bbbb2222dddd', email: 'dana.alvarez@example.test', lastSemanticStep: 'employment',
};
const SAM = {
    ...DANA, applicantKey: 'aaaa1111bbbb2222eeee', firstName: 'Sam', lastName: 'Ortiz', email: 'sam@example.test',
    lastSemanticStep: 'contact',
};
const ROWS = [DANA, DANA_AGAIN, SAM];

const listSpy = vi.fn();
const purgeSpy = vi.fn();

/** Dana's preview: two uploads, her other application, and Sam on the same phone. */
const PREVIEW = {
    application: { ...DANA, fileCount: 2 },
    related: [
        { ...DANA_AGAIN, fileCount: 1, shares: ['identity'] },
        { ...SAM, fileCount: 0, shares: ['phone'] },
    ],
};

function answerWith({ preview = PREVIEW, purge } = {}) {
    purgeSpy.mockImplementation(async (payload) => {
        if (payload.preview) return { data: preview };
        if (purge) return purge(payload);
        return { data: { deleted: [payload.applicantKey, ...payload.alsoDelete], skipped: [], files: {} } };
    });
}

beforeEach(() => {
    vi.resetAllMocks();
    for (const key of Object.keys(mocks.byName)) delete mocks.byName[key];
    listSpy.mockImplementation(async () => ({ data: { drafts: ROWS, retentionDays: 30 } }));
    answerWith();
    Object.assign(mocks.byName, { listApplicationDrafts: listSpy, purgeApplicationDraft: purgeSpy });
});

/** How many rows carry this name: Dana has two applications, under one name. */
const rowsFor = (name) => screen.queryAllByRole('button', { name: new RegExp(`Create a continuation link for ${name}`, 'i') }).length;
const listed = () => screen.findAllByRole('button', { name: /Create a continuation link for Dana Alvarez/i });

async function askToDeleteDana() {
    render(<UnfinishedApplicationsPage />);
    await listed();
    fireEvent.click(screen.getAllByRole('button', { name: /Delete the application for Dana Alvarez/i })[0]);
    return screen.findByRole('dialog', { name: 'Delete this unfinished application?' });
}

describe('the dialog', () => {
    it('says what goes, and lists the same driver\'s other applications, each ticked', async () => {
        const dialog = await askToDeleteDana();

        expect(within(dialog).getByText('Everything saved for Dana Alvarez will be deleted for good: its answers, 2 uploaded files and any link sent for it.'))
            .toBeInTheDocument();
        const group = within(dialog).getByRole('group', { name: "Also delete the same driver's other unfinished applications" });
        const boxes = within(group).getAllByRole('checkbox');
        expect(boxes).toHaveLength(2);
        boxes.forEach((box) => expect(box).toBeChecked());
        expect(within(group).getByText('Same last name, date of birth and SSN · Employment history · 1 uploaded file · dana.alvarez@example.test'))
            .toBeInTheDocument();
        expect(within(group).getByText('Same phone · Personal information · sam@example.test')).toBeInTheDocument();
        expect(within(dialog).getByText(/Submitted applications and hired drivers are not touched/)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Delete 3 applications' })).toBeInTheDocument();
    });

    it('says in words everything two applications share', async () => {
        answerWith({ preview: { ...PREVIEW, related: [{ ...DANA_AGAIN, fileCount: 0, shares: ['identity', 'email', 'phone'] }] } });

        const dialog = await askToDeleteDana();

        expect(within(dialog).getByText('Same last name, date of birth and SSN; same email and phone · Employment history · dana.alvarez@example.test'))
            .toBeInTheDocument();
        expect(within(dialog).getByRole('group', { name: "Also delete the same driver's other unfinished application" })).toBeInTheDocument();
    });

    it('opens only once the server has said what would go', async () => {
        let answer;
        purgeSpy.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
        render(<UnfinishedApplicationsPage />);
        await listed();

        fireEvent.click(screen.getAllByRole('button', { name: /Delete the application for Dana Alvarez/i })[0]);

        expect(await screen.findByText('Checking what will be deleted…')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
        answer({ data: PREVIEW });
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        expect(screen.queryByText('Checking what will be deleted…')).toBeNull();
    });
});

describe('confirming', () => {
    it('deletes the application with the ticked ones, and the list loses them all', async () => {
        const dialog = await askToDeleteDana();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 3 applications' }));

        expect(await screen.findByText('Deleted the unfinished application for Dana Alvarez and 2 more.')).toBeInTheDocument();
        expect(purgeSpy).toHaveBeenLastCalledWith({
            companyId: 'company-1', applicantKey: DANA.applicantKey, alsoDelete: [DANA_AGAIN.applicantKey, SAM.applicantKey],
        });
        expect(rowsFor('Dana Alvarez')).toBe(0);
        expect(rowsFor('Sam Ortiz')).toBe(0);
    });

    it('keeps one the admin unticked', async () => {
        const dialog = await askToDeleteDana();

        fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Sam Ortiz' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 applications' }));

        expect(await screen.findByText('Deleted the unfinished application for Dana Alvarez and 1 more.')).toBeInTheDocument();
        expect(purgeSpy).toHaveBeenLastCalledWith({
            companyId: 'company-1', applicantKey: DANA.applicantKey, alsoDelete: [DANA_AGAIN.applicantKey],
        });
        expect(rowsFor('Sam Ortiz')).toBe(1);
    });

    it('reloads the list when the server kept one that had changed since', async () => {
        answerWith({ purge: async () => ({ data: { deleted: [DANA.applicantKey], skipped: [DANA_AGAIN.applicantKey], files: {} } }) });
        const dialog = await askToDeleteDana();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 3 applications' }));

        expect(await screen.findByText('Deleted the unfinished application for Dana Alvarez.')).toBeInTheDocument();
        await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
    });
});

describe('when the lookup does not answer', () => {
    it('treats an application already gone as gone', async () => {
        purgeSpy.mockImplementation(async () => {
            throw Object.assign(new Error('gone'), { code: 'functions/not-found' });
        });
        render(<UnfinishedApplicationsPage />);
        await listed();

        fireEvent.click(screen.getAllByRole('button', { name: /Delete the application for Dana Alvarez/i })[0]);

        expect(await screen.findByText(/The application for Dana Alvarez was already gone/)).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('says so and deletes nothing when it fails', async () => {
        purgeSpy.mockImplementation(async () => {
            throw Object.assign(new Error('slow down'), { code: 'functions/resource-exhausted' });
        });
        render(<UnfinishedApplicationsPage />);
        await listed();

        fireEvent.click(screen.getAllByRole('button', { name: /Delete the application for Dana Alvarez/i })[0]);

        expect(await screen.findByText('Too many deletions in a row. Wait a moment and try again.')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(purgeSpy).toHaveBeenCalledTimes(1);
        expect(rowsFor('Dana Alvarez')).toBe(2);
    });
});
