import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callableMocks = vi.hoisted(() => ({ completeGmailConnection: vi.fn() }));
const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showInfo: vi.fn(), showError: vi.fn() }));

vi.mock('firebase/functions', () => ({ httpsCallable: (_functions, name) => callableMocks[name] }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => toastMocks }));

import { GmailReturnScreen } from './GmailReturnScreen';

const RETURN_PATH = '/oauth/google/callback';
/** A callable refusal as the web SDK reports it: `functions/<code>` and the server's sentence. */
const refusal = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });

function Settings() {
    const location = useLocation();
    return <p data-testid="settings">{`${location.pathname}${location.search}`}</p>;
}

/**
 * Opens the return page at `search`, as Google's redirect does: the browser's
 * address and the router's agree. Each test uses its own `state`, since a
 * state works once and the page shares the call for the same one.
 */
function openReturn(search, { strict = false } = {}) {
    window.history.replaceState(null, '', `${RETURN_PATH}${search}`);
    const tree = (
        <MemoryRouter initialEntries={[`${RETURN_PATH}${search}`]}>
            <Routes>
                <Route path={RETURN_PATH} element={<GmailReturnScreen />} />
                <Route path="/company/settings" element={<Settings />} />
            </Routes>
        </MemoryRouter>
    );
    return render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

let logged;
beforeEach(() => {
    vi.resetAllMocks();
    logged = ['log', 'warn', 'error', 'info', 'debug'].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => {
    logged.forEach((spy) => spy.mockRestore());
    window.history.replaceState(null, '', '/');
});

/** Everything the page wrote to the console, as text. */
const consoleText = () => logged.flatMap((spy) => spy.mock.calls.flat()).map((value) => (
    value instanceof Error ? `${value.message} ${JSON.stringify(value)}` : JSON.stringify(value)
)).join('\n');

describe('GmailReturnScreen — the code leaves the address at once', () => {
    it('clears the query before the server answers, then finishes with the code and state', async () => {
        const answer = deferred();
        callableMocks.completeGmailConnection.mockReturnValue(answer.promise);
        openReturn('?code=CODE-clears-1&state=STATE-clears-1&scope=x');

        // Still waiting on the server, and the address already holds no code.
        expect(screen.getByRole('heading', { level: 1, name: 'Connecting Gmail…' })).toBeInTheDocument();
        expect(window.location.pathname).toBe(RETURN_PATH);
        expect(window.location.search).toBe('');
        expect(window.location.href).not.toContain('CODE-clears-1');
        expect(callableMocks.completeGmailConnection).toHaveBeenCalledExactlyOnceWith({ state: 'STATE-clears-1', code: 'CODE-clears-1' });

        await act(async () => answer.resolve({ data: { email: 'hiring@acme.test' } }));

        expect(await screen.findByTestId('settings')).toHaveTextContent('/company/settings?section=email');
        expect(toastMocks.showSuccess).toHaveBeenCalledExactlyOnceWith('Gmail connected: hiring@acme.test');
    });

    it('calls the server once under StrictMode, which mounts the page twice', async () => {
        callableMocks.completeGmailConnection.mockResolvedValue({ data: { email: 'hiring@acme.test' } });
        openReturn('?code=CODE-strict&state=STATE-strict', { strict: true });

        expect(await screen.findByTestId('settings')).toHaveTextContent('/company/settings?section=email');
        expect(callableMocks.completeGmailConnection).toHaveBeenCalledOnce();
        expect(toastMocks.showSuccess).toHaveBeenCalledOnce();
    });

    it('never logs the code or the state, whatever the server answers', async () => {
        callableMocks.completeGmailConnection.mockRejectedValue(refusal('internal', 'internal'));
        openReturn('?code=CODE-secret-log&state=STATE-secret-log');

        expect(await screen.findByRole('heading', { level: 1, name: 'Gmail was not connected' })).toBeInTheDocument();
        expect(console.warn).toHaveBeenCalled();
        expect(consoleText()).not.toMatch(/CODE-secret-log|STATE-secret-log/);
        expect(document.body.textContent).not.toMatch(/CODE-secret-log|STATE-secret-log/);
    });
});

describe('GmailReturnScreen — what Google and the server answered', () => {
    it('goes back to Email settings, saying so, when the admin cancelled at Google', async () => {
        openReturn('?error=access_denied&state=STATE-cancel');

        expect(await screen.findByTestId('settings')).toHaveTextContent('/company/settings?section=email');
        expect(window.location.search).toBe('');
        expect(toastMocks.showInfo).toHaveBeenCalledExactlyOnceWith('Gmail was not connected.');
        expect(callableMocks.completeGmailConnection).not.toHaveBeenCalled();
        expect(toastMocks.showSuccess).not.toHaveBeenCalled();
    });

    it.each([
        ['expired', 'failed-precondition', 'This Gmail connection expired. Start again from Settings → Email.'],
        ['a different user', 'permission-denied', 'Sign in as the person who started connecting Gmail, then try again.'],
        ['just disconnected', 'failed-precondition', 'This Google account was disconnected a moment ago. Try again in a minute.'],
        ['too slow', 'deadline-exceeded', 'Connecting Gmail took too long. Start again from Settings → Email.'],
        ['refused by the server', 'internal', 'Gmail could not be connected. Start again from Settings → Email.'],
    ])('shows the server\'s own words when %s, with the way back', async (label, code, message) => {
        callableMocks.completeGmailConnection.mockRejectedValue(refusal(code, message));
        openReturn(`?code=CODE-${code}&state=STATE-${label.replace(/ /g, '-')}`);

        const heading = await screen.findByRole('heading', { level: 1, name: 'Gmail was not connected' });
        expect(heading).toHaveFocus();
        expect(screen.getByRole('alert')).toHaveTextContent(message);
        expect(window.location.search).toBe('');
        expect(toastMocks.showSuccess).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Back to Email settings' }));
        expect(screen.getByTestId('settings')).toHaveTextContent('/company/settings?section=email');
    });

    it('says something plain when the server never answered', async () => {
        callableMocks.completeGmailConnection.mockRejectedValue(refusal('internal', 'internal'));
        openReturn('?code=CODE-silent&state=STATE-silent');

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Gmail could not be connected.');
        expect(alert).not.toHaveTextContent(/^internal$/i);
    });

    it('calls nothing and says the connection expired when Google sent half of it back', async () => {
        openReturn('?code=CODE-half');

        expect(await screen.findByRole('alert')).toHaveTextContent('This Gmail connection expired. Start again from Settings → Email.');
        expect(callableMocks.completeGmailConnection).not.toHaveBeenCalled();
        expect(window.location.search).toBe('');
    });

    it('says Google did not connect Gmail for any other error it returns', async () => {
        openReturn('?error=server_error&state=STATE-google-error');

        expect(await screen.findByRole('alert')).toHaveTextContent('Google did not connect Gmail. Start again from Settings → Email.');
        expect(callableMocks.completeGmailConnection).not.toHaveBeenCalled();
    });

    it('goes quietly to Email settings when there is nothing to finish (Back to the cleared page)', async () => {
        openReturn('');

        expect(await screen.findByTestId('settings')).toHaveTextContent('/company/settings?section=email');
        expect(callableMocks.completeGmailConnection).not.toHaveBeenCalled();
        expect(toastMocks.showSuccess).not.toHaveBeenCalled();
        expect(toastMocks.showInfo).not.toHaveBeenCalled();
    });

    it('has no accessibility violations while connecting or once refused', async () => {
        const answer = deferred();
        callableMocks.completeGmailConnection.mockReturnValue(answer.promise);
        const { container } = openReturn('?code=CODE-axe&state=STATE-axe');
        expect((await axe(container)).violations).toEqual([]);

        await act(async () => answer.reject(refusal('failed-precondition', 'This Gmail connection expired. Start again from Settings → Email.')));
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect((await axe(container)).violations).toEqual([]);
    });
});
