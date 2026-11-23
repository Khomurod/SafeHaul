import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';
import { GMAIL_NOT_CONNECTED } from './useSmtpSettingsDraft';

/** Google's consent page: the only place Connect Gmail sends the browser. */
const GOOGLE_ACCOUNTS = 'https://accounts.google.com';

function isGoogleConsentPage(url) {
    try {
        return new URL(url).origin === GOOGLE_ACCOUNTS;
    } catch {
        return false;
    }
}

/**
 * Settings → Email's Send from Gmail: Connect (or Reconnect), Disconnect and
 * Send test email, for a company admin.
 *
 * Whether Gmail is connected is `getEmailSettingsMeta`'s `settings.gmail`,
 * which `useSmtpSettingsDraft` loads with the rest of the tab, so this reads
 * nothing itself: `gmail` comes in, and `setGmail` takes the disconnect.
 *
 * - `connect()` asks `startGmailConnection` for Google's consent page and goes
 *   there; Google brings the admin back to `/oauth/google/callback`
 *   (`GmailReturnScreen`), which finishes the connection.
 * - `disconnect()` calls `disconnectGmail`; the mail-server settings, kept all
 *   along, are used again.
 * - `sendTest()` calls `sendTestEmail`, which sends to the admin's own sign-in
 *   address through what the company sends with.
 *
 * A failure is logged by its code only and shown in the server's own words.
 */
export function useGmailConnection({ companyId, setGmail }) {
    const { showSuccess } = useToast();
    const [connecting, setConnecting] = useState(false);
    const [connectError, setConnectError] = useState(null);
    const [disconnecting, setDisconnecting] = useState(false);
    const [disconnectError, setDisconnectError] = useState(null);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);

    const connect = async () => {
        if (connecting) return;
        setConnecting(true);
        setConnectError(null);
        try {
            const { data } = await httpsCallable(functions, 'startGmailConnection')({ companyId });
            if (!isGoogleConsentPage(data?.url)) throw new Error('Google could not be reached. Try again in a moment.');
            // The page is leaving for Google, so it stays busy.
            window.location.assign(data.url);
        } catch (error) {
            console.warn('[useGmailConnection] Gmail connection did not start:', error?.code || 'error');
            setConnectError(plainErrorMessage(error, 'Gmail could not be connected.'));
            setConnecting(false);
        }
    };

    /** Resolves true once disconnected; on failure the dialog shows why and stays open. */
    const disconnect = async () => {
        setDisconnecting(true);
        setDisconnectError(null);
        try {
            await httpsCallable(functions, 'disconnectGmail')({ companyId });
            setGmail(GMAIL_NOT_CONNECTED);
            setTestResult(null);
            showSuccess('Gmail disconnected.');
            return true;
        } catch (error) {
            console.warn('[useGmailConnection] Gmail was not disconnected:', error?.code || 'error');
            setDisconnectError(plainErrorMessage(error, 'Gmail could not be disconnected.'));
            return false;
        } finally {
            setDisconnecting(false);
        }
    };

    const sendTest = async () => {
        if (testing) return;
        setTesting(true);
        setTestResult(null);
        try {
            const { data } = await httpsCallable(functions, 'sendTestEmail')({ companyId });
            const to = typeof data?.to === 'string' && data.to ? data.to : 'your sign-in email';
            setTestResult({ success: true, message: `A test email was sent to ${to}. Check that it arrived.` });
        } catch (error) {
            console.warn('[useGmailConnection] The test email was not sent:', error?.code || 'error');
            setTestResult({ success: false, message: plainErrorMessage(error, 'The test email was not sent.') });
        } finally {
            setTesting(false);
        }
    };

    return {
        connect,
        connecting,
        connectError,
        disconnect,
        disconnecting,
        disconnectError,
        clearDisconnectError: () => setDisconnectError(null),
        sendTest,
        testing,
        testResult,
    };
}
