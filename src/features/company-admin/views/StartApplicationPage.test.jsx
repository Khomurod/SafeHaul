/**
 * Starting a second application, and opening a different one.
 *
 * Two findings from the review on 2026-09-03, both of which are about the page's
 * own state rather than any callable:
 *
 *  - "Start an application" changed the view and nothing else. The hook still held
 *    the previous driver's identity, answers, uploaded documents and locks — and
 *    the identity is what keys the draft, so the next save filed one driver's
 *    answers under another driver's key.
 *  - the invite link is independent of the loaded draft, so after minting a link
 *    for one driver and opening another from the list, the previous driver's
 *    bearer URL was still on screen with the primary Copy button beside it.
 *
 * The children are stood in for: their own suites cover what they render, and what
 * is pinned here is what this page hands them.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callables = vi.hoisted(() => ({ httpsCallable: vi.fn(), calls: [] }));

vi.mock('firebase/functions', () => ({ httpsCallable: callables.httpsCallable }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'co-1', appSlug: 'blue-line' } }),
}));
vi.mock('@features/driver-app/hooks/useGuestFileUpload', () => ({
    // What a real upload returns: metadata, never the bytes. Keeping the bytes is
    // the page's job, and the reader cannot work without them.
    useGuestFileUpload: () => ({
        handleFileUpload: async (field, file) => ({
            name: file.name,
            url: `https://signed.example/${file.name}`,
            storagePath: `companies/co-1/applications/${field}/${file.name}`,
        }),
        isUploading: false,
    }),
}));

vi.mock('../applicationPrep/PreparedApplicationsTable', () => ({
    default: ({ applications, onOpen }) => (
        <div>
            {applications.map((row) => (
                <button key={row.applicantKey} type="button" onClick={() => onOpen(row)}>
                    {`open ${row.applicantKey}`}
                </button>
            ))}
        </div>
    ),
}));
vi.mock('../applicationPrep/ApplicationPrepEditor', () => ({
    // `attach` does exactly what `UploadField` does: upload, then hand the parent
    // the metadata the upload returned.
    default: ({ formData, onUpload, onFileChange }) => (
        <div>
            <div data-testid="editor">{JSON.stringify(formData)}</div>
            <button
                type="button"
                onClick={async () => {
                    const file = new File(['%PDF-1.4'], 'psp.pdf', { type: 'application/pdf' });
                    onFileChange('psp-report-upload', await onUpload('psp-report-upload', file));
                }}
            >
                attach
            </button>
            {/* `UploadField` reports a removal as `onChange(name, null)`. */}
            <button type="button" onClick={() => onFileChange('psp-report-upload', null)}>remove</button>
        </div>
    ),
}));
vi.mock('../applicationPrep/ApplicationAiPrepPanel', () => ({
    default: ({ files, blobs }) => <div data-testid="ai-panel">{JSON.stringify({ files, blobs })}</div>,
}));
vi.mock('../applicationPrep/InviteLinkPanel', () => ({
    default: ({ link, onMint }) => (
        <div>
            <span data-testid="invite-link">{link?.url || 'no link'}</span>
            <button type="button" onClick={onMint}>mint</button>
        </div>
    ),
}));

import StartApplicationPage from './StartApplicationPage';

const DANA = {
    applicantKey: 'key-dana',
    status: 'sent',
    readable: true,
    firstName: 'Dana',
    lastName: 'Alvarez',
    email: 'dana@example.test',
    phone: '2145550147',
    formData: { cdlNumber: 'TX1234567', 'psp-report-upload': { name: 'dana-psp.pdf' } },
    lockedEmployers: [{ signature: 'dot:123456', companyName: 'Acme Trucking', dotNumber: '123456' }],
};

const SAM = {
    applicantKey: 'key-sam',
    status: 'prepared',
    readable: true,
    firstName: 'Sam',
    lastName: 'Booker',
    email: 'sam@example.test',
    phone: '2145550188',
    formData: { cdlNumber: 'OK7654321' },
    lockedEmployers: [],
};

/** One double for every callable, dispatching on the name it was made with. */
function callableFor(name) {
    return async (payload) => {
        callables.calls.push({ name, payload });
        switch (name) {
            case 'listCompanyPreparedApplications':
                return { data: { applications: [DANA, SAM] } };
            case 'getCompanyPreparedDraft':
                return { data: payload.applicantKey === 'key-sam' ? SAM : DANA };
            case 'saveCompanyPreparedApplication':
                return { data: { applicantKey: 'key-new', lockedEmployers: [] } };
            case 'mintApplicationInvite':
                return { data: { inviteToken: 'tok-abc', applicantKey: 'key-dana', expiresInDays: 14 } };
            default:
                return { data: {} };
        }
    };
}

function editorFormData() {
    return JSON.parse(screen.getByTestId('editor').textContent);
}

function panelProps() {
    return JSON.parse(screen.getByTestId('ai-panel').textContent);
}

async function openFromList(applicantKey) {
    // The list arrives from a callable, so the row is not there on first paint.
    const row = await screen.findByText(`open ${applicantKey}`);
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());
}

beforeEach(() => {
    callables.calls = [];
    callables.httpsCallable.mockImplementation((_functions, name) => callableFor(name));
});

describe('opening one prepared application after another', () => {
    it("does not offer the previous driver's link for the next driver", async () => {
        render(<StartApplicationPage />);
        await openFromList('key-dana');

        fireEvent.click(screen.getByText('mint'));
        await waitFor(() => expect(screen.getByTestId('invite-link')).toHaveTextContent('k=key-dana'));

        fireEvent.click(screen.getByText('Back to the list'));
        await openFromList('key-sam');

        // Not merely a stale display: the primary action beside it is Copy.
        expect(screen.getByTestId('invite-link')).toHaveTextContent('no link');
    });

    it("replaces the previous driver's answers and documents", async () => {
        render(<StartApplicationPage />);
        await openFromList('key-dana');
        expect(editorFormData().cdlNumber).toBe('TX1234567');

        // Attaching keeps the bytes as well as the metadata — the reader needs
        // them, and an upload leaves only `{name, url, storagePath}` behind.
        fireEvent.click(screen.getByText('attach'));
        await waitFor(() => expect(panelProps().blobs).toHaveProperty('psp-report-upload'));
        expect(panelProps().files['psp-report-upload'].storagePath).toContain('psp.pdf');

        fireEvent.click(screen.getByText('Back to the list'));
        await openFromList('key-sam');

        expect(editorFormData().cdlNumber).toBe('OK7654321');
        // Those bytes were Dana's document. Sam's application holds none of them.
        expect(panelProps().blobs).toEqual({});
    });

    it('forgets the bytes when the document is removed', async () => {
        render(<StartApplicationPage />);
        await openFromList('key-dana');

        fireEvent.click(screen.getByText('attach'));
        await waitFor(() => expect(panelProps().blobs).toHaveProperty('psp-report-upload'));

        fireEvent.click(screen.getByText('remove'));

        // Otherwise the reader would read a document the application no longer
        // holds, and fill the form from a file the driver will never see.
        await waitFor(() => expect(panelProps().blobs).toEqual({}));
        expect(panelProps().files['psp-report-upload']).toBeNull();
    });
});

describe('starting a second application', () => {
    it('asks who it is for with nothing filled in', async () => {
        render(<StartApplicationPage />);
        await openFromList('key-dana');

        fireEvent.click(screen.getByText('Back to the list'));
        fireEvent.click(screen.getByRole('button', { name: /Start an application/i }));

        expect(screen.getByLabelText(/First name/i)).toHaveValue('');
        expect(screen.getByLabelText(/^Email/i)).toHaveValue('');
        expect(screen.getByLabelText(/^Phone/i)).toHaveValue('');
    });

    it("saves none of the previous driver's answers under the new key", async () => {
        render(<StartApplicationPage />);
        await openFromList('key-dana');

        fireEvent.click(screen.getByText('Back to the list'));
        fireEvent.click(screen.getByRole('button', { name: /Start an application/i }));
        fireEvent.change(screen.getByLabelText(/^Email/i), { target: { value: 'new@example.test' } });
        fireEvent.change(screen.getByLabelText(/^Phone/i), { target: { value: '2145550199' } });
        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

        await waitFor(() => expect(
            callables.calls.some((entry) => entry.name === 'saveCompanyPreparedApplication'),
        ).toBe(true));

        const saved = callables.calls.find((entry) => entry.name === 'saveCompanyPreparedApplication').payload;
        expect(saved.email).toBe('new@example.test');
        // Dana's licence, Dana's PSP upload and Dana's locked carrier. None of it
        // belongs to this application, and the email above is what keys the draft.
        expect(saved.formData.cdlNumber).toBeUndefined();
        expect(saved.formData['psp-report-upload']).toBeUndefined();
        expect(saved.formData.firstName).toBe('');
        expect(saved.lockedEmployers).toEqual([]);
    });
});
