/**
 * Accessibility and defect-fix proof for the migrated `IntegrationsTab`.
 *
 * `IntegrationsTab.contract.test.jsx` freezes the SDK/login/Graph/callable
 * contracts frozen by the 2026-07-23 deep-audit. This file proves the
 * concrete presentation defects recorded there are fixed, without touching
 * (or implying a fix to) the unrelated, unfixed tenant-binding security
 * defect in `connectFacebookPage` — that stays out of scope.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const connectFacebookPage = vi.hoisted(() => vi.fn());

vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (name === 'connectFacebookPage' ? connectFacebookPage : vi.fn()),
}));

import { IntegrationsTab } from './IntegrationsTab';

function resetFacebookGlobals() {
    delete window.FB;
    delete window.fbAsyncInit;
    document.getElementById('facebook-jssdk')?.remove();
    if (!document.getElementsByTagName('script')[0]) {
        document.head.appendChild(document.createElement('script'));
    }
}

function mountAndLoadSdk(fbStub) {
    const utils = render(<IntegrationsTab />);
    window.FB = fbStub;
    act(() => { window.fbAsyncInit(); });
    return utils;
}

beforeEach(() => {
    vi.clearAllMocks();
    resetFacebookGlobals();
    connectFacebookPage.mockResolvedValue({ data: { success: true } });
});

afterEach(() => {
    resetFacebookGlobals();
    vi.unstubAllGlobals();
});

describe('IntegrationsTab — connected state is not colour-only (defect)', () => {
    it('pairs the Connected badge with visible text, not colour alone', async () => {
        let loginCallback;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: async () => ({ data: [{ id: 'artificial-page-1', name: 'Artificial Page One' }] }),
        }));
        mountAndLoadSdk({ init: vi.fn(), login: (cb) => { loginCallback = cb; } });
        fireEvent.click(screen.getByRole('button', { name: /Connect Facebook/i }));
        loginCallback({ authResponse: { accessToken: 'artificial-token' } });

        expect(await screen.findByRole('button', { name: 'Connected' })).toBeInTheDocument();
        expect(screen.getByText('Connected', { selector: '.ds-badge' })).toBeInTheDocument();
        expect(await screen.findByText(/Active Page:/)).toBeInTheDocument();
    });
});

describe('IntegrationsTab — SDK loading is announced (defect: silent 10px notice)', () => {
    it('shows the loading notice in a live region while the SDK has not finished loading', () => {
        render(<IntegrationsTab />);
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('SDK Loading...');
    });

    it('removes the loading notice once the SDK is ready', () => {
        mountAndLoadSdk({ init: vi.fn(), login: vi.fn() });
        expect(screen.queryByText('SDK Loading...')).toBeNull();
    });
});

describe('IntegrationsTab — 12px floor (defect: text-[10px])', () => {
    it('renders no interface text below 12px', () => {
        const { container } = render(<IntegrationsTab />);
        const offenders = [...container.querySelectorAll('[class*="text-["]')]
            .map((el) => el.className)
            .filter((cls) => /text-\[(9|10|11)px\]/.test(cls));
        expect(offenders).toEqual([]);
    });
});

describe('IntegrationsTab — no secret ever renders', () => {
    it('never puts the access token in the DOM', async () => {
        let loginCallback;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: async () => ({ data: [{ id: 'artificial-page-1', name: 'Artificial Page One' }] }),
        }));
        const { container } = mountAndLoadSdk({ init: vi.fn(), login: (cb) => { loginCallback = cb; } });
        fireEvent.click(screen.getByRole('button', { name: /Connect Facebook/i }));
        loginCallback({ authResponse: { accessToken: 'artificial-super-secret-token' } });

        await screen.findByRole('button', { name: 'Connected' });
        expect(container.innerHTML).not.toContain('artificial-super-secret-token');
    });
});

describe('IntegrationsTab — axe', () => {
    it('has no violations before the SDK loads', async () => {
        const { container } = render(<IntegrationsTab />);
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations once the SDK is ready', async () => {
        const { container } = mountAndLoadSdk({ init: vi.fn(), login: vi.fn() });
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations in the connected state', async () => {
        let loginCallback;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: async () => ({ data: [{ id: 'artificial-page-1', name: 'Artificial Page One' }] }),
        }));
        const { container } = mountAndLoadSdk({ init: vi.fn(), login: (cb) => { loginCallback = cb; } });
        fireEvent.click(screen.getByRole('button', { name: /Connect Facebook/i }));
        loginCallback({ authResponse: { accessToken: 'artificial-token' } });
        await screen.findByRole('button', { name: 'Connected' });

        expect((await axe(container)).violations).toEqual([]);
    });
});
