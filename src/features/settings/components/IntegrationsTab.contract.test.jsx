/**
 * Contract freeze for `IntegrationsTab`, written before its design-system
 * migration. This file had zero test coverage before this campaign. It pins
 * the exact contracts recorded in the 2026-07-23 Integrations deep-audit
 * (NO-GO) so a presentation-only migration cannot silently change them:
 *
 *  - SDK-load: skip script injection if `window.FB` exists; otherwise assign
 *    `window.fbAsyncInit`, call `window.FB.init` with the exact config, and
 *    inject the `facebook-jssdk` script tag once.
 *  - Login: not-ready guard message; the exact `FB.login` scope string;
 *    the cancelled-vs-failed distinction (`status === 'unknown'` is silent).
 *  - Graph API: first-page-only auto-select from `me/accounts`; the exact
 *    "no pages" message.
 *  - Callable: `connectFacebookPage({ shortLivedUserToken, pageId, pageName })`
 *    and its success/failure messages.
 *  - The connected-state limitation: local React state only, no persistence,
 *    no disconnect flow — this migration must not imply otherwise.
 *
 * This freeze does NOT change, endorse, or attempt to fix the tenant-binding
 * defect recorded in that audit (the backend derives the tenant from
 * `request.auth.uid` rather than the real company id) — that remains a
 * separate, security-reviewed backend project. No backend file is touched
 * here or by the presentation migration that follows.
 *
 * All tokens, ids and names below are artificial.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    // A real page always has at least one <script> tag (the module loader);
    // the component's script-injection IIFE inserts before the first one and
    // throws if none exists — a documented pre-existing edge case this freeze
    // does not attempt to fix. happy-dom's bare test document has none, so one
    // is added here purely to match a real page's starting DOM.
    if (!document.getElementsByTagName('script')[0]) {
        document.head.appendChild(document.createElement('script'));
    }
}

/**
 * Renders with `window.FB` unset so the mount effect assigns
 * `window.fbAsyncInit` (it early-returns without doing so when `window.FB`
 * already exists), then supplies the FB stub and fires the SDK's own
 * callback — mirroring how the real `sdk.js` calls it once loaded.
 */
function mountAndLoadSdk(fbStub) {
    const utils = render(<IntegrationsTab />);
    window.FB = fbStub;
    // `fbAsyncInit` triggers `setIsSdkLoaded(true)` outside of any
    // testing-library event wrapper, so the update must be flushed explicitly
    // before the "ready" branch of the component can be exercised.
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

describe('IntegrationsTab — preserved contracts', () => {
    it('skips script injection when window.FB already exists', () => {
        window.FB = { login: vi.fn(), init: vi.fn() };
        render(<IntegrationsTab />);
        expect(document.getElementById('facebook-jssdk')).toBeNull();
    });

    it('injects the facebook-jssdk script and initializes FB with the exact config on load', () => {
        render(<IntegrationsTab />);

        const script = document.getElementById('facebook-jssdk');
        expect(script).toBeTruthy();
        expect(script.src).toBe('https://connect.facebook.net/en_US/sdk.js');

        const initSpy = vi.fn();
        window.FB = { init: initSpy, login: vi.fn() };
        window.fbAsyncInit();

        expect(initSpy).toHaveBeenCalledWith({
            appId: import.meta.env.VITE_FACEBOOK_APP_ID,
            cookie: true,
            xfbml: true,
            version: 'v19.0',
        });
    });

    it('does not insert a second script tag on re-invocation', () => {
        mountAndLoadSdk({ init: vi.fn(), login: vi.fn() });
        const before = document.querySelectorAll('#facebook-jssdk').length;
        expect(before).toBe(1);

        const { unmount } = render(<IntegrationsTab />);
        expect(document.querySelectorAll('#facebook-jssdk').length).toBe(before);
        unmount();
    });

    it('disables Connect Facebook until the SDK finishes loading', () => {
        // Native disabled buttons do not dispatch click, so the component's own
        // "SDK not loaded yet" showError branch is unreachable through a real
        // click while disabled — the disabled state itself is the guard.
        render(<IntegrationsTab />);
        expect(screen.getByRole('button', { name: /Connect Facebook/i })).toBeDisabled();
    });

    it('calls FB.login with the exact frozen scope string once the SDK is ready', () => {
        const loginMock = vi.fn();
        mountAndLoadSdk({ init: vi.fn(), login: loginMock });

        fireEvent.click(screen.getByRole('button', { name: /Connect Facebook/i }));

        expect(loginMock).toHaveBeenCalledWith(expect.any(Function), {
            scope: 'pages_show_list,pages_read_engagement,leads_retrieval,pages_manage_metadata,pages_manage_ads',
        });
    });

    it('reports a cancelled/failed login (status !== unknown) with the frozen message', () => {
        let loginCallback;
        mountAndLoadSdk({ init: vi.fn(), login: (cb) => { loginCallback = cb; } });

        fireEvent.click(screen.getByRole('button', { name: /Connect Facebook/i }));
        loginCallback({ status: 'not_authorized' });

        expect(toastMocks.showError).toHaveBeenCalledWith('Facebook login failed or was cancelled.');
    });

    it('stays silent when the login popup is simply closed (status === unknown)', () => {
        let loginCallback;
        mountAndLoadSdk({ init: vi.fn(), login: (cb) => { loginCallback = cb; } });

        fireEvent.click(screen.getByRole('button', { name: /Connect Facebook/i }));
        loginCallback({ status: 'unknown' });

        expect(toastMocks.showError).not.toHaveBeenCalled();
    });

    it('auto-selects the first Graph API page and calls connectFacebookPage with the exact payload', async () => {
        let loginCallback;
        const fetchMock = vi.fn().mockResolvedValue({
            json: async () => ({
                data: [
                    { id: 'artificial-page-1', name: 'Artificial Page One' },
                    { id: 'artificial-page-2', name: 'Artificial Page Two' },
                ],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        mountAndLoadSdk({ init: vi.fn(), login: (cb) => { loginCallback = cb; } });
        fireEvent.click(screen.getByRole('button', { name: /Connect Facebook/i }));
        loginCallback({ authResponse: { accessToken: 'artificial-short-lived-token' } });

        await waitFor(() => expect(connectFacebookPage).toHaveBeenCalledWith({
            shortLivedUserToken: 'artificial-short-lived-token',
            pageId: 'artificial-page-1',
            pageName: 'Artificial Page One',
        }));
        expect(fetchMock).toHaveBeenCalledWith(
            'https://graph.facebook.com/v19.0/me/accounts?access_token=artificial-short-lived-token',
        );
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith(
            'Successfully connected Facebook Page: Artificial Page One',
        ));
    });

    it('reports the frozen no-pages message when Graph API returns none', async () => {
        let loginCallback;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ data: [] }) }));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        mountAndLoadSdk({ init: vi.fn(), login: (cb) => { loginCallback = cb; } });
        fireEvent.click(screen.getByRole('button', { name: /Connect Facebook/i }));
        loginCallback({ authResponse: { accessToken: 'artificial-token' } });

        await waitFor(() => expect(toastMocks.showError)
            .toHaveBeenCalledWith('No Facebook Pages found for this user.'));
        expect(connectFacebookPage).not.toHaveBeenCalled();
    });

    it('reports a connectFacebookPage failure with the callable message', async () => {
        let loginCallback;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: async () => ({ data: [{ id: 'artificial-page-1', name: 'Artificial Page One' }] }),
        }));
        connectFacebookPage.mockRejectedValue(new Error('artificial callable failure'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        mountAndLoadSdk({ init: vi.fn(), login: (cb) => { loginCallback = cb; } });
        fireEvent.click(screen.getByRole('button', { name: /Connect Facebook/i }));
        loginCallback({ authResponse: { accessToken: 'artificial-token' } });

        await waitFor(() => expect(toastMocks.showError)
            .toHaveBeenCalledWith('artificial callable failure'));
    });

    it('has no persisted connected-state: a remount forgets the connection', async () => {
        let loginCallback;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: async () => ({ data: [{ id: 'artificial-page-1', name: 'Artificial Page One' }] }),
        }));

        const { unmount } = mountAndLoadSdk({ init: vi.fn(), login: (cb) => { loginCallback = cb; } });
        fireEvent.click(screen.getByRole('button', { name: /Connect Facebook/i }));
        loginCallback({ authResponse: { accessToken: 'artificial-token' } });

        await waitFor(() => expect(screen.getByRole('button', { name: /^Connected$/ })).toBeDisabled());
        unmount();

        render(<IntegrationsTab />);
        expect(screen.getByRole('button', { name: /Connect Facebook/i })).toBeInTheDocument();
    });
});
