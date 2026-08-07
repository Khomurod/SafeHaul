/**
 * Contract and security proof for the Super Admin Environment & Integrations
 * vault screen.
 *
 * The properties pinned here are the ones the feature exists to provide, and
 * every one of them is a real regression risk:
 *
 *  - values are masked as `********` and no plaintext exists in the initial DOM;
 *  - a reveal is one request for one key, and revealing one row never reveals
 *    another;
 *  - a revealed value clears after 30 seconds, on a second press, when the tab
 *    is hidden, and on unmount (view change / sign-out);
 *  - nothing is ever written to localStorage, sessionStorage or a data attribute;
 *  - a GitHub Actions secret reports its limitation instead of being hidden;
 *  - unavailable operations stay on screen, stay focusable, and say why;
 *  - a stale session is answered with re-authentication and the action retried;
 *  - deletion requires the exact key typed back.
 *
 * All key names, company names and values below are artificial fixtures.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callables = {};
const httpsCallable = vi.fn((_functions, name) => {
    if (!callables[name]) throw new Error(`Unexpected callable: ${name}`);
    return callables[name];
});

const showSuccess = vi.fn();
const showError = vi.fn();
const showInfo = vi.fn();
const reauthenticateWithCredential = vi.fn();

vi.mock('firebase/functions', () => ({ httpsCallable: (...args) => httpsCallable(...args) }));
vi.mock('@lib/firebase', () => ({
    functions: { __functions: true },
    auth: { currentUser: { email: 'ops@example.test', getIdToken: vi.fn().mockResolvedValue('token') } },
    db: {},
}));
vi.mock('firebase/auth', () => ({
    EmailAuthProvider: { credential: vi.fn(() => ({ __credential: true })) },
    reauthenticateWithCredential: (...args) => reauthenticateWithCredential(...args),
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showSuccess, showError, showInfo }),
}));

import { EnvironmentIntegrationsView } from './EnvironmentIntegrationsView';

// --- fixtures --------------------------------------------------------------

const PROTECTED_REASON = 'Protected infrastructure key';

const permissions = (overrides = {}) => ({
    revealable: true, editable: false, replaceable: false, addable: false, deletable: false, testable: false,
    ...overrides,
});

const restrictions = (overrides = {}) => ({
    edit: PROTECTED_REASON, replace: PROTECTED_REASON,
    add: 'Source does not support adding keys here', delete: 'Source does not support deletion',
    ...overrides,
});

const entry = (over = {}) => ({
    id: over.id,
    key: over.key,
    displayName: over.displayName || `${over.key} display name`,
    category: 'infrastructure-security',
    integration: 'SafeHaul platform',
    scope: 'global',
    source: 'secret-manager',
    sensitivity: 'critical',
    description: 'A registered configuration entry.',
    consumers: ['functions/example.js'],
    availability: 'server-runtime',
    requiresDeployment: true,
    optional: false,
    permissions: permissions(),
    restrictions: restrictions(),
    maskedValue: '********',
    status: 'configured',
    statusResolvedBy: 'server',
    unavailableReason: null,
    companyId: null,
    companyName: null,
    documentPath: null,
    field: null,
    lastUpdated: null,
    updatedBy: null,
    ...over,
});

const ENTRIES = [
    entry({ id: 'secret-manager:ARTIFICIAL_MASTER_KEY', key: 'ARTIFICIAL_MASTER_KEY', displayName: 'Artificial master key' }),
    entry({
        id: 'github-actions-secret:ARTIFICIAL_CI_TOKEN',
        key: 'ARTIFICIAL_CI_TOKEN',
        displayName: 'Artificial CI token',
        category: 'github-actions',
        source: 'github-actions-secret',
        availability: 'not-retrievable',
        status: 'unknown',
        restrictions: restrictions({ edit: 'Source does not support editing', replace: 'Source does not support editing' }),
    }),
    entry({
        id: 'vite-build:VITE_FIREBASE_PROJECT_ID',
        key: 'VITE_FIREBASE_PROJECT_ID',
        displayName: 'Firebase project ID',
        category: 'public-config',
        source: 'vite-build',
        sensitivity: 'public',
        availability: 'browser-visible',
        status: 'unknown',
        statusResolvedBy: 'client-bundle',
        restrictions: restrictions({ edit: 'Managed by deployment', replace: 'Managed by deployment' }),
    }),
    entry({
        id: 'company:co-alpha:sms_provider:clientSecret',
        key: 'clientSecret',
        displayName: 'Provider client secret',
        category: 'company-integration',
        integration: 'SMS provider',
        scope: 'company',
        companyId: 'co-alpha',
        companyName: 'Alpha Test Carrier',
        source: 'firestore-encrypted',
        availability: 'firestore-encrypted',
        requiresDeployment: false,
        permissions: permissions({ editable: true, replaceable: true, deletable: true }),
        restrictions: restrictions({ edit: null, replace: null, delete: null }),
        lastUpdated: Date.parse('2026-05-04T12:00:00Z'),
        updatedBy: 'seed-user',
    }),
    entry({
        id: 'functions-env:ARTIFICIAL_OPTIONAL_URL',
        key: 'ARTIFICIAL_OPTIONAL_URL',
        displayName: 'Artificial optional URL',
        category: 'functions-env',
        source: 'functions-env',
        sensitivity: 'internal',
        status: 'missing',
        permissions: permissions({ revealable: false }),
        restrictions: restrictions({ edit: 'Managed by deployment', replace: 'Managed by deployment' }),
    }),
];

const SECRET_PLAINTEXT = 'artificial-revealed-secret';

function listResponse(over = {}) {
    return { data: { entries: ENTRIES, recentActivity: [], companyError: null, generatedAt: 1, ...over } };
}

function installCallables({ list, reveal, update, remove, add, test } = {}) {
    callables.listEnvironmentAndIntegrations = list || vi.fn().mockResolvedValue(listResponse());
    callables.revealEnvironmentValue = reveal || vi.fn(async ({ entryId }) => ({
        data: {
            entryId,
            availability: 'server-runtime',
            readFrom: 'process-env',
            value: SECRET_PLAINTEXT,
            unavailableReason: null,
        },
    }));
    callables.updateEnvironmentValue = update || vi.fn().mockResolvedValue({ data: { verified: true } });
    callables.deleteEnvironmentValue = remove || vi.fn().mockResolvedValue({ data: { verified: true } });
    callables.addEnvironmentValue = add || vi.fn().mockResolvedValue({ data: { verified: true } });
    callables.testManagedIntegration = test || vi.fn().mockResolvedValue({ data: { success: true, message: 'ok' } });
}

const rowFor = (key) => screen.getByRole('row', { name: new RegExp(key) });

async function renderLoaded(overrides) {
    installCallables(overrides);
    const view = render(<EnvironmentIntegrationsView />);
    await screen.findByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' });
    return view;
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('masking', () => {
    it('renders every value as ******** with no plaintext anywhere in the DOM', async () => {
        await renderLoaded();

        const masked = screen.getAllByText('********');
        expect(masked.length).toBe(ENTRIES.length);
        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);
        expect(document.body.innerHTML).not.toContain(SECRET_PLAINTEXT);
    });

    it('never asks the list callable for a value', async () => {
        await renderLoaded();
        expect(callables.listEnvironmentAndIntegrations).toHaveBeenCalledWith({});
        const payload = JSON.stringify(callables.listEnvironmentAndIntegrations.mock.results[0].value);
        expect(payload).not.toContain(SECRET_PLAINTEXT);
    });

    it('puts nothing in browser storage', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        expect(localStorage.length).toBe(0);
        expect(sessionStorage.length).toBe(0);
        expect(JSON.stringify(localStorage)).not.toContain(SECRET_PLAINTEXT);
        expect(JSON.stringify(sessionStorage)).not.toContain(SECRET_PLAINTEXT);
    });

    it('never writes a revealed value into an attribute', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        for (const element of document.querySelectorAll('*')) {
            for (const attribute of element.attributes) {
                expect(attribute.value).not.toContain(SECRET_PLAINTEXT);
            }
        }
    });
});

describe('reveal', () => {
    it('requests exactly one key and shows it in that row only', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));

        await waitFor(() => {
            expect(callables.revealEnvironmentValue).toHaveBeenCalledTimes(1);
        });
        expect(callables.revealEnvironmentValue).toHaveBeenCalledWith({
            entryId: 'secret-manager:ARTIFICIAL_MASTER_KEY',
        });

        // The call having been MADE is not the call having RESOLVED. Asserting
        // the render here without waiting for the value to land passes on a
        // fast machine and fails on a loaded CI runner, which is exactly what
        // it did. Every other positive assertion in this file already awaits.
        await screen.findByText(SECRET_PLAINTEXT);

        const revealedRow = rowFor('ARTIFICIAL_MASTER_KEY');
        expect(within(revealedRow).getByText(SECRET_PLAINTEXT)).toBeInTheDocument();
        expect(within(rowFor('VITE_FIREBASE_PROJECT_ID')).getByText('********')).toBeInTheDocument();
        expect(screen.getAllByText(SECRET_PLAINTEXT)).toHaveLength(1);
    });

    it('labels the control with the key it acts on, in both states', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        const hide = screen.getByRole('button', { name: 'Hide ARTIFICIAL_MASTER_KEY' });
        expect(hide).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_CI_TOKEN' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('says the value hides automatically', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);
        expect(screen.getByText(/Hides automatically in 30s/)).toBeInTheDocument();
    });

    it('clears the value after 30 seconds', async () => {
        // `shouldAdvanceTime` keeps Testing Library's own async helpers working
        // while still allowing the 30-second window to be jumped deliberately.
        vi.useFakeTimers({ shouldAdvanceTime: true });
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

        expect(screen.queryByText(SECRET_PLAINTEXT)).not.toBeInTheDocument();
        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);
    });

    it('clears the value when the eye is pressed again', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        fireEvent.click(screen.getByRole('button', { name: 'Hide ARTIFICIAL_MASTER_KEY' }));
        await waitFor(() => expect(screen.queryByText(SECRET_PLAINTEXT)).not.toBeInTheDocument());
        // Hiding must not spend another reveal request.
        expect(callables.revealEnvironmentValue).toHaveBeenCalledTimes(1);
    });

    it('clears the value when the tab is hidden', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        fireEvent(document, new Event('visibilitychange'));

        await waitFor(() => expect(screen.queryByText(SECRET_PLAINTEXT)).not.toBeInTheDocument());
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });

    it('clears the value when the view unmounts', async () => {
        const { unmount } = await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        unmount();
        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);
    });

    it('evicts the previous value when a second row is revealed', async () => {
        const reveal = vi.fn(async ({ entryId }) => ({
            data: {
                entryId,
                availability: 'server-runtime',
                readFrom: 'process-env',
                value: entryId.endsWith('ARTIFICIAL_MASTER_KEY') ? SECRET_PLAINTEXT : 'second-artificial-value',
                unavailableReason: null,
            },
        }));
        await renderLoaded({ reveal });

        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        await screen.findByText(SECRET_PLAINTEXT);

        fireEvent.click(screen.getByRole('button', { name: 'Reveal clientSecret' }));
        await screen.findByText('second-artificial-value');

        expect(screen.queryByText(SECRET_PLAINTEXT)).not.toBeInTheDocument();
    });

    it('reports a GitHub Actions secret honestly instead of hiding the row', async () => {
        const reveal = vi.fn(async ({ entryId }) => ({
            data: {
                entryId,
                availability: 'not-retrievable',
                readFrom: 'none',
                value: null,
                unavailableReason: 'The source does not permit reading the saved value.',
            },
        }));
        await renderLoaded({ reveal });

        expect(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_CI_TOKEN' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_CI_TOKEN' }));

        expect(await screen.findByText('The source does not permit reading the saved value.')).toBeInTheDocument();
    });

    it('resolves a build-time browser value from the running bundle', async () => {
        const reveal = vi.fn(async ({ entryId }) => ({
            data: { entryId, availability: 'browser-visible', readFrom: 'client-bundle', value: null, unavailableReason: null },
        }));
        await renderLoaded({ reveal });

        fireEvent.click(screen.getByRole('button', { name: 'Reveal VITE_FIREBASE_PROJECT_ID' }));

        // `src/tests/setup.js` stubs this to the placeholder project id.
        expect(await screen.findByText('vitest-placeholder')).toBeInTheDocument();
    });

    it('disables the eye for an entry with nothing stored', async () => {
        await renderLoaded();
        expect(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_OPTIONAL_URL' })).toBeDisabled();
    });
});

describe('permissions', () => {
    it('keeps unavailable actions on screen, focusable, and explained', async () => {
        await renderLoaded();

        const edit = screen.getByRole('button', {
            name: `Edit ARTIFICIAL_MASTER_KEY — unavailable: ${PROTECTED_REASON}`,
        });
        expect(edit).toBeInTheDocument();
        expect(edit).toHaveAttribute('aria-disabled', 'true');
        // aria-disabled, not disabled: the explanation must stay reachable.
        expect(edit).not.toBeDisabled();
        expect(edit).toHaveAttribute('title', PROTECTED_REASON);

        for (const action of ['Replace', 'Add', 'Delete']) {
            expect(screen.getByRole('button', {
                name: new RegExp(`^${action} ARTIFICIAL_MASTER_KEY — unavailable: `),
            })).toBeInTheDocument();
        }
    });

    it('offers real controls on an editable row', async () => {
        await renderLoaded();
        expect(screen.getByRole('button', { name: 'Edit clientSecret' })).not.toHaveAttribute('aria-disabled');
        expect(screen.getByRole('button', { name: 'Delete clientSecret' })).not.toHaveAttribute('aria-disabled');
    });

    it('summarises the permissions of each row in text, not colour', async () => {
        await renderLoaded();
        const protectedRow = rowFor('ARTIFICIAL_MASTER_KEY');
        expect(within(protectedRow).getByText('Reveal')).toBeInTheDocument();
        expect(within(protectedRow).getByText('No edit')).toBeInTheDocument();
        expect(within(protectedRow).getByText('No delete')).toBeInTheDocument();
    });
});

describe('inventory presentation', () => {
    it('counts total, configured, missing, protected and needs-deployment', async () => {
        await renderLoaded();
        const summary = screen.getByLabelText('Inventory summary');
        expect(within(summary).getByText('Total keys').parentElement).toHaveTextContent('5');
        expect(within(summary).getByText('Missing').parentElement).toHaveTextContent('1');
        // Four of the five fixtures are not editable.
        expect(within(summary).getByText('Protected').parentElement).toHaveTextContent('4');
    });

    it('refines a build-time row status from the bundle rather than the server', async () => {
        await renderLoaded();
        const row = rowFor('VITE_FIREBASE_PROJECT_ID');
        expect(within(row).getByText('Configured')).toBeInTheDocument();
    });

    it('filters by source', async () => {
        await renderLoaded();
        fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'github-actions-secret' } });

        expect(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_CI_TOKEN' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' })).not.toBeInTheDocument();
    });

    it('filters by search text', async () => {
        await renderLoaded();
        fireEvent.change(screen.getByLabelText(/Search keys/), { target: { value: 'client' } });

        expect(screen.getByRole('button', { name: 'Reveal clientSecret' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' })).not.toBeInTheDocument();
    });

    it('shows an empty state that explains the filters', async () => {
        await renderLoaded();
        fireEvent.change(screen.getByLabelText(/Search keys/), { target: { value: 'nothing-matches-this' } });
        expect(screen.getByText('No entries match these filters.')).toBeInTheDocument();
    });

    it('names the real reason when the inventory is denied', async () => {
        // Regression: the Firebase SDK prefixes callable codes with `functions/`,
        // so an inline `=== 'permission-denied'` never matched and a denied
        // Super Admin check was reported as a generic load failure.
        const denied = vi.fn().mockRejectedValue(
            Object.assign(new Error('denied'), { code: 'functions/permission-denied' }),
        );
        installCallables({ list: denied });
        render(<EnvironmentIntegrationsView />);

        expect(await screen.findByText('Super Admin access is required for this action.')).toBeInTheDocument();
    });

    it('shows an error state with a retry that reloads', async () => {
        const failing = vi.fn().mockRejectedValueOnce(new Error('offline'));
        installCallables({ list: failing });
        render(<EnvironmentIntegrationsView />);

        const retry = await screen.findByRole('button', { name: 'Retry' });
        failing.mockResolvedValueOnce(listResponse());
        fireEvent.click(retry);

        await screen.findByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' });
        expect(failing).toHaveBeenCalledTimes(2);
    });

    it('reports a partial company failure without blanking the global inventory', async () => {
        const list = vi.fn().mockResolvedValue(listResponse({
            companyError: 'Company integration credentials could not be listed.',
        }));
        await renderLoaded({ list });
        expect(screen.getByText(/Company integration credentials could not be listed/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' })).toBeInTheDocument();
    });
});

describe('mutations', () => {
    it('opens an empty editor and updates only the selected key', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Edit clientSecret' }));

        const dialog = await screen.findByRole('dialog');
        const input = within(dialog).getByLabelText(/New value/);
        // Never preloaded — that is the whole point.
        expect(input).toHaveValue('');
        expect(within(dialog).getByText('functions/example.js')).toBeInTheDocument();

        fireEvent.change(input, { target: { value: 'a-new-artificial-secret' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Replace value' }));

        await waitFor(() => {
            expect(callables.updateEnvironmentValue).toHaveBeenCalledWith({
                entryId: 'company:co-alpha:sms_provider:clientSecret',
                value: 'a-new-artificial-secret',
            });
        });
        expect(callables.addEnvironmentValue).not.toHaveBeenCalled();
        expect(callables.deleteEnvironmentValue).not.toHaveBeenCalled();
    });

    it('never echoes the new value into a toast', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Edit clientSecret' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/New value/), { target: { value: 'a-new-artificial-secret' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Replace value' }));

        await waitFor(() => expect(showSuccess).toHaveBeenCalled());
        expect(showSuccess.mock.calls.flat().join(' ')).not.toContain('a-new-artificial-secret');
    });

    it('requires the exact key typed back before deleting', async () => {
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Delete clientSecret' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('button', { name: 'Type the key name to continue' })).toBeInTheDocument();

        fireEvent.change(within(dialog).getByLabelText(/Type clientSecret to confirm/), { target: { value: 'clientsecret' } });
        expect(within(dialog).getByRole('button', { name: 'Type the key name to continue' })).toBeInTheDocument();

        fireEvent.change(within(dialog).getByLabelText(/Type clientSecret to confirm/), { target: { value: 'clientSecret' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete clientSecret' }));

        await waitFor(() => {
            expect(callables.deleteEnvironmentValue).toHaveBeenCalledWith({
                entryId: 'company:co-alpha:sms_provider:clientSecret',
                confirmation: 'clientSecret',
            });
        });
    });
});

describe('re-authentication', () => {
    const staleError = Object.assign(new Error('REAUTH_REQUIRED: re-enter your password to continue.'), {
        code: 'functions/failed-precondition',
    });

    it('asks for the password on a stale session and retries the reveal', async () => {
        const reveal = vi.fn()
            .mockRejectedValueOnce(staleError)
            .mockResolvedValueOnce({
                data: {
                    entryId: 'secret-manager:ARTIFICIAL_MASTER_KEY',
                    availability: 'server-runtime',
                    readFrom: 'process-env',
                    value: SECRET_PLAINTEXT,
                    unavailableReason: null,
                },
            });
        reauthenticateWithCredential.mockResolvedValue({});
        await renderLoaded({ reveal });

        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Confirm it is you')).toBeInTheDocument();
        // No value is on screen while the session is stale.
        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);

        fireEvent.change(within(dialog).getByLabelText(/Password/), { target: { value: 'artificial-password' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

        expect(await screen.findByText(SECRET_PLAINTEXT)).toBeInTheDocument();
        expect(reveal).toHaveBeenCalledTimes(2);
    });

    it('keeps the value hidden when re-authentication is cancelled', async () => {
        const reveal = vi.fn().mockRejectedValue(staleError);
        await renderLoaded({ reveal });

        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);
    });

    /**
     * Regression: an earlier version resolved the guarded operation as soon as it
     * opened the prompt, so the edit dialog closed and a success toast fired for
     * a write that had not happened — and would never happen if the operator
     * backed out.
     */
    it('reports nothing and writes nothing when a mutation is cancelled at the prompt', async () => {
        const update = vi.fn().mockRejectedValue(staleError);
        await renderLoaded({ update });

        fireEvent.click(screen.getByRole('button', { name: 'Edit clientSecret' }));
        const editDialog = await screen.findByRole('dialog');
        fireEvent.change(within(editDialog).getByLabelText(/New value/), { target: { value: 'a-new-artificial-secret' } });
        fireEvent.click(within(editDialog).getByRole('button', { name: 'Replace value' }));

        const reauthDialog = await screen.findByText('Confirm it is you');
        fireEvent.click(within(reauthDialog.closest('[role="dialog"]')).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByText('Confirm it is you')).not.toBeInTheDocument());

        // Nothing claimed, nothing written, and the operator's input survives.
        expect(showSuccess).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Replace value' })).toBeInTheDocument();
        expect(screen.getByLabelText(/New value/)).toHaveValue('a-new-artificial-secret');
    });

    it('completes the mutation once, after a successful re-authentication', async () => {
        const update = vi.fn()
            .mockRejectedValueOnce(staleError)
            .mockResolvedValueOnce({ data: { verified: true } });
        reauthenticateWithCredential.mockResolvedValue({});
        await renderLoaded({ update });

        fireEvent.click(screen.getByRole('button', { name: 'Edit clientSecret' }));
        const editDialog = await screen.findByRole('dialog');
        fireEvent.change(within(editDialog).getByLabelText(/New value/), { target: { value: 'a-new-artificial-secret' } });
        fireEvent.click(within(editDialog).getByRole('button', { name: 'Replace value' }));

        const reauthHeading = await screen.findByText('Confirm it is you');
        const reauthDialog = reauthHeading.closest('[role="dialog"]');
        fireEvent.change(within(reauthDialog).getByLabelText(/Password/), { target: { value: 'artificial-password' } });
        fireEvent.click(within(reauthDialog).getByRole('button', { name: 'Continue' }));

        await waitFor(() => expect(showSuccess).toHaveBeenCalled());
        expect(update).toHaveBeenCalledTimes(2);
    });
});

describe('concurrent reveals', () => {
    /**
     * Regression: only the pending row's control is disabled, so a second reveal
     * can start while the first is still in flight. If the first landed last it
     * used to overwrite the second and restart the countdown — a secret the page
     * had already evicted reappearing, attached to the wrong row.
     */
    it('discards a reveal response that a later reveal has superseded', async () => {
        let resolveFirst;
        const reveal = vi.fn()
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockImplementationOnce(async () => ({
                data: {
                    entryId: 'company:co-alpha:sms_provider:clientSecret',
                    availability: 'firestore-encrypted',
                    readFrom: 'firestore',
                    value: 'second-artificial-value',
                    unavailableReason: null,
                },
            }));

        await renderLoaded({ reveal });

        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reveal clientSecret' }));
        await screen.findByText('second-artificial-value');

        // The first request lands late; its value must never reach the screen.
        resolveFirst({
            data: {
                entryId: 'secret-manager:ARTIFICIAL_MASTER_KEY',
                availability: 'server-runtime',
                readFrom: 'process-env',
                value: SECRET_PLAINTEXT,
                unavailableReason: null,
            },
        });
        await waitFor(() => expect(reveal).toHaveBeenCalledTimes(2));

        expect(screen.queryByText(SECRET_PLAINTEXT)).not.toBeInTheDocument();
        expect(screen.getByText('second-artificial-value')).toBeInTheDocument();
        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);
    });

    it('discards a reveal response that arrived after an explicit hide', async () => {
        let resolveFirst;
        const reveal = vi.fn(() => new Promise((resolve) => { resolveFirst = resolve; }));
        await renderLoaded({ reveal });

        fireEvent.click(screen.getByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' }));

        // Hiding the tab evicts everything, including anything still in flight.
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        fireEvent(document, new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });

        resolveFirst({
            data: {
                entryId: 'secret-manager:ARTIFICIAL_MASTER_KEY',
                availability: 'server-runtime',
                readFrom: 'process-env',
                value: SECRET_PLAINTEXT,
                unavailableReason: null,
            },
        });
        await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1));

        expect(document.body.textContent).not.toContain(SECRET_PLAINTEXT);
    });
});
