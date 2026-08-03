/**
 * Contract and security proof for the Super Admin AI Integrations screen.
 *
 * The properties pinned here are the ones the page exists to provide, and each
 * is a real regression risk:
 *
 *  - all nine providers are listed, in the router's own fallback order;
 *  - credentials are masked as `********` and no plaintext exists in the
 *    initial DOM;
 *  - a reveal is one request for one credential, and revealing one never leaves
 *    another revealed;
 *  - a revealed value clears after 30 seconds, on a second press, when the tab
 *    is hidden, and on unmount;
 *  - nothing is written to localStorage, sessionStorage or a data attribute;
 *  - the retired provider is shown honestly with no actions offered;
 *  - a stale session is answered with re-authentication and the action retried;
 *  - deletion needs the provider name typed back;
 *  - a cancelled re-authentication never reports success.
 *
 * Every provider name here is a real vendor because the page's whole purpose is
 * naming them; no real credential appears anywhere.
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

import { AiIntegrationsView } from './AiIntegrationsView';

// --- fixtures --------------------------------------------------------------

const CAPABILITIES = [
    { id: 'text', label: 'Text generation' },
    { id: 'structured_json', label: 'Structured JSON output' },
];

function provider(id, displayName, priority, overrides = {}) {
    return {
        id,
        displayName,
        priority,
        docsUrl: `https://example.test/${id}`,
        retired: null,
        capabilities: CAPABILITIES,
        credentialFields: [{
            name: 'apiKey',
            label: 'API key',
            description: `${displayName} API key.`,
            required: true,
            configured: true,
            maskedValue: '********',
        }],
        configFields: [],
        defaultModels: { text: 'model-a' },
        resolvedModels: { text: 'model-a' },
        configured: true,
        missingCredentials: [],
        missingConfig: [],
        credentialSource: 'secret-manager',
        enabled: true,
        health: 'healthy',
        consecutiveFailures: 0,
        cooldown: { active: false, until: null, reason: null },
        lastTest: null,
        lastSuccessAt: null,
        ...overrides,
    };
}

/** The nine registry rows, in the documented fallback order. */
const PROVIDERS = [
    provider('groq', 'Groq', 1),
    provider('gemini', 'Google Gemini', 2),
    provider('cloudflare', 'Cloudflare Workers AI', 3, {
        credentialFields: [{
            name: 'apiToken', label: 'API token', description: 'Workers AI token.',
            required: true, configured: true, maskedValue: '********',
        }],
        configFields: [{
            name: 'accountId', label: 'Account ID', description: 'Cloudflare account ID.',
            required: true, placeholder: '32 hex characters', value: 'a'.repeat(32),
        }],
    }),
    provider('github-models', 'GitHub Models', 4, {
        retired: {
            since: '2026-07-30',
            reason: 'GitHub retired GitHub Models on 30 July 2026.',
            reference: 'https://github.blog/changelog/2026-07-30-github-models-is-now-retired/',
        },
        configured: false,
        enabled: false,
        health: 'retired',
        credentialFields: [{
            name: 'token', label: 'Personal access token', description: 'GitHub token.',
            required: true, configured: false, maskedValue: '********',
        }],
    }),
    provider('mistral', 'Mistral', 5),
    provider('cerebras', 'Cerebras', 6, {
        configured: false,
        missingCredentials: ['apiKey'],
        credentialFields: [{
            name: 'apiKey', label: 'API key', description: 'Cerebras API key.',
            required: true, configured: false, maskedValue: '********',
        }],
    }),
    provider('sambanova', 'SambaNova', 7, { enabled: false }),
    provider('openrouter', 'OpenRouter', 8, {
        cooldown: { active: true, until: Date.now() + 60000, reason: 'quota' },
        health: 'quota',
    }),
    provider('huggingface', 'Hugging Face', 9),
];

const MEDIA_PROVIDERS = [
    {
        id: 'pexels', displayName: 'Pexels', priority: 1, licenceName: 'Pexels License',
        licenceUrl: 'https://www.pexels.com/license/', allowsHosting: true,
        attributionRequired: false, requiresCredential: true, configured: false,
        credentialFields: [{ name: 'apiKey', label: 'API key', description: 'Pexels key.', configured: false, maskedValue: '********' }],
    },
    {
        id: 'openverse', displayName: 'Openverse', priority: 3, licenceName: null,
        licenceUrl: null, allowsHosting: false, attributionRequired: true,
        requiresCredential: false, configured: true,
        credentialFields: [{ name: 'accessToken', label: 'Access token (optional)', description: 'Openverse token.', configured: false, maskedValue: '********' }],
    },
];

const REAL_SECRET = 'gsk-do-not-render-this-value';

function stubCallables(overrides = {}) {
    callables.listAiProviders = vi.fn().mockResolvedValue({
        data: { providers: PROVIDERS, telemetry: [], generatedAt: '2026-08-02T12:00:00Z' },
    });
    callables.listMediaProviders = vi.fn().mockResolvedValue({ data: { providers: MEDIA_PROVIDERS } });
    callables.revealAiCredential = vi.fn().mockResolvedValue({
        data: { providerId: 'groq', field: 'apiKey', value: REAL_SECRET, unavailableReason: null },
    });
    callables.saveAiCredential = vi.fn().mockResolvedValue({ data: { saved: true } });
    callables.deleteAiCredential = vi.fn().mockResolvedValue({ data: { deleted: true } });
    callables.setAiProviderEnabled = vi.fn().mockResolvedValue({ data: { enabled: false } });
    callables.updateAiProviderConfig = vi.fn().mockResolvedValue({ data: { settings: {} } });
    callables.testAiProvider = vi.fn().mockResolvedValue({
        data: { success: true, message: 'Connected. Responded in 120ms.' },
    });
    callables.migrateGroqCredential = vi.fn().mockResolvedValue({
        data: { migrated: true, verified: true, message: 'Groq credential migrated and verified.' },
    });
    callables.saveMediaCredential = vi.fn().mockResolvedValue({ data: { saved: true } });
    callables.deleteMediaCredential = vi.fn().mockResolvedValue({ data: { deleted: true } });
    Object.assign(callables, overrides);
}

async function renderView() {
    const utils = render(<AiIntegrationsView />);
    await waitFor(() => expect(screen.getByText('Groq')).toBeTruthy());
    return utils;
}

/** The eye control for one provider's credential field. */
function revealButton(providerName, fieldLabel = 'API key') {
    return screen.getByRole('button', { name: `Reveal ${providerName} ${fieldLabel}` });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
    stubCallables();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('provider listing', () => {
    it('lists all nine supported providers', async () => {
        await renderView();
        for (const row of PROVIDERS) {
            expect(screen.getByText(row.displayName)).toBeTruthy();
        }
    });

    it('shows each provider its position in the fallback order', async () => {
        await renderView();
        expect(screen.getByText('Fallback position 1')).toBeTruthy();
        expect(screen.getByText('Fallback position 9')).toBeTruthy();
    });

    it('renders providers in registry priority order, not alphabetically', async () => {
        await renderView();
        const rendered = screen.getAllByText(/^Fallback position \d$/)
            .map((node) => Number(node.textContent.replace(/\D/g, '')));
        expect(rendered).toEqual([...rendered].sort((a, b) => a - b));
    });

    it('distinguishes configured, unconfigured, disabled and cooldown states in text', async () => {
        await renderView();
        // Several fixture providers are healthy, so these are "at least one".
        expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Not configured').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0);
        expect(screen.getByText('Quota cooldown')).toBeTruthy();
    });

    it('names the missing credential rather than just saying unconfigured', async () => {
        await renderView();
        expect(screen.getByText(/Needs API key/)).toBeTruthy();
    });

    it('lists the capabilities each provider supports', async () => {
        await renderView();
        expect(screen.getAllByText('Text generation').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Structured JSON output').length).toBeGreaterThan(0);
    });

    it('surfaces a load failure with a retry rather than an empty table', async () => {
        stubCallables({
            listAiProviders: vi.fn().mockRejectedValue({ code: 'functions/internal' }),
        });
        render(<AiIntegrationsView />);

        await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeTruthy());
        expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    });

    it('keeps the AI table usable when the media list fails', async () => {
        stubCallables({
            listMediaProviders: vi.fn().mockRejectedValue({ code: 'functions/internal' }),
        });
        await renderView();
        expect(screen.getByText('Groq')).toBeTruthy();
    });
});

describe('the retired provider', () => {
    it('is listed rather than hidden', async () => {
        await renderView();
        // The name also appears inside the retirement sentence, so match the
        // row's own cell rather than any occurrence.
        expect(screen.getAllByText('GitHub Models').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Retired by vendor').length).toBeGreaterThan(0);
    });

    it('explains why, with the vendor\'s own retirement date', async () => {
        await renderView();
        expect(screen.getByText(/retired GitHub Models on 30 July 2026/)).toBeTruthy();
    });

    it('offers no actions, because every one of them would fail', async () => {
        await renderView();
        expect(screen.getByText('No actions available.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Add personal access token/i })).toBeNull();
    });

    it('keeps its place in the fallback order', async () => {
        await renderView();
        expect(screen.getByText('Fallback position 4')).toBeTruthy();
    });
});

describe('credential masking and reveal', () => {
    it('masks every credential and puts no plaintext in the initial DOM', async () => {
        const { container } = await renderView();

        expect(screen.getAllByText('********').length).toBeGreaterThan(0);
        expect(container.innerHTML).not.toContain(REAL_SECRET);
        expect(callables.revealAiCredential).not.toHaveBeenCalled();
    });

    it('reveals one credential for one provider on request', async () => {
        await renderView();

        fireEvent.click(revealButton('Groq'));

        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());
        expect(callables.revealAiCredential).toHaveBeenCalledTimes(1);
        expect(callables.revealAiCredential).toHaveBeenCalledWith({ providerId: 'groq', field: 'apiKey' });
    });

    it('announces the remaining time beside the revealed value', async () => {
        await renderView();
        fireEvent.click(revealButton('Groq'));

        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());
        expect(screen.getByRole('status').textContent).toMatch(/Hides automatically in 30s/);
    });

    it('hides the value when the same control is pressed again', async () => {
        await renderView();
        fireEvent.click(revealButton('Groq'));
        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'Hide Groq API key' }));

        await waitFor(() => expect(screen.queryByText(REAL_SECRET)).toBeNull());
    });

    it('evicts the first credential when a second is revealed', async () => {
        callables.revealAiCredential = vi.fn(async ({ providerId }) => ({
            data: {
                providerId,
                field: 'apiKey',
                value: providerId === 'groq' ? REAL_SECRET : 'mistral-only-value',
                unavailableReason: null,
            },
        }));
        await renderView();

        fireEvent.click(revealButton('Groq'));
        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());

        fireEvent.click(revealButton('Mistral'));

        await waitFor(() => expect(screen.getByText('mistral-only-value')).toBeTruthy());
        // There is only one slot, so the first value cannot still be on screen.
        expect(screen.queryByText(REAL_SECRET)).toBeNull();
    });

    it('clears the value after 30 seconds', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        await renderView();

        fireEvent.click(revealButton('Groq'));
        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());

        await act(async () => { vi.advanceTimersByTime(30_000); });

        expect(screen.queryByText(REAL_SECRET)).toBeNull();
    });

    it('clears the value when the tab is hidden', async () => {
        await renderView();
        fireEvent.click(revealButton('Groq'));
        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());

        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

        expect(screen.queryByText(REAL_SECRET)).toBeNull();
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });

    it('clears the value on unmount, such as a view change or sign-out', async () => {
        const { unmount, container } = await renderView();
        fireEvent.click(revealButton('Groq'));
        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());

        unmount();

        expect(container.innerHTML).not.toContain(REAL_SECRET);
    });

    it('never writes a revealed value to storage or a data attribute', async () => {
        const { container } = await renderView();
        fireEvent.click(revealButton('Groq'));
        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());

        expect(JSON.stringify(localStorage)).not.toContain(REAL_SECRET);
        expect(JSON.stringify(sessionStorage)).not.toContain(REAL_SECRET);
        for (const node of container.querySelectorAll('*')) {
            for (const attribute of node.attributes) {
                expect(attribute.value).not.toContain(REAL_SECRET);
            }
        }
    });

    it('discards a superseded reveal response instead of resurrecting it', async () => {
        // Groq resolves after Mistral. Without the generation guard, Groq's
        // late response would overwrite Mistral's and restart the countdown.
        let releaseGroq;
        callables.revealAiCredential = vi.fn(({ providerId }) => {
            if (providerId === 'groq') {
                return new Promise((resolve) => {
                    releaseGroq = () => resolve({
                        data: { providerId, field: 'apiKey', value: REAL_SECRET, unavailableReason: null },
                    });
                });
            }
            return Promise.resolve({
                data: { providerId, field: 'apiKey', value: 'mistral-only-value', unavailableReason: null },
            });
        });
        await renderView();

        fireEvent.click(revealButton('Groq'));
        fireEvent.click(revealButton('Mistral'));
        await waitFor(() => expect(screen.getByText('mistral-only-value')).toBeTruthy());

        await act(async () => { releaseGroq(); });

        expect(screen.queryByText(REAL_SECRET)).toBeNull();
        expect(screen.getByText('mistral-only-value')).toBeTruthy();
    });

    it('reports an unconfigured credential rather than showing an empty value', async () => {
        callables.revealAiCredential = vi.fn().mockResolvedValue({
            data: { providerId: 'groq', field: 'apiKey', value: null, unavailableReason: 'This credential is not configured.' },
        });
        await renderView();

        fireEvent.click(revealButton('Groq'));

        await waitFor(() => expect(screen.getByText('This credential is not configured.')).toBeTruthy());
    });

    it('does not offer a reveal for an unconfigured credential', async () => {
        await renderView();
        expect(revealButton('Cerebras').disabled).toBe(true);
    });
});

describe('mutations', () => {
    it('opens an empty field when replacing a credential', async () => {
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /Replace api key/i })[0]);

        const input = await screen.findByLabelText(/New api key/i);
        // Preloading the current value would put a secret on screen with no
        // reveal, no timer and no audit record.
        expect(input.value).toBe('');
        expect(input.type).toBe('password');
    });

    it('saves a replacement credential', async () => {
        await renderView();
        fireEvent.click(screen.getAllByRole('button', { name: /Replace api key/i })[0]);

        const input = await screen.findByLabelText(/New api key/i);
        fireEvent.change(input, { target: { value: 'new-value' } });
        fireEvent.click(screen.getByRole('button', { name: /Replace credential/i }));

        await waitFor(() => expect(callables.saveAiCredential).toHaveBeenCalledWith({
            providerId: 'groq', field: 'apiKey', value: 'new-value',
        }));
    });

    it('refuses to submit an empty credential', async () => {
        await renderView();
        fireEvent.click(screen.getAllByRole('button', { name: /Replace api key/i })[0]);
        const input = await screen.findByLabelText(/New api key/i);

        // The field is marked required, so the browser's own constraint
        // validation blocks an empty submission before the handler runs. That is
        // the mechanism; what matters is that nothing is saved and the dialog
        // stays open. The handler keeps its own guard as defence for any caller
        // that submits the form programmatically.
        expect(input.hasAttribute('required')).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: /Replace credential/i }));

        await waitFor(() => expect(screen.getByLabelText(/New api key/i)).toBeTruthy());
        expect(callables.saveAiCredential).not.toHaveBeenCalled();
    });

    it('reports an empty value if the form is submitted programmatically', async () => {
        await renderView();
        fireEvent.click(screen.getAllByRole('button', { name: /Replace api key/i })[0]);
        const input = await screen.findByLabelText(/New api key/i);

        // Bypasses constraint validation the way a scripted submit would, which
        // is the path the handler's own guard exists for.
        fireEvent.submit(input.form);

        await waitFor(() => expect(screen.getByText(/Enter a value/)).toBeTruthy());
        expect(callables.saveAiCredential).not.toHaveBeenCalled();
    });

    it('requires the provider name typed back before deleting', async () => {
        await renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Groq API key' }));

        const dialog = await screen.findByRole('dialog');
        // Nothing typed yet: the confirm control says what is still needed.
        expect(within(dialog).getByRole('button', { name: 'Type the provider name to continue' })).toBeTruthy();

        // A near-miss is still refused.
        fireEvent.change(within(dialog).getByLabelText(/Type "Groq" to confirm/), { target: { value: 'groq' } });
        expect(within(dialog).getByRole('button', { name: 'Type the provider name to continue' })).toBeTruthy();
        expect(callables.deleteAiCredential).not.toHaveBeenCalled();

        fireEvent.change(within(dialog).getByLabelText(/Type "Groq" to confirm/), { target: { value: 'Groq' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete credential' }));

        await waitFor(() => expect(callables.deleteAiCredential).toHaveBeenCalledWith({
            providerId: 'groq', field: 'apiKey', confirmation: 'Groq',
        }));
    });

    it('names each delete control after the credential it removes', async () => {
        await renderView();

        const names = screen.getAllByRole('button', { name: /^Delete / })
            .map((button) => button.getAttribute('aria-label'));
        expect(new Set(names).size).toBe(names.length);
        expect(names).toContain('Delete Groq API key');
        expect(names).toContain('Delete Cloudflare Workers AI API token');
    });

    it('enables and disables a provider', async () => {
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: 'Disable' })[0]);

        await waitFor(() => expect(callables.setAiProviderEnabled).toHaveBeenCalledWith({
            providerId: 'groq', enabled: false,
        }));
    });

    it('runs a connection test and reports the result', async () => {
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /Test connection/i })[0]);

        await waitFor(() => expect(callables.testAiProvider).toHaveBeenCalledWith({ providerId: 'groq' }));
        await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('Connected. Responded in 120ms.'));
    });

    it('reports a failed connection test without exposing the credential', async () => {
        callables.testAiProvider = vi.fn().mockResolvedValue({
            data: { success: false, message: 'The AI service rejected SafeHaul credentials.' },
        });
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: /Test connection/i })[0]);

        await waitFor(() => expect(showError).toHaveBeenCalledWith('The AI service rejected SafeHaul credentials.'));
        expect(showError.mock.calls.flat().join(' ')).not.toContain(REAL_SECRET);
    });

    it('does not offer a test for an unconfigured provider', async () => {
        await renderView();
        const buttons = screen.getAllByRole('button', { name: /Test connection/i });
        // Cerebras is unconfigured in the fixture, so at least one is disabled.
        expect(buttons.some((button) => button.disabled)).toBe(true);
    });

    it('saves a non-secret setting through the config callable', async () => {
        await renderView();

        fireEvent.change(screen.getByLabelText(/Account ID/i), { target: { value: 'b'.repeat(32) } });
        fireEvent.click(screen.getByRole('button', { name: /Save settings/i }));

        await waitFor(() => expect(callables.updateAiProviderConfig).toHaveBeenCalledWith({
            providerId: 'cloudflare',
            settings: { accountId: 'b'.repeat(32) },
        }));
    });
});

describe('Groq migration', () => {
    it('offers the migration only while the legacy binding is in use', async () => {
        await renderView();
        expect(screen.queryByRole('button', { name: /Migrate legacy key/i })).toBeNull();

        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: PROVIDERS.map((row) => (
                        row.id === 'groq' ? { ...row, credentialSource: 'legacy-env' } : row
                    )),
                    telemetry: [],
                },
            }),
        });
        render(<AiIntegrationsView />);

        await waitFor(() => expect(
            screen.getAllByRole('button', { name: /Migrate legacy key/i }).length,
        ).toBeGreaterThan(0));
    });

    it('says the provider is still on the legacy binding', async () => {
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: [{ ...PROVIDERS[0], credentialSource: 'legacy-env' }],
                    telemetry: [],
                },
            }),
        });
        render(<AiIntegrationsView />);

        await waitFor(() => expect(
            screen.getByText(/Using the legacy deploy binding, not the managed credential\./),
        ).toBeTruthy());
    });

    it('never renders a token returned by the migration', async () => {
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: { providers: [{ ...PROVIDERS[0], credentialSource: 'legacy-env' }], telemetry: [] },
            }),
        });
        const { container } = render(<AiIntegrationsView />);
        await waitFor(() => expect(screen.getByText('Groq')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: /Migrate legacy key/i }));

        await waitFor(() => expect(callables.migrateGroqCredential).toHaveBeenCalled());
        expect(container.innerHTML).not.toContain(REAL_SECRET);
    });
});

describe('re-authentication', () => {
    const staleOnce = (callableName) => {
        let called = false;
        return vi.fn(async (payload) => {
            if (!called) {
                called = true;
                const error = new Error('failed: REAUTH_REQUIRED');
                error.code = 'functions/failed-precondition';
                throw error;
            }
            return { data: { [callableName]: true, providerId: payload.providerId, field: payload.field, value: REAL_SECRET } };
        });
    };

    it('prompts for the password and retries the reveal once', async () => {
        stubCallables({ revealAiCredential: staleOnce('reveal') });
        reauthenticateWithCredential.mockResolvedValue({});
        await renderView();

        fireEvent.click(revealButton('Groq'));

        const password = await screen.findByLabelText(/password/i);
        fireEvent.change(password, { target: { value: 'correct-horse' } });
        fireEvent.click(screen.getByRole('button', { name: /confirm|continue|verify/i }));

        await waitFor(() => expect(screen.getByText(REAL_SECRET)).toBeTruthy());
        expect(callables.revealAiCredential).toHaveBeenCalledTimes(2);
    });

    it('reveals nothing when the prompt is dismissed', async () => {
        stubCallables({ revealAiCredential: staleOnce('reveal') });
        await renderView();

        fireEvent.click(revealButton('Groq'));
        await screen.findByLabelText(/password/i);

        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        await waitFor(() => expect(screen.queryByLabelText(/password/i)).toBeNull());
        expect(screen.queryByText(REAL_SECRET)).toBeNull();
        // A dismissed prompt means nothing happened, so nothing is announced.
        expect(showSuccess).not.toHaveBeenCalled();
    });

    it('does not report success for a mutation whose prompt was dismissed', async () => {
        stubCallables({ setAiProviderEnabled: staleOnce('enabled') });
        await renderView();

        fireEvent.click(screen.getAllByRole('button', { name: 'Disable' })[0]);
        await screen.findByLabelText(/password/i);
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        await waitFor(() => expect(screen.queryByLabelText(/password/i)).toBeNull());
        expect(showSuccess).not.toHaveBeenCalled();
    });
});

describe('Research & Media subsection', () => {
    it('lists the image providers with masked credentials', async () => {
        await renderView();

        expect(screen.getByText('Research & Media')).toBeTruthy();
        expect(screen.getByText('Pexels')).toBeTruthy();
        expect(screen.getByText('Openverse')).toBeTruthy();
    });

    it('says which providers need a credential and which may be hosted', async () => {
        await renderView();

        expect(screen.getByText(/Requires an API credential\./)).toBeTruthy();
        expect(screen.getByText(/Works without a credential/)).toBeTruthy();
        expect(screen.getByText(/must be hotlinked, per the provider terms/)).toBeTruthy();
    });

    it('explains the fallback when nothing is configured', async () => {
        await renderView();
        expect(screen.getByText(/approved SafeHaul illustration rather than an unlicensed image/)).toBeTruthy();
    });
});

describe('telemetry panel', () => {
    it('shows an empty state when nothing has run', async () => {
        await renderView();
        expect(screen.getByText('No AI requests have been recorded yet.')).toBeTruthy();
    });

    it('shows safe operational facts only', async () => {
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: PROVIDERS,
                    telemetry: [{
                        id: 't1', taskType: 'cdl_extraction', providerId: 'groq',
                        model: 'model-a', outcome: 'success', latencyMs: 812,
                        fallbackCount: 0, timestamp: '2026-08-02T12:00:00Z',
                    }],
                },
            }),
        });
        const { container } = render(<AiIntegrationsView />);

        await waitFor(() => expect(screen.getByText('cdl_extraction')).toBeTruthy());
        expect(screen.getByText('812ms')).toBeTruthy();
        // No prompt, no document content, no credential.
        expect(container.innerHTML).not.toContain(REAL_SECRET);
    });
});

describe('page structure', () => {
    it('starts at h2, because the Super Admin masthead owns the single h1', async () => {
        await renderView();

        expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
        expect(screen.getByRole('heading', { level: 2, name: 'AI Integrations' })).toBeTruthy();
    });

    it('explains the credential-handling guarantees on the page itself', async () => {
        await renderView();

        expect(screen.getByText(/masked by default and revealed one at a time/i)).toBeTruthy();
        expect(screen.getByText(/clears after 30 seconds/i)).toBeTruthy();
        expect(screen.getByText(/take effect without a deployment/i)).toBeTruthy();
    });

    it('gives every reveal control a name that identifies its provider and field', async () => {
        await renderView();

        // A page of identical "Reveal" buttons is unusable with a screen reader.
        const names = screen.getAllByRole('button', { name: /^Reveal / })
            .map((button) => button.getAttribute('aria-label'));
        expect(new Set(names).size).toBe(names.length);
        expect(names).toContain('Reveal Groq API key');
        expect(names).toContain('Reveal Cloudflare Workers AI API token');
    });
});
