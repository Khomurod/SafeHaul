/**
 * Starting an application from the unified workspace, and switching between drivers.
 *
 * Retargeted on 2026-09-10 from `StartApplicationPage`, which no longer exists as
 * a screen: starting an application is the primary action inside
 * `UnfinishedApplicationsPage`, and the wizard itself moved to
 * `ApplicationPrepWorkspace`. These cases deliberately still drive the whole
 * company flow through the page rather than the extracted component — the flow is
 * what a recruiter performs, and the split is an internal one.
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
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => null }));
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

vi.mock('../applicationPrep/UnfinishedWorklistTable', () => ({
    default: ({ rows, onOpen }) => (
        <div>
            {rows.map((row) => (
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

import UnfinishedApplicationsPage from './UnfinishedApplicationsPage';

const DANA = {
    origin: 'company',
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
    origin: 'company',
    applicantKey: 'key-sam',
    status: 'prepared',
    readable: true,
    firstName: 'Sam',
    lastName: 'Booker',
    email: 'sam@example.test',
    formData: { firstName: 'Sam', lastName: 'Booker', email: 'sam@example.test', cdlNumber: 'OK7654321' },
    lockedEmployers: [],
};

/**
 * The carrier prepared it and the driver has since written to it.
 *
 * `getCompanyPreparedDraft` answers `readable: false` with no `formData`, because
 * `companyMayReadAnswers` no longer holds. What the screen must do with that is
 * SAY so — a blank form with no explanation reads as "nothing was filled in".
 */
const TAKEN_OVER = {
    origin: 'company',
    applicantKey: 'key-taken',
    status: 'driver_in_progress',
    readable: false,
    firstName: 'Priya',
    lastName: 'Raman',
    email: 'priya@example.test',
    formData: null,
    lockedEmployers: [],
};

function callableFor(name) {
    return async (payload) => {
        callables.calls.push({ name, payload });
        switch (name) {
            // The one list the workspace reads. A carrier-prepared draft is one
            // row here because it is one document — see `functions/drafts/list.js`.
            case 'listApplicationDrafts':
                return { data: { drafts: [DANA, SAM, TAKEN_OVER], retentionDays: 30 } };
            case 'getCompanyPreparedDraft': {
                const byKey = { 'key-sam': SAM, 'key-taken': TAKEN_OVER };
                return { data: byKey[payload.applicantKey] || DANA };
            }
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

/** Open a row that will come back unreadable, so there is no editor to wait on. */
async function openTakenOver() {
    fireEvent.click(await screen.findByText('open key-taken'));
}

beforeEach(() => {
    callables.calls = [];
    callables.httpsCallable.mockImplementation((_functions, name) => callableFor(name));
});

describe('choosing how to start a new application', () => {
    it('offers the AI and manual choices before anything else', async () => {
        render(<UnfinishedApplicationsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /Start an application/i }));

        expect(screen.getByTestId('mode-ai')).toBeInTheDocument();
        expect(screen.getByTestId('mode-manual')).toBeInTheDocument();
        // Not the editor yet — the choice comes first.
        expect(screen.queryByTestId('prep-editor')).toBeNull();
    });

    it('manual goes straight to the editor, with no reader', async () => {
        render(<UnfinishedApplicationsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /Start an application/i }));
        fireEvent.click(screen.getByTestId('mode-manual'));

        expect(screen.getByTestId('prep-editor')).toBeInTheDocument();
        expect(screen.queryByTestId('ai-panel')).toBeNull();
    });

    it('AI goes to the upload step, then on to the editor with the reader', async () => {
        render(<UnfinishedApplicationsPage />);
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

describe('a prepared application the driver has taken over', () => {
    it('says why the fields are empty instead of showing a blank form', async () => {
        // The server withholds the answers (`companyMayReadAnswers`), and the
        // recruiter has to be told that rather than shown an empty editor — which
        // reads as "nothing was filled in" about work they did themselves.
        render(<UnfinishedApplicationsPage />);
        await openTakenOver();

        expect(await screen.findByText(/their answers are theirs now/i)).toBeInTheDocument();
        // And no editor at all, rather than one bound to `formData: null`.
        expect(screen.queryByTestId('prep-editor')).toBeNull();
        expect(screen.queryByTestId('ai-panel')).toBeNull();
    });

    /**
     * The same thing again, under `StrictMode` — which is what `main.jsx` actually
     * renders the app inside.
     *
     * React replays an effect's setup/cleanup/setup in development, and a mount
     * flag written only in the cleanup is therefore left `false` forever: the load
     * resolves, the staleness guard rejects it, and the notice never appears. The
     * plain-render case above passes throughout, so this is the case that has to
     * exist — it is the one the recruiter actually meets in a dev build, and it is
     * the SECOND guard in this effect to fail this way (the first cancelled its own
     * in-flight load). Found in review on 2026-09-10.
     */
    it('says it under StrictMode too, which is how the app is really rendered', async () => {
        render(
            <React.StrictMode>
                <UnfinishedApplicationsPage />
            </React.StrictMode>,
        );
        fireEvent.click(await screen.findByText('open key-taken'));

        expect(await screen.findByText(/their answers are theirs now/i)).toBeInTheDocument();
        expect(screen.queryByTestId('prep-editor')).toBeNull();
    });

    it('still offers the link panel, because they may have lost their link', async () => {
        render(<UnfinishedApplicationsPage />);
        await openTakenOver();

        await screen.findByText(/their answers are theirs now/i);
        // Safe because the boundary is enforced server-side: after takeover the
        // exchange returns no answers and no resume token.
        expect(screen.getByTestId('invite-link')).toBeInTheDocument();
    });
});

describe('a row that will not open', () => {
    it('says what went wrong instead of offering an empty form', async () => {
        // The old screen returned early and rendered `prep.error` nowhere, so the
        // press did nothing at all. Falling through to the editor would be the
        // other wrong answer: an editable form for a record this instance never
        // loaded.
        callables.httpsCallable.mockImplementation((_functions, name) => async (payload) => {
            callables.calls.push({ name, payload });
            if (name === 'getCompanyPreparedDraft') {
                throw Object.assign(new Error('nope'), { code: 'functions/unavailable' });
            }
            return callableFor(name)(payload);
        });
        render(<UnfinishedApplicationsPage />);
        fireEvent.click(await screen.findByText('open key-dana'));

        await waitFor(() => expect(screen.queryByTestId('prep-editor')).toBeNull());
        expect(screen.getByText(/Back to unfinished applications/)).toBeInTheDocument();
        // And no link panel for a record it could not read.
        expect(screen.queryByTestId('invite-link')).toBeNull();
    });

    it('says it under StrictMode too, where the guard used to swallow it', async () => {
        // The other half of the same defect: a discarded continuation skips
        // `setLoadFailed` as readily as it skips the ownership notice, so the
        // failed open would fall back to an editable form for a record it never
        // read — in development builds only.
        callables.httpsCallable.mockImplementation((_functions, name) => async (payload) => {
            callables.calls.push({ name, payload });
            if (name === 'getCompanyPreparedDraft') {
                throw Object.assign(new Error('nope'), { code: 'functions/unavailable' });
            }
            return callableFor(name)(payload);
        });
        render(
            <React.StrictMode>
                <UnfinishedApplicationsPage />
            </React.StrictMode>,
        );
        fireEvent.click(await screen.findByText('open key-dana'));

        await waitFor(() => expect(screen.queryByTestId('prep-editor')).toBeNull());
        expect(screen.queryByTestId('invite-link')).toBeNull();
    });
});

describe('one driver never leaks into the next', () => {
    it("does not offer the previous driver's link for the next driver", async () => {
        render(<UnfinishedApplicationsPage />);
        await openFromList('key-dana');

        fireEvent.click(screen.getByText('mint'));
        await waitFor(() => expect(screen.getByTestId('invite-link')).toHaveTextContent('k=key-dana'));

        fireEvent.click(screen.getByText(/Back to unfinished applications/));
        await openFromList('key-sam');

        // Not merely stale display: the action beside it is Copy.
        expect(screen.getByTestId('invite-link')).toHaveTextContent('no link');
    });

    it("replaces the previous driver's answers and documents", async () => {
        render(<UnfinishedApplicationsPage />);
        await openFromList('key-dana');
        expect(editorFormData().cdlNumber).toBe('TX1234567');

        fireEvent.click(screen.getByText('attach'));
        await waitFor(() => expect(panelProps().blobs).toHaveProperty('psp-report-upload'));

        fireEvent.click(screen.getByText(/Back to unfinished applications/));
        await openFromList('key-sam');

        expect(editorFormData().cdlNumber).toBe('OK7654321');
        expect(panelProps().blobs).toEqual({});
    });

    it('forgets the bytes when the document is removed', async () => {
        render(<UnfinishedApplicationsPage />);
        await openFromList('key-dana');

        fireEvent.click(screen.getByText('attach'));
        await waitFor(() => expect(panelProps().blobs).toHaveProperty('psp-report-upload'));

        fireEvent.click(screen.getByText('remove'));
        await waitFor(() => expect(panelProps().blobs).toEqual({}));
    });

    it("saves none of the previous driver's answers under the new key", async () => {
        render(<UnfinishedApplicationsPage />);
        await openFromList('key-dana');

        fireEvent.click(screen.getByText(/Back to unfinished applications/));
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

    it('lets Save be pressed with nothing entered, and says what it needs', async () => {
        // This used to assert the opposite: Save was `disabled` until an email or
        // phone existed, and nothing on the screen said so. The precise sentence
        // was already written on the server and was unreachable, because the
        // client guard stopped the request ever being made. Changed 2026-09-08 —
        // `UnfinishedApplicationsPage.prepActions.contract.test.jsx` drives the same rule
        // through the real editor and the real fields.
        render(<UnfinishedApplicationsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /Start an application/i }));
        fireEvent.click(screen.getByTestId('mode-manual'));

        const save = screen.getByRole('button', { name: /^Save$/i });
        expect(save).toBeEnabled();

        fireEvent.click(save);

        expect(await screen.findByRole('alert')).toHaveTextContent(/email address or mobile number/i);
        // And nothing was sent: clickable is not a licence to save an application
        // with no identity.
        expect(callables.calls.some((entry) => entry.name === 'saveCompanyPreparedApplication')).toBe(false);

        fireEvent.change(screen.getByTestId('editor-email'), { target: { value: 'x@example.test' } });
        fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

        await waitFor(() => expect(
            callables.calls.some((entry) => entry.name === 'saveCompanyPreparedApplication'),
        ).toBe(true));
    });

    it('locks the identity once a link exists, so a sent link cannot be re-keyed', async () => {
        render(<UnfinishedApplicationsPage />);

        // A draft already 'sent' (its link is out) opens with identity locked.
        await openFromList('key-dana');
        expect(screen.getByTestId('identity-locked')).toHaveTextContent('true');

        // A merely 'prepared' draft is editable — until a link is minted for it.
        fireEvent.click(screen.getByText(/Back to unfinished applications/));
        await openFromList('key-sam');
        expect(screen.getByTestId('identity-locked')).toHaveTextContent('false');

        fireEvent.click(screen.getByText('mint'));
        await waitFor(() => expect(screen.getByTestId('identity-locked')).toHaveTextContent('true'));
    });
});
