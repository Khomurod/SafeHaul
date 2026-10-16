/**
 * The three surfaces that only render when something has already gone wrong.
 *
 * These render only on a crash or an offline queue, so nothing else renders
 * them. One that renders `<Icon icon={X} />` without importing `Icon` throws
 * `ReferenceError: Icon is not defined` the moment it renders, and
 * `QueueStatusIndicator` mounts at the App root, so going offline would take
 * the whole application down.
 *
 * Plain `no-undef` does not resolve JSX identifiers — that is what
 * `react/jsx-no-undef` is for — and the icon check looks for `lucide-react`
 * imports and is blind to what a file renders. The general guard is the lint
 * rule, on and pinned by `scripts/test-lint-rules.mjs` M1. This file is the
 * specific one: it renders each of these surfaces at least once, so a crash
 * screen can never be shipped in a state where it crashes.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));

const queueState = vi.hoisted(() => ({ current: {} }));
vi.mock('@/hooks/useSubmissionQueue', () => ({
    useSubmissionQueue: () => queueState.current,
}));

import ErrorBoundary from './ErrorBoundary';
import FeatureErrorBoundary from './FeatureErrorBoundary';
import { QueueStatusIndicator } from './QueueStatusIndicator';

function Exploding() {
    throw new Error('boom');
}

/*
 * React logs a caught boundary error to `console.error` on every render below.
 * Silencing it keeps a passing run readable; it is restored between tests so a
 * genuinely unexpected error still surfaces.
 */
let consoleError;
beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    consoleError.mockRestore();
    vi.clearAllMocks();
});

const QUEUE_DEFAULTS = {
    pendingCount: 0,
    isProcessing: false,
    isOnline: true,
    hasQueuedItems: false,
    showQueueIndicator: false,
    processQueueNow: vi.fn(),
    error: null,
};

function setQueue(overrides) {
    queueState.current = { ...QUEUE_DEFAULTS, ...overrides };
}

describe('ErrorBoundary — the top-level crash screen', () => {
    it('renders its fallback, with both actions and their glyphs', () => {
        render(<ErrorBoundary><Exploding /></ErrorBoundary>);

        expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
        expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Go home' })).toBeInTheDocument();
        expect(screen.getByText('Error Code: UI_CRASH_HANDLER')).toBeInTheDocument();
    });

    it('renders its children untouched when nothing throws', () => {
        render(<ErrorBoundary><p>all is well</p></ErrorBoundary>);

        expect(screen.getByText('all is well')).toBeInTheDocument();
        expect(screen.queryByText('Error Code: UI_CRASH_HANDLER')).not.toBeInTheDocument();
    });
});

describe('FeatureErrorBoundary — one section failed, the app did not', () => {
    it('renders its fallback, named after the feature, with both actions', () => {
        render(
            <FeatureErrorBoundary featureName="Campaigns">
                <Exploding />
            </FeatureErrorBoundary>,
        );

        expect(screen.getByText('Campaigns is temporarily unavailable')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry section' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Go home' })).toBeInTheDocument();
    });

    it('falls back to a neutral name when the feature is not given', () => {
        render(<FeatureErrorBoundary><Exploding /></FeatureErrorBoundary>);

        expect(screen.getByText('This section is temporarily unavailable')).toBeInTheDocument();
    });
});

describe('QueueStatusIndicator — every branch renders its own glyph', () => {
    it('renders nothing while online with nothing queued', () => {
        setQueue({});
        const { container } = render(<QueueStatusIndicator />);

        expect(container).toBeEmptyDOMElement();
    });

    it('announces being offline', () => {
        setQueue({ isOnline: false, hasQueuedItems: true, pendingCount: 2 });
        render(<QueueStatusIndicator />);

        expect(screen.getByRole('status')).toHaveTextContent("You're offline");
        expect(screen.getByRole('status')).toHaveTextContent('2 pending');
    });

    it('announces an in-flight submission', () => {
        setQueue({ showQueueIndicator: true, isProcessing: true, pendingCount: 3 });
        render(<QueueStatusIndicator />);

        expect(screen.getByRole('status')).toHaveTextContent('Submitting 3 queued applications...');
    });

    it('announces a queue error assertively, with a retry', () => {
        setQueue({ showQueueIndicator: true, error: 'nope', pendingCount: 1 });
        render(<QueueStatusIndicator />);

        expect(screen.getByRole('alert')).toHaveTextContent('Queue error');
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('announces items waiting to go out', () => {
        setQueue({ showQueueIndicator: true, hasQueuedItems: true, pendingCount: 1 });
        render(<QueueStatusIndicator />);

        expect(screen.getByRole('status')).toHaveTextContent('1 application pending');
    });
});
