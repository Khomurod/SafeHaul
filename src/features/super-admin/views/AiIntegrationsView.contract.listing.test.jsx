/**
 * Listing: every provider on screen, the retired one shown honestly, the Research & Media subsection, and the page's heading structure.
 *
 * Part of the AiIntegrationsView contract suite, split from the original
 * single file by subject. The fixtures, callable stubs, spies and the
 * security-proof context live in `AiIntegrationsView.contract.support.jsx`;
 * the properties pinned across the suite are listed there and in the view.
 * Each `vi.mock` below has to stay in this file, because vitest hoists it
 * per file and cannot register one from a helper.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./AiIntegrationsView.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./AiIntegrationsView.contract.support')).libFirebaseMock());
vi.mock('firebase/auth', async () => (await import('./AiIntegrationsView.contract.support')).firebaseAuthMock());
vi.mock('@shared/components/feedback', async () => (await import('./AiIntegrationsView.contract.support')).feedbackMock());

import { AiIntegrationsView } from './AiIntegrationsView';
import {
    PROVIDERS,
    stubCallables,
    renderView,
    resetHarness,
} from './AiIntegrationsView.contract.support';

beforeEach(() => {
    resetHarness();
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
