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

// =====================================================================
// Shared harness for the AiIntegrationsView contract suites.
//
// `vi.mock` is hoisted per file and cannot be registered from here, so each
// suite keeps its own registrations, whose factories delegate to the
// `*Mock()` functions below; the module registry hands every caller this
// same instance, so the spies a suite imports are the ones the view talks
// to. This module deliberately does NOT import the view statically —
// static imports run before the suite's mocks exist — so `renderView`
// loads it lazily; a suite that calls `render(<AiIntegrationsView />)`
// directly imports the view itself, after its own hoisted mocks.
//
// Fixtures, stubs and helpers are the original file's, verbatim.
// =====================================================================

/* eslint-disable react-refresh/only-export-components -- a test harness, not
   an HMR module; nothing here renders outside vitest. */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { expect, vi } from 'vitest';

export const callables = {};
export const httpsCallable = vi.fn((_functions, name) => {
    if (!callables[name]) throw new Error(`Unexpected callable: ${name}`);
    return callables[name];
});

export const showSuccess = vi.fn();
export const showError = vi.fn();
export const showInfo = vi.fn();
export const reauthenticateWithCredential = vi.fn();

export function firebaseFunctionsMock() {
    return { httpsCallable: (...args) => httpsCallable(...args) };
}

export function libFirebaseMock() {
    return {
        functions: { __functions: true },
        auth: { currentUser: { email: 'ops@example.test', getIdToken: vi.fn().mockResolvedValue('token') } },
        db: {},
    };
}

export function firebaseAuthMock() {
    return {
        EmailAuthProvider: { credential: vi.fn(() => ({ __credential: true })) },
        reauthenticateWithCredential: (...args) => reauthenticateWithCredential(...args),
    };
}

export function feedbackMock() {
    return {
        useToast: () => ({ showSuccess, showError, showInfo }),
    };
}

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
        credentialAccess: 'ok',
        unreadableCredentials: [],
        enabled: true,
        health: 'healthy',
        // Per lane, because a provider's text and image lanes fail independently
        // and one scalar could describe neither.
        laneHealth: { text: 'healthy', vision: 'healthy' },
        laneFailures: { text: 0, vision: 0 },
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
        // Mirrors the real callable's response, `capabilities` included. A stub
        // that invents a field the server does not send is how the
        // per-capability UI passed every test while rendering nothing in
        // production — `aiHealthCheck.test.js` asserts the callable's own shape
        // so the two cannot drift again.
        data: {
            success: true,
            message: 'Connected. 2 capabilities verified in 120ms.',
            model: 'model-a',
            latencyMs: 120,
            capabilities: [
                { id: 'text', label: 'Basic text', status: 'passed', message: 'Passed.' },
                { id: 'structured_json', label: 'Structured JSON', status: 'failed', category: 'provider_request_rejected', message: 'Rejected.' },
                { id: 'vision_single', label: 'Single-image vision', status: 'skipped', message: 'Not offered by this provider.' },
            ],
        },
    });
    callables.migrateGroqCredential = vi.fn().mockResolvedValue({
        data: { migrated: true, verified: true, message: 'Groq credential migrated and verified.' },
    });
    callables.saveMediaCredential = vi.fn().mockResolvedValue({ data: { saved: true } });
    callables.deleteMediaCredential = vi.fn().mockResolvedValue({ data: { deleted: true } });
    callables.listAiTelemetry = vi.fn().mockResolvedValue({
        data: { entries: [], truncated: false, windowSize: 0 },
    });
    callables.diagnoseAiModelPins = vi.fn().mockResolvedValue({
        data: { providers: [], stalePins: 0 },
    });
    // Both generations, because that is the whole point of the check: 1st and
    // 2nd generation functions default to different service accounts, so a
    // Secret Manager grant can fix one AI entry point and leave another refused.
    callables.diagnoseAiCredentialAccess = vi.fn().mockResolvedValue({
        data: {
            generation: 'v2',
            runtime: { serviceAccount: 'proj-number-compute@developer.gserviceaccount.com', source: 'metadata' },
            providers: [],
            unreadableCount: 0,
            permissionDeniedCount: 0,
            summary: 'Every configured AI credential is readable by this runtime.',
        },
    });
    callables.diagnoseAiCredentialAccessV1 = vi.fn().mockResolvedValue({
        data: {
            generation: 'v1',
            runtime: { serviceAccount: 'proj@appspot.gserviceaccount.com', source: 'metadata' },
            providers: [],
            unreadableCount: 0,
            permissionDeniedCount: 0,
            summary: 'Every configured AI credential is readable by this runtime.',
        },
    });
    Object.assign(callables, overrides);
}

async function renderView() {
    const { AiIntegrationsView } = await import('./AiIntegrationsView');
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

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
    vi.clearAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
    stubCallables();
}

export {
    CAPABILITIES,
    provider,
    PROVIDERS,
    MEDIA_PROVIDERS,
    REAL_SECRET,
    routingFor,
    stubCallables,
    renderView,
    orderList,
    orderedNames,
    revealButton,
};
