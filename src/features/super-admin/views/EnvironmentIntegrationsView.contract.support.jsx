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

// =====================================================================
// Shared harness for the EnvironmentIntegrationsView contract suites.
//
// `vi.mock` is hoisted per file, so each suite keeps its own registrations,
// whose factories delegate to the `*Mock()` functions below; the module
// registry hands every caller this same instance, so the spies a suite
// imports are the ones the view talks to. This module does NOT import the
// view statically — static imports run before the suite's mocks exist — so
// `renderLoaded` loads it lazily; a suite that renders the view raw imports
// it itself, after its own hoisted mocks.
// =====================================================================

/* eslint-disable react-refresh/only-export-components -- a test harness, not
   an HMR module; nothing here renders outside vitest. */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

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
    const { EnvironmentIntegrationsView } = await import('./EnvironmentIntegrationsView');
    installCallables(overrides);
    const view = render(<EnvironmentIntegrationsView />);
    await screen.findByRole('button', { name: 'Reveal ARTIFICIAL_MASTER_KEY' });
    return view;
}

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
}

export {
    PROTECTED_REASON,
    permissions,
    restrictions,
    entry,
    ENTRIES,
    SECRET_PLAINTEXT,
    listResponse,
    installCallables,
    rowFor,
    renderLoaded,
};
