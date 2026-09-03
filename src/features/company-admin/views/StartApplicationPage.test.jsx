/**
 * Starting an application: choosing a mode, and switching between drivers.
 *
 * What is pinned here is the flow this page owns — the Manual/AI choice, the AI
 * upload step, and that per-application state (identity, answers, documents, the
 * invite link) never leaks from one driver to the next — plus the two findings the
 * earlier review caught, now under the new flow:
 *
 *  - starting another application must not save one driver's answers under another
 *    driver's key (the email/phone in the answers is the key);
 *  - the invite link, minted for one driver, must not be offered for the next.
 *
 * The children are stood in for; their own suites cover what they render. The
 * mocked editor exposes the few interactions the page reacts to: typing the email
 * (which keys the draft), attaching a document, and removing one.
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
vi.mock('../applicationPrep/ApplicationDocumentsPanel', () => ({
    default: () => <div data-testid="documents-panel" />,
}));
vi.mock('../applicationPrep/ApplicationPrepEditor', () => ({
    default: ({ formData, updateField, onUpload, onFileChange, identityLocked }) => (
        <div data-testid="prep-editor">
            <div data-testid="editor">{JSON.stringify(formData)}</div>
            <div data-testid="identity-locked">{String(Boolean(identityLocked))}</div>
            <input
                data-testid="editor-email"
                value={formData.email || ''}
                onChange={(event) => updateField('email', event.target.value)}
            />
            {/* `attach` does exactly what `UploadField` does: upload, then hand the parent the metadata. */}
            <button
                type="button"
                onClick={async () => {
                    const file = new File(['%PDF-1.4'], 'psp.pdf', { type: 'application/pdf' });
                    onFileChange('psp-report-upload', await onUpload('psp-report-upload', file));
                }}
            >
                attach
            </button>
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
    formData: {
        firstName: 'Dana', lastName: 'Alvarez', email: 'dana@example.test',
        cdlNumber: 'TX1234567', 'psp-report-upload': { name: 'dana-psp.pdf' },
    },
    lockedEmployers: [{ signature: 'dot:123456', companyName: 'Acme Trucking', dotNumber: '123456' }],
};

const SAM = {
    applicantKey: 'key-sam',
    status: 'prepared',
    readable: true,
    firstName: 'Sam',
    lastName: 'Booker',
    email: 'sam@example.test',
    formData: { firstName: 'Sam', lastName: 'Booker', email: 'sam@example.test', cdlNumber: 'OK7654321' },
    lockedEmployers: [],
};

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
                return { data: { inviteToken: 'tok-abc', applicantKey: payload.applicantKey, expiresInDays: 14 } };
            default:
                return { data: {} };
        }
    };
}

const editorFormData = () => JSON.parse(screen.getByTestId('editor').textContent);
const panelProps = () => JSON.parse(screen.getByTestId('ai-panel').textContent);
const savePayload = () => callables.calls.find((entry) => entry.name === 'saveCompanyPreparedApplication')?.payload;

async function openFromList(applicantKey) {
    const row = await screen.findByText(`open ${applicantKey}`);
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByTestId('prep-editor')).toBeInTheDocument());
}

beforeEach(() => {
    callables.calls = [];
    callables.httpsCallable.mockImplementation((_functions, name) => callableFor(name));
});

describe('choosing how to start a new application', () => {
    it('offers the AI and manual choices before anything else', async () => {
        render(<StartApplicationPage />);
        fireEvent.click(await screen.findByRole('button', { name: /Start an application/i }));

        expect(screen.getByTestId('mode-ai')).toBeInTheDocument();
        expect(screen.getByTestId('mode-manual')).toBeInTheDocument();
        // Not the editor yet — the choice comes first.
        expect(screen.queryByTestId('prep-editor')).toBeNull();
    });

    it('manual goes straight to the editor, with no reader', async () => {
        render(<StartApplicationPage />);
        fireEvent.click(await screen.findByRole('button', { name: /Start an application/i }));
        fireEvent.click(screen.getByTestId('mode-manual'));

        expect(screen.getByTestId('prep-editor')).toBeInTheDocument();
        expect(screen.queryByTestId('ai-panel')).toBeNull();
    });

    it('AI goes to the upload step, then on to the editor with the reader', async () => {
        render(<StartApplicationPage />);
        fireEvent.click(await screen.findByRole('button', { name: /Start an application/i }));
        fireEvent.click(screen.getByTestId('mode-ai'));

        // The upload step: documents + the reader, no editor yet.
        expect(screen.getByTestId('documents-panel')).toBeInTheDocument();
        expect(screen.getByTestId('ai-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('prep-editor')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /Continue to review/i }));
        expect(screen.getByTestId('prep-editor')).toBeInTheDocument();
        expect(screen.getByTestId('ai-panel')).toBeInTheDocument();
    });
});

describe('one driver never leaks into the next', () => {
    it("does not offer the previous driver's link for the next driver", async () => {
        render(<StartApplicationPage />);
        await openFromList('key-dana');

        fireEvent.click(screen.getByText('mint'));
        await waitFor(() => expect(screen.getByTestId('invite-link')).toHaveTextContent('k=key-dana'));

        fireEvent.click(screen.getByText('Back to the list'));
        await openFromList('key-sam');

        // Not merely stale display: the action beside it is Copy.
        expect(screen.getByTestId('invite-link')).toHaveTextContent('no link');
    });

    it("replaces the previous driver's answers and documents", async () => {
        render(<StartApplicationPage />);
        await openFromList('key-dana');
        expect(editorFormData().cdlNumber).toBe('TX1234567');

        fireEvent.click(screen.getByText('attach'));
        await waitFor(() => expect(panelProps().blobs).toHaveProperty('psp-report-upload'));

        fireEvent.click(screen.getByText('Back to the list'));
        await openFromList('key-sam');

        expect(editorFormData().cdlNumber).toBe('OK7654321');
        expect(panelProps().blobs).toEqual({});
    });

    it('forgets the bytes when the document is removed', async () => {
        render(<StartApplicationPage />);
        await openFromList('key-dana');

        fireEvent.click(screen.getByText('attach'));
        await waitFor(() => expect(panelProps().blobs).toHaveProperty('psp-report-upload'));

        fireEvent.click(screen.getByText('remove'));
        await waitFor(() => expect(panelProps().blobs).toEqual({}));
    });

    it("saves none of the previous driver's answers under the new key", async () => {
        render(<StartApplicationPage />);
        await openFromList('key-dana');

        fireEvent.click(screen.getByText('Back to the list'));
        fireEvent.click(await screen.findByRole('button', { name: /Start an application/i }));
        fireEvent.click(screen.getByTestId('mode-manual'));

        // The editor is empty; type the new driver's email (which keys the draft).
        expect(editorFormData().cdlNumber).toBeUndefined();
        fireEvent.change(screen.getByTestId('editor-email'), { target: { value: 'new@example.test' } });
        fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

        await waitFor(() => expect(savePayload()).toBeTruthy());
        const saved = savePayload();
        expect(saved.email).toBe('new@example.test');
        // Dana's licence and PSP upload belong to a different key. None of it here.
        expect(saved.formData.cdlNumber).toBeUndefined();
        expect(saved.formData['psp-report-upload']).toBeUndefined();
    });

    it('keeps Save disabled until an email or phone identifies the draft', async () => {
        render(<StartApplicationPage />);
        fireEvent.click(await screen.findByRole('button', { name: /Start an application/i }));
        fireEvent.click(screen.getByTestId('mode-manual'));

        expect(screen.getByRole('button', { name: /^Save$/i })).toBeDisabled();
        fireEvent.change(screen.getByTestId('editor-email'), { target: { value: 'x@example.test' } });
        expect(screen.getByRole('button', { name: /^Save$/i })).toBeEnabled();
    });

    it('locks the identity once a link exists, so a sent link cannot be re-keyed', async () => {
        render(<StartApplicationPage />);

        // A draft already 'sent' (its link is out) opens with identity locked.
        await openFromList('key-dana');
        expect(screen.getByTestId('identity-locked')).toHaveTextContent('true');

        // A merely 'prepared' draft is editable — until a link is minted for it.
        fireEvent.click(screen.getByText('Back to the list'));
        await openFromList('key-sam');
        expect(screen.getByTestId('identity-locked')).toHaveTextContent('false');

        fireEvent.click(screen.getByText('mint'));
        await waitFor(() => expect(screen.getByTestId('identity-locked')).toHaveTextContent('true'));
    });
});
