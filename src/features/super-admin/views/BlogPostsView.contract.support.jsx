/**
 * Contract proof for the Super Admin Blog Posts screen.
 *
 * The screen is deliberately minimal — titles and a Delete action — so the
 * properties worth pinning are mostly about what it does *not* do, and about
 * deletion being properly guarded:
 *
 *  - it lists titles and stays a list, not a content-management screen;
 *  - deletion asks for confirmation and names the article;
 *  - deletion requires recent authentication, and a dismissed prompt reports
 *    nothing;
 *  - focus is restored somewhere meaningful after the row disappears;
 *  - a removed article is labelled and offers no further actions;
 *  - loading, empty and error states are all reachable.
 */

// =====================================================================
// Shared harness for the BlogPostsView contract suites.
//
// `vi.mock` is hoisted per file, so each suite keeps its own registrations,
// whose factories delegate to the `*Mock()` functions below; the module
// registry hands every caller this same instance, so the spies a suite
// imports are the ones the view talks to. This module does NOT import the
// view statically — static imports run before the suite's mocks exist — so
// `renderView` loads it lazily; a suite that renders the view raw imports
// it itself, after its own hoisted mocks.
// =====================================================================

/* eslint-disable react-refresh/only-export-components -- a test harness, not
   an HMR module; nothing here renders outside vitest. */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

const POSTS = [
    {
        id: '2026-08-02_industry-news',
        title: 'FMCSA Updates Hours-of-Service Documentation Requirements',
        slug: 'fmcsa-updates-hours-of-service-documentation',
        publicationDate: '2026-08-02',
        status: 'published',
    },
    {
        id: '2026-08-02_recruitment',
        title: 'Cutting Driver Turnover in the First Ninety Days',
        slug: 'cutting-driver-turnover-first-ninety-days',
        publicationDate: '2026-08-02',
        status: 'published',
    },
    {
        id: '2026-08-01_safehaul-education',
        title: 'Electronic Signatures for Driver Qualification Paperwork',
        slug: 'electronic-signatures-driver-qualification',
        publicationDate: '2026-08-01',
        status: 'deleted',
    },
];

/**
 * Ledger rows, covering the three cases the screen exists to separate: an
 * article that published, a run refused by a named stage, and a slot held for
 * the next run — which looks like a failure in a list of outcomes and is the
 * pipeline working as designed.
 */
const RUNS = [
    {
        id: 'run-1',
        outcome: 'published',
        stage: 'publication',
        slotKey: '2026-08-02_industry-news',
        themeId: 'industry-news',
        publicationDate: '2026-08-02',
        detail: null,
        trigger: 'scheduled',
        generationTransactionId: 'txn-gen-1',
        verificationTransactionId: 'txn-ver-1',
        verificationSupported: true,
        unsupportedClaimCount: 0,
        at: '2026-08-02T12:15:00Z',
    },
    {
        id: 'run-2',
        outcome: 'skipped_unsupported_claims',
        stage: 'verification',
        slotKey: '2026-08-02_recruitment',
        themeId: 'recruitment',
        publicationDate: '2026-08-02',
        detail: 'The rule takes effect in January 2027.',
        trigger: 'scheduled',
        generationTransactionId: 'txn-gen-2',
        verificationTransactionId: 'txn-ver-2',
        verificationSupported: false,
        unsupportedClaimCount: 1,
        at: '2026-08-02T13:15:00Z',
    },
    {
        id: 'run-3',
        outcome: 'deferred_to_next_run',
        stage: 'scheduling',
        slotKey: '2026-08-02_safehaul-education',
        themeId: 'safehaul-education',
        publicationDate: '2026-08-02',
        detail: null,
        trigger: 'manual',
        generationTransactionId: null,
        verificationTransactionId: null,
        verificationSupported: null,
        unsupportedClaimCount: null,
        at: '2026-08-02T13:15:00Z',
    },
];

function stubCallables(overrides = {}) {
    callables.listBlogPosts = vi.fn().mockResolvedValue({
        data: { posts: POSTS, generatedAt: '2026-08-02T18:00:00Z' },
    });
    callables.deleteBlogPost = vi.fn().mockResolvedValue({ data: { deleted: true } });
    callables.runBlogPublicationNow = vi.fn().mockResolvedValue({
        data: { dueCount: 3, attempted: 0, published: 0, results: [] },
    });
    callables.listBlogRuns = vi.fn().mockResolvedValue({
        data: { runs: RUNS, truncated: false, unavailable: false, retentionDays: 30 },
    });
    Object.assign(callables, overrides);
}


async function renderView() {
    const { BlogPostsView } = await import('./BlogPostsView');
    const utils = render(<BlogPostsView />);
    await waitFor(() => expect(screen.getByText(POSTS[0].title)).toBeTruthy());
    return utils;
}

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
    vi.clearAllMocks();
    stubCallables();
}

export {
    POSTS,
    RUNS,
    stubCallables,
    renderView,
};
