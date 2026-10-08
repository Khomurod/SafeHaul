/**
 * A Company Admin editing an unfinished application the driver owns, from the
 * review screen: what is offered, what a save sends, and what each answer from
 * the server leaves on screen. The server's half is
 * `functions/test/unit/applicationDrafts.admin-edit.test.js`.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ byName: {}, uploading: false }));

vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => mocks.byName[name] || (async () => {
        throw Object.assign(new Error(`unexpected callable ${name}`), { code: 'functions/internal' });
    }),
}));
vi.mock('@lib/firebase', () => ({ functions: {}, db: {}, storage: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => null }));
vi.mock('@features/driver-app/hooks/useGuestFileUpload', () => ({
    useGuestFileUpload: () => ({ handleFileUpload: vi.fn(async () => null), isUploading: mocks.uploading }),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() }),
}));

import { UnfinishedApplicationReview } from './UnfinishedApplicationReview';

const KEY = 'aaaa1111bbbb2222cccc';
const ENTRY = { applicantKey: KEY, origin: 'driver', status: 'in_progress', firstName: 'Dana', lastName: 'Alvarez' };
const RECORD = {
    frozen: true,
    schemaVersion: 1,
    submittedAt: null,
    provenance: { source: 'draft', notes: [] },
    sections: [{
        id: 'addressHistory',
        title: 'Address History',
        answers: [{ fieldId: 'city', label: 'Current City', type: 'text', presented: true, value: 'Austin', displayValue: 'Austin' }],
    }],
    customAnswers: [],
    agreements: [],
    employmentCoverage: null,
    signature: null,
};

/** `getApplicationDraft`'s answer for a draft the driver owns. */
function view(overrides = {}) {
    return {
        ...ENTRY,
        updatedAt: '2026-10-05T09:20:00Z',
        record: RECORD,
        editable: true,
        answers: { firstName: 'Dana', city: 'Austin', 'has-felony': 'no', customAnswers: { 'q-lane': 'yes' } },
        lockedEmployers: [],
        form: {
            applicationConfig: {},
            applicationRules: null,
            customQuestions: [{
                id: 'q-lane', label: 'Willing to run a dedicated lane?', type: 'multipleChoice', options: ['yes', 'no'],
            }],
        },
        companyRevision: 0,
        companyEdits: {},
        companyEditedAt: null,
        ...overrides,
    };
}

const viewSpy = vi.fn();
const saveSpy = vi.fn();

beforeEach(() => {
    vi.resetAllMocks();
    mocks.uploading = false;
    for (const key of Object.keys(mocks.byName)) delete mocks.byName[key];
    viewSpy.mockImplementation(async () => ({ data: view() }));
    saveSpy.mockImplementation(async ({ changes }) => ({
        data: view({
            answers: { ...view().answers, ...changes },
            companyRevision: 1791300000000,
            companyEditedAt: '2026-10-07T10:00:00.000Z',
            changed: Object.keys(changes),
            revision: 1791300000000,
        }),
    }));
    Object.assign(mocks.byName, { getApplicationDraft: viewSpy, saveApplicationDraftEdits: saveSpy });
});

async function openEditor(data = view()) {
    viewSpy.mockImplementation(async () => ({ data }));
    render(<UnfinishedApplicationReview companyId="company-1" entry={ENTRY} onExit={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit answers/i }));
    await screen.findByRole('button', { name: 'Save changes' });
}

/** The current address's city: the first on the page, before any employer's. */
const cityInput = () => screen.getAllByLabelText('City')[0];

describe('editing an unfinished application the driver owns', () => {
    it('is offered only where the server says the draft is the admin\'s to edit', async () => {
        viewSpy.mockImplementation(async () => ({ data: view({ editable: false }) }));
        render(<UnfinishedApplicationReview companyId="company-1" entry={ENTRY} onExit={vi.fn()} />);

        await screen.findByText('Austin');
        expect(screen.queryByRole('button', { name: /Edit answers/i })).toBeNull();
    });

    it('offers the answers, never the ones only the driver gives', async () => {
        await openEditor(view({ answers: { ...view().answers, employers: [{ companyName: 'Acme Trucking' }] } }));

        expect(cityInput()).toHaveValue('Austin');
        expect(screen.getByLabelText('First Name')).toHaveValue('Dana');
        // The driver's own, by the ids the editor would give them (an employer has a Phone of its own).
        for (const field of ['email', 'phone', 'lastName', 'dob', 'ssn', 'sms-consent']) {
            expect(document.getElementById(`${field}-edit`)).toBeNull();
        }
        expect(screen.queryByLabelText('Last Name')).toBeNull();
        expect(screen.queryByLabelText('Date of Birth')).toBeNull();
        expect(screen.queryByText(/Hours of Service Statement/)).toBeNull();
        // The company's own questions, as the driver was asked them, without the step's own navigation.
        expect(screen.getByText('Willing to run a dedicated lane?')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
        // Employers without what only a submitted application has: verification and approval.
        expect(screen.getByDisplayValue('Acme Trucking')).toBeInTheDocument();
        expect(screen.queryByText(/Verification:/)).toBeNull();
        expect(screen.queryByText(/go to the driver for approval/)).toBeNull();
        // Nothing has changed yet, so there is nothing to save.
        expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    });

    it('sends only what changed, each beside the value it loaded, and shows what was saved', async () => {
        await openEditor();

        fireEvent.change(cityInput(), { target: { value: 'Dallas' } });
        expect(screen.getByText('Changed: Address History')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        await screen.findByText('Changes saved');
        expect(saveSpy).toHaveBeenCalledWith({
            companyId: 'company-1', applicantKey: KEY, changes: { city: 'Dallas' }, base: { city: 'Austin' },
        });
        expect(screen.getByText(/You changed Address History\. The driver is shown what you changed/)).toBeInTheDocument();
        expect(screen.getByText('Last edited by your company')).toBeInTheDocument();
        // Back on the record, not the editor.
        expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    });

    it('shows an employer the company locked as a record, with the rest of its row to change', async () => {
        const acme = { companyName: 'Acme Trucking', dotNumber: '123456' };
        await openEditor(view({
            answers: { ...view().answers, employers: [acme, { companyName: 'Blue Line' }] },
            lockedEmployers: [{ signature: 'dot:123456', ...acme }],
        }));

        // Who it is, as a record rather than a field, and not removable.
        expect(screen.getByText('Locked by your company')).toBeInTheDocument();
        expect(screen.getByText('Acme Trucking')).toBeInTheDocument();
        expect(screen.queryByDisplayValue('Acme Trucking')).toBeNull();
        expect(screen.queryByDisplayValue('123456')).toBeNull();
        expect(screen.queryByRole('button', { name: /Remove Acme Trucking/ })).toBeNull();
        // A row the driver added stays the admin's to change and remove.
        expect(screen.getByDisplayValue('Blue Line')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Remove Blue Line/ })).toBeInTheDocument();

        fireEvent.change(screen.getAllByLabelText('Reason for Leaving')[0], { target: { value: 'Moved closer to home' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(saveSpy).toHaveBeenCalled());
        expect(saveSpy.mock.calls[0][0].changes.employers[0]).toEqual({ ...acme, reasonForLeaving: 'Moved closer to home' });
    });

    it('keeps every other row ordinary: a second stint there, and an employer the driver removed', async () => {
        const acme = { companyName: 'Acme Trucking', dotNumber: '123456' };
        await openEditor(view({
            answers: { ...view().answers, employers: [acme, { ...acme, startDate: '2015-01' }] },
            lockedEmployers: [
                { signature: 'dot:123456', ...acme },
                // The driver removed this row: the submission holds them to it, not this editor.
                { signature: 'dot:654321', companyName: 'Blue Line', dotNumber: '654321' },
            ],
        }));

        expect(screen.getAllByText('Locked by your company')).toHaveLength(1);
        // The second stint at the same employer is the admin's to change or remove.
        expect(screen.getByDisplayValue('Acme Trucking')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /Remove Acme Trucking/ })).toHaveLength(1);

        // An employer the admin adds back stays a row they can correct, whatever its number.
        fireEvent.click(screen.getByRole('button', { name: /Add an employer/ }));
        fireEvent.change(document.getElementById('employer-new-2-dotNumber'), { target: { value: '654321' } });
        expect(screen.getAllByText('Locked by your company')).toHaveLength(1);
        expect(document.getElementById('employer-new-2-companyName')).not.toBeNull();
    });

    it('offers the TWIC card beside the answer that the driver holds one', async () => {
        await openEditor(view({ answers: { ...view().answers, 'has-twic': 'yes' } }));

        expect(screen.getAllByText('Upload TWIC Card').length).toBeGreaterThan(0);
    });

    it('asks an owner-operator\'s business details without the initials only the driver gives', async () => {
        await openEditor(view({ answers: { ...view().answers, businessName: 'Dana Freight LLC' } }));

        expect(screen.getByDisplayValue('Dana Freight LLC')).toBeInTheDocument();
        expect(screen.queryByLabelText(/Driver Initials/)).toBeNull();
    });

    it('leaves only through Save or Cancel while editing, so nothing typed is lost on the way out', async () => {
        await openEditor();

        expect(screen.queryByRole('button', { name: /Back to unfinished applications/i })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(await screen.findByRole('button', { name: /Back to unfinished applications/i })).toBeInTheDocument();
    });

    it('waits for a document still uploading before it saves', async () => {
        mocks.uploading = true;
        await openEditor();

        fireEvent.change(cityInput(), { target: { value: 'Dallas' } });

        expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
        expect(screen.getByText(/Uploading…/)).toBeInTheDocument();
    });

    it('edits the company\'s own questions as one map, keeping the other answers in it', async () => {
        await openEditor(view({
            form: {
                ...view().form,
                customQuestions: [
                    ...view().form.customQuestions,
                    { id: 'q-years', label: 'Years in flatbed?', type: 'shortAnswer' },
                ],
            },
        }));

        fireEvent.change(screen.getByLabelText('Years in flatbed?'), { target: { value: '4' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(saveSpy).toHaveBeenCalled());
        expect(saveSpy.mock.calls[0][0].changes).toEqual({ customAnswers: { 'q-lane': 'yes', 'q-years': '4' } });
        expect(saveSpy.mock.calls[0][0].base).toEqual({ customAnswers: { 'q-lane': 'yes' } });
    });

    it('says when the driver changed an answer meanwhile, and reloads on request', async () => {
        saveSpy.mockImplementation(async () => {
            throw Object.assign(
                new Error('The driver changed some of these answers after you opened the application. Reload it to see their answers, then make your change again.'),
                { code: 'functions/aborted', details: { fields: ['city'] } },
            );
        });
        await openEditor();

        fireEvent.change(cityInput(), { target: { value: 'Dallas' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        const failure = await screen.findByRole('alert');
        expect(failure).toHaveTextContent('The driver changed some of these answers');
        // Still editing, with what was typed: nothing is lost until the admin chooses.
        expect(cityInput()).toHaveValue('Dallas');

        fireEvent.click(within(failure).getByRole('button', { name: /Reload the application/ }));
        await waitFor(() => expect(viewSpy).toHaveBeenCalledTimes(2));
        await screen.findByRole('button', { name: /Edit answers/i });
    });

    it('takes focus into the editor, and gives it back to Edit answers on leaving', async () => {
        await openEditor();

        expect(screen.getByRole('region', { name: 'Edit answers' })).toHaveFocus();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.getByRole('button', { name: /Edit answers/i })).toHaveFocus());
    });

    it('asks before discarding changes, and leaves at once when there are none', async () => {
        await openEditor();

        fireEvent.change(cityInput(), { target: { value: 'Dallas' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(cityInput()).toHaveValue('Dallas');

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }));
        await screen.findByRole('button', { name: /Edit answers/i });
        expect(saveSpy).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /Edit answers/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        await screen.findByRole('button', { name: /Edit answers/i });
    });
});

describe('opened from the list’s Edit answers', () => {
    const openFromList = () => render(
        <UnfinishedApplicationReview companyId="company-1" entry={ENTRY} onExit={vi.fn()} startEditing />,
    );

    it('opens straight into the editor', async () => {
        openFromList();

        expect(await screen.findByRole('button', { name: 'Save changes' })).toBeInTheDocument();
        // The editor takes focus once it has rendered, so wait for that, not for the button.
        await waitFor(() => expect(screen.getByRole('region', { name: 'Edit answers' })).toHaveFocus());
    });

    it('stays read-only where the server says the draft is not the admin’s to edit', async () => {
        viewSpy.mockImplementation(async () => ({ data: view({ editable: false }) }));
        openFromList();

        await screen.findByText('Austin');
        expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Edit answers/i })).toBeNull();
    });

    it('asks once: a reload after the driver’s change comes back read-only', async () => {
        saveSpy.mockImplementation(async () => {
            throw Object.assign(new Error('The driver changed some of these answers.'), {
                code: 'functions/aborted', details: { fields: ['city'] },
            });
        });
        openFromList();
        await screen.findByRole('button', { name: 'Save changes' });

        fireEvent.change(cityInput(), { target: { value: 'Dallas' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: /Reload the application/ }));

        await waitFor(() => expect(viewSpy).toHaveBeenCalledTimes(2));
        await screen.findByRole('button', { name: /Edit answers/i });
        expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    });
});
