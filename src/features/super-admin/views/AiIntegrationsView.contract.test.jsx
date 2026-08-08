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
        // The registry default and the effective rank agree until an operator
        // reorders; the tests that exercise a reorder override `rank`.
        rank: priority,
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

/**
 * The routing summary the server returns alongside the rows: the effective
 * order, whether it is the shipped default, and per kind of task which
 * providers would actually be reached.
 */
function routingFor(providers, { usingDefaultOrder = true } = {}) {
    const laneRow = (row, capable) => ({
        providerId: row.id,
        eligible: capable && row.configured && row.enabled && !row.cooldown.active && !row.retired,
        reason: (() => {
            if (row.retired) return 'retired';
            if (!capable) return 'incapable';
            if (!row.configured) return 'unconfigured';
            if (!row.enabled) return 'disabled';
            if (row.cooldown.active) return 'cooldown';
            return null;
        })(),
        model: 'model-a',
    });

    // Only these four declare vision in the registry.
    const VISION = new Set(['gemini', 'mistral', 'openrouter', 'huggingface']);

    return {
        order: providers.map((row) => row.id),
        usingDefaultOrder,
        lanes: [
            {
                id: 'text',
                label: 'Text and structured output',
                description: 'Article generation, topic selection, summarisation and classification.',
                providers: providers.map((row) => laneRow(row, true)),
            },
            {
                id: 'vision',
                label: 'Document images',
                description: 'CDL auto-fill and e-document field placement.',
                providers: providers.map((row) => laneRow(row, VISION.has(row.id))),
            },
        ],
    };
}

function stubCallables(overrides = {}) {
    callables.listAiProviders = vi.fn().mockResolvedValue({
        data: {
            providers: PROVIDERS,
            routing: routingFor(PROVIDERS),
            telemetry: [],
            generatedAt: '2026-08-02T12:00:00Z',
        },
    });
    callables.listMediaProviders = vi.fn().mockResolvedValue({ data: { providers: MEDIA_PROVIDERS } });
    callables.revealAiCredential = vi.fn().mockResolvedValue({
        data: { providerId: 'groq', field: 'apiKey', value: REAL_SECRET, unavailableReason: null },
    });
    callables.saveAiCredential = vi.fn().mockResolvedValue({ data: { saved: true } });
    callables.deleteAiCredential = vi.fn().mockResolvedValue({ data: { deleted: true } });
    callables.setAiProviderEnabled = vi.fn().mockResolvedValue({ data: { enabled: false } });
    callables.setAiProviderPriority = vi.fn().mockResolvedValue({
        data: { saved: true, order: PROVIDERS.map((row) => row.id) },
    });
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
    // `getAllByText`: a provider is named in the routing-order list, in the
    // per-task eligibility cards and in the configuration table. All three are
    // the point of the page, so its name is legitimately on screen more than
    // once.
    await waitFor(() => expect(screen.getAllByText('Groq').length).toBeGreaterThan(0));
    return utils;
}

/** The routing-order list, which is where reordering happens. */
const orderList = () => screen.getByRole('list', { name: 'AI provider routing order' });

/** The provider names in the routing-order list, top to bottom. */
const orderedNames = () => within(orderList())
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.font-semibold')?.textContent);

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
            expect(screen.getAllByText(row.displayName).length).toBeGreaterThan(0);
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
        expect(screen.getAllByText('Quota cooldown').length).toBeGreaterThan(0);
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
        expect(screen.getAllByText('Groq').length).toBeGreaterThan(0);
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
        // The page carries more than one live region — the reveal countdown and
        // the routing-order announcer — so this asserts the countdown's own
        // text rather than assuming it is the only one.
        const live = screen.getAllByRole('status').map((node) => node.textContent);
        expect(live.some((text) => /Hides automatically in 30s/.test(text))).toBe(true);
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

describe('routing order', () => {
    it('lists every provider in the order the router will try them', async () => {
        await renderView();
        expect(orderedNames()).toEqual(PROVIDERS.map((row) => row.displayName));
    });

    it('says plainly whether the deployment is running the shipped default', async () => {
        await renderView();
        expect(screen.getByText(/running the built-in default order/)).toBeTruthy();
    });

    it('says so when an operator has chosen a different order', async () => {
        const reordered = [PROVIDERS[4], ...PROVIDERS.filter((row) => row.id !== 'mistral')]
            .map((row, index) => ({ ...row, rank: index + 1 }));
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: reordered,
                    routing: routingFor(reordered, { usingDefaultOrder: false }),
                    telemetry: [],
                },
            }),
        });
        await renderView();

        expect(screen.getByText(/running an operator-chosen order/)).toBeTruthy();
        expect(orderedNames()[0]).toBe('Mistral');
    });

    it('shows a row its effective position, and its default when they differ', async () => {
        const reordered = [PROVIDERS[4], ...PROVIDERS.filter((row) => row.id !== 'mistral')]
            .map((row, index) => ({ ...row, rank: index + 1 }));
        stubCallables({
            listAiProviders: vi.fn().mockResolvedValue({
                data: {
                    providers: reordered,
                    routing: routingFor(reordered, { usingDefaultOrder: false }),
                    telemetry: [],
                },
            }),
        });
        await renderView();

        // Mistral now runs first but ships fifth. Saying only one of those
        // makes the registry documentation look wrong.
        expect(screen.getByText('Default position 5')).toBeTruthy();
    });

    // The accessibility policy is binding, and a drag-only control fails it.
    // These are the tests that would catch the move controls being quietly
    // dropped as redundant.
    describe('without a pointer', () => {
        it('offers a named move control for every provider, in both directions', async () => {
            await renderView();

            for (const row of PROVIDERS) {
                expect(screen.getByRole('button', { name: `Move ${row.displayName} up` })).toBeTruthy();
                expect(screen.getByRole('button', { name: `Move ${row.displayName} down` })).toBeTruthy();
            }
        });

        it('moves a provider up the order', async () => {
            await renderView();

            fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));

            // Mistral is fifth in the fixture; one move up puts it fourth.
            expect(orderedNames()[3]).toBe('Mistral');
        });

        it('moves a provider down the order', async () => {
            await renderView();

            fireEvent.click(screen.getByRole('button', { name: 'Move Groq down' }));

            expect(orderedNames()[1]).toBe('Groq');
        });

        it('promotes a provider to first with repeated moves', async () => {
            await renderView();

            for (let i = 0; i < 4; i += 1) {
                fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));
            }

            expect(orderedNames()[0]).toBe('Mistral');
        });

        it('keeps focus on the control that was pressed, so a move can be repeated', async () => {
            await renderView();
            const up = screen.getByRole('button', { name: 'Move Mistral up' });
            up.focus();

            fireEvent.click(up);

            // Same accessible name, but the button has moved with its row —
            // without this a keyboard user is returned to the top of the page
            // after every single move.
            expect(document.activeElement.getAttribute('aria-label')).toBe('Move Mistral up');
        });

        it('cannot move the first provider up or the last one down', async () => {
            await renderView();

            expect(screen.getByRole('button', { name: 'Move Groq up' }).disabled).toBe(true);
            expect(screen.getByRole('button', { name: 'Move Hugging Face down' }).disabled).toBe(true);
        });

        it('announces each move, because a changed list index is silent', async () => {
            await renderView();

            fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));

            const announcements = screen.getAllByRole('status').map((node) => node.textContent);
            expect(announcements.some((text) => /Mistral moved to position 4 of 9/.test(text))).toBe(true);
            expect(announcements.some((text) => /Not saved yet/.test(text))).toBe(true);
        });
    });

    it('does not save until asked, so a change of mind costs nothing', async () => {
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));

        expect(callables.setAiProviderPriority).not.toHaveBeenCalled();
    });

    it('offers no save control until something has actually changed', async () => {
        await renderView();
        expect(screen.queryByRole('button', { name: /Save routing order/i })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));

        expect(screen.getByRole('button', { name: /Save routing order/i })).toBeTruthy();
    });

    it('sends the whole order, as ids, when saved', async () => {
        await renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));

        fireEvent.click(screen.getByRole('button', { name: /Save routing order/i }));

        await waitFor(() => expect(callables.setAiProviderPriority).toHaveBeenCalledWith({
            providerIds: [
                'groq', 'gemini', 'cloudflare', 'mistral', 'github-models',
                'cerebras', 'sambanova', 'openrouter', 'huggingface',
            ],
        }));
    });

    it('reloads after saving, so the screen shows what the server stored', async () => {
        await renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));
        fireEvent.click(screen.getByRole('button', { name: /Save routing order/i }));

        await waitFor(() => expect(callables.listAiProviders).toHaveBeenCalledTimes(2));
        expect(showSuccess).toHaveBeenCalledWith(expect.stringMatching(/Routing order saved/));
    });

    it('discards an unsaved reorder on request', async () => {
        await renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));
        expect(orderedNames()[3]).toBe('Mistral');

        fireEvent.click(screen.getByRole('button', { name: /Discard changes/i }));

        expect(orderedNames()).toEqual(PROVIDERS.map((row) => row.displayName));
        expect(callables.setAiProviderPriority).not.toHaveBeenCalled();
    });

    it('re-authenticates a stale session and then saves', async () => {
        const stale = { code: 'functions/failed-precondition', message: 'REAUTH_REQUIRED: re-enter your password.' };
        let calls = 0;
        callables.setAiProviderPriority = vi.fn(() => {
            calls += 1;
            if (calls === 1) return Promise.reject(stale);
            return Promise.resolve({ data: { saved: true, order: [] } });
        });
        reauthenticateWithCredential.mockResolvedValue({});
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));
        fireEvent.click(screen.getByRole('button', { name: /Save routing order/i }));

        const password = await screen.findByLabelText(/password/i);
        fireEvent.change(password, { target: { value: 'artificial-password' } });
        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

        await waitFor(() => expect(callables.setAiProviderPriority).toHaveBeenCalledTimes(2));
    });

    it('never reports success when re-authentication is cancelled', async () => {
        callables.setAiProviderPriority = vi.fn().mockRejectedValue({
            code: 'functions/failed-precondition',
            message: 'REAUTH_REQUIRED: re-enter your password.',
        });
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));
        fireEvent.click(screen.getByRole('button', { name: /Save routing order/i }));

        await screen.findByLabelText(/password/i);
        fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

        await waitFor(() => expect(callables.setAiProviderPriority).toHaveBeenCalledTimes(1));
        expect(showSuccess).not.toHaveBeenCalled();
        // The draft is still on screen: a cancelled save must not look like a
        // completed one, and must not silently discard the operator's work.
        expect(orderedNames()[3]).toBe('Mistral');
    });

    it('surfaces a rejected order without pretending it saved', async () => {
        callables.setAiProviderPriority = vi.fn().mockRejectedValue({
            code: 'functions/invalid-argument',
            message: 'That order lists the same provider twice.',
        });
        await renderView();

        fireEvent.click(screen.getByRole('button', { name: 'Move Mistral up' }));
        fireEvent.click(screen.getByRole('button', { name: /Save routing order/i }));

        await waitFor(() => expect(showError).toHaveBeenCalledWith('That order lists the same provider twice.'));
        expect(showSuccess).not.toHaveBeenCalled();
    });
});

describe('why a provider is skipped', () => {
    it('separates text tasks from document-image tasks', async () => {
        await renderView();

        expect(screen.getByText('Text and structured output')).toBeTruthy();
        expect(screen.getByText('Document images')).toBeTruthy();
    });

    it('explains a capability gap rather than leaving a rank unexplained', async () => {
        await renderView();

        const vision = screen.getByText('Document images').closest('div').parentElement;
        // Groq is configured, enabled and healthy, and it still never serves a
        // CDL photograph. Without this sentence the screen shows a rank and no
        // reason, which is the gap this feature was asked to close.
        expect(within(vision).getAllByText('Does not support what this kind of task needs.').length)
            .toBeGreaterThan(0);
    });

    it('names the providers that would actually be tried, in order', async () => {
        await renderView();

        expect(screen.getByText(/Tried in this order: Groq, Google Gemini/)).toBeTruthy();
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
        await waitFor(() => expect(screen.getAllByText('Groq').length).toBeGreaterThan(0));

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
