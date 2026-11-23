import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callableMocks = vi.hoisted(() => ({
    startGmailConnection: vi.fn(),
    disconnectGmail: vi.fn(),
    sendTestEmail: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('firebase/functions', () => ({ httpsCallable: (_functions, name) => callableMocks[name] }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => toastMocks }));

import { useGmailConnection } from './useGmailConnection';
import { GMAIL_NOT_CONNECTED } from './useSmtpSettingsDraft';

const CONSENT = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y';
const refusal = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });

let assign;
let warn;
const setGmail = vi.fn();
const mount = () => renderHook(() => useGmailConnection({ companyId: 'company-1', setGmail }));

beforeEach(() => {
    vi.resetAllMocks();
    assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    assign.mockRestore();
    warn.mockRestore();
});

describe('useGmailConnection — connect', () => {
    it("asks the server for Google's page for this company and goes there, staying busy", async () => {
        callableMocks.startGmailConnection.mockResolvedValue({ data: { url: CONSENT } });
        const { result } = mount();

        await act(async () => { await result.current.connect(); });

        expect(callableMocks.startGmailConnection).toHaveBeenCalledExactlyOnceWith({ companyId: 'company-1' });
        expect(assign).toHaveBeenCalledExactlyOnceWith(CONSENT);
        expect(result.current.connecting).toBe(true);
        expect(result.current.connectError).toBeNull();
    });

    it("shows the server's reason when it refuses to start, and lets the admin try again", async () => {
        callableMocks.startGmailConnection.mockRejectedValue(
            refusal('failed-precondition', 'Sending from Gmail is not switched on for this company.'),
        );
        const { result } = mount();

        await act(async () => { await result.current.connect(); });

        expect(assign).not.toHaveBeenCalled();
        expect(result.current.connecting).toBe(false);
        expect(result.current.connectError).toBe('Sending from Gmail is not switched on for this company.');
    });

    it.each([
        ['another site', 'https://example.test/o/oauth2/v2/auth'],
        ['a lookalike host', 'https://accounts.google.com.example.test/x'],
        ['no address', undefined],
    ])('goes nowhere when the answer is %s', async (_label, url) => {
        callableMocks.startGmailConnection.mockResolvedValue({ data: { url } });
        const { result } = mount();

        await act(async () => { await result.current.connect(); });

        expect(assign).not.toHaveBeenCalled();
        expect(result.current.connectError).toBe('Google could not be reached. Try again in a moment.');
    });
});

describe('useGmailConnection — disconnect', () => {
    it('disconnects this company, marks Gmail not connected and says so', async () => {
        callableMocks.disconnectGmail.mockResolvedValue({ data: { disconnected: true } });
        const { result } = mount();

        let done;
        await act(async () => { done = await result.current.disconnect(); });

        expect(done).toBe(true);
        expect(callableMocks.disconnectGmail).toHaveBeenCalledExactlyOnceWith({ companyId: 'company-1' });
        expect(setGmail).toHaveBeenCalledExactlyOnceWith(GMAIL_NOT_CONNECTED);
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('Gmail disconnected.');
        expect(result.current.disconnecting).toBe(false);
    });

    it('keeps Gmail as it is and says why when the disconnect fails', async () => {
        callableMocks.disconnectGmail.mockRejectedValue(refusal('resource-exhausted', 'Too many attempts. Wait a few minutes, then try again.'));
        const { result } = mount();

        let done;
        await act(async () => { done = await result.current.disconnect(); });

        expect(done).toBe(false);
        expect(setGmail).not.toHaveBeenCalled();
        expect(result.current.disconnectError).toBe('Too many attempts. Wait a few minutes, then try again.');
        act(() => result.current.clearDisconnectError());
        expect(result.current.disconnectError).toBeNull();
    });
});

describe('useGmailConnection — send test email', () => {
    it('sends for this company and says where it went', async () => {
        callableMocks.sendTestEmail.mockResolvedValue({ data: { sent: true, to: 'admin@acme.test', from: 'hiring@acme.test' } });
        const { result } = mount();

        await act(async () => { await result.current.sendTest(); });

        expect(callableMocks.sendTestEmail).toHaveBeenCalledExactlyOnceWith({ companyId: 'company-1' });
        expect(result.current.testResult).toEqual({
            success: true,
            message: 'A test email was sent to admin@acme.test. Check that it arrived.',
        });
        expect(result.current.testing).toBe(false);
    });

    it("says the server's reason when the test email was not sent", async () => {
        callableMocks.sendTestEmail.mockRejectedValue(
            refusal('resource-exhausted', 'Five test emails were sent in the last hour. Try again later.'),
        );
        const { result } = mount();

        await act(async () => { await result.current.sendTest(); });

        expect(result.current.testResult).toEqual({
            success: false,
            message: 'Five test emails were sent in the last hour. Try again later.',
        });
        // The log names the failure's code, never an address or a message.
        expect(warn).toHaveBeenCalledWith(expect.any(String), 'functions/resource-exhausted');
    });
});
