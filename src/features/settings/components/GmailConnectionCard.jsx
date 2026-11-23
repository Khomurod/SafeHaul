import React, { useId, useState } from 'react';
import { Icon, AlertTriangle, CheckCircle, Mail, RefreshCw, Send } from '@design-system/icons';
import { Badge, Button, FormSection, Notice } from '@/design-system/components';
import { ConfirmDialog } from '@design-system/patterns';
import { formatDate } from '@shared/utils/helpers';

/** What Google's review video shows beside Connect Gmail: what SafeHaul may do with the account. */
const GMAIL_DISCLOSURE = "SafeHaul will send your company's emails from this account. SafeHaul can only send; it cannot read your mailbox.";

const SAVE_FIRST = 'Save or discard your changes first.';

/** Which of the four cards to show. */
function gmailCardState(gmail, switchOn) {
    if (!gmail?.connected) return 'not_connected';
    if (gmail.status === 'needs_reconnect') return 'needs_reconnect';
    return switchOn ? 'connected' : 'switched_off';
}

/** "Sending from hiring@acme.com · connected by Anna Lee on Nov 30, 2026". */
function SendingFrom({ gmail }) {
    const by = gmail.connectedByName ? ` by ${gmail.connectedByName}` : '';
    const on = gmail.connectedAt ? ` on ${formatDate(new Date(gmail.connectedAt))}` : '';
    return (
        <p className="text-ds-body text-ds-content-secondary [overflow-wrap:anywhere]">
            Sending from <strong className="text-ds-content">{gmail.email || 'your connected Gmail'}</strong>
            {(by || on) && ` · connected${by}${on}`}
        </p>
    );
}

const BADGES = {
    not_connected: { tone: 'neutral', icon: Mail, label: 'Not connected' },
    connected: { tone: 'success', icon: CheckCircle, label: 'Connected' },
    switched_off: { tone: 'success', icon: CheckCircle, label: 'Connected' },
    needs_reconnect: { tone: 'danger', icon: AlertTriangle, label: 'Needs reconnecting' },
};

/**
 * Settings → Email's Send from Gmail, for a company admin: not connected
 * (Connect Gmail), connected (Send test email, Disconnect), needs reconnecting
 * (a warning that nothing is sent, Reconnect Gmail), and connected while the
 * company's switch is off (it keeps sending until disconnected; it cannot be
 * connected again). Presentation only: `connection` is `useGmailConnection`.
 *
 * Connect and Reconnect leave the page for Google, so they wait while the page
 * holds unsaved changes (`blocked`). Disconnect asks first, and waits while the
 * page is saving (`busy`).
 */
export function GmailConnectionCard({ gmail, switchOn, connection, blocked = false, busy = false }) {
    const [confirming, setConfirming] = useState(false);
    const noteId = `gmail-save-first-${useId().replace(/:/g, '')}`;
    const state = gmailCardState(gmail, switchOn);
    const badge = BADGES[state];
    const canConnect = switchOn && (state === 'not_connected' || state === 'needs_reconnect');
    const connected = state !== 'not_connected';

    const closeDialog = () => {
        setConfirming(false);
        connection.clearDisconnectError();
    };
    const confirmDisconnect = async () => {
        if (await connection.disconnect()) setConfirming(false);
    };

    const footer = (
        <>
            {(state === 'connected' || state === 'switched_off') && (
                <Button type="button" variant="secondary" loading={connection.testing} onClick={connection.sendTest}>
                    {!connection.testing && <Icon icon={Send} size="lg" />}
                    Send test email
                </Button>
            )}
            {connected && (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>
                    Disconnect
                </Button>
            )}
            {canConnect && (
                <Button
                    type="button"
                    variant="primary"
                    loading={connection.connecting}
                    disabled={blocked}
                    aria-describedby={blocked ? noteId : undefined}
                    onClick={connection.connect}
                >
                    {!connection.connecting && <Icon icon={state === 'needs_reconnect' ? RefreshCw : Mail} size="lg" />}
                    {state === 'needs_reconnect' ? 'Reconnect Gmail' : 'Connect Gmail'}
                </Button>
            )}
        </>
    );

    return (
        <>
            <FormSection
                layout="aside"
                title="Send from Gmail"
                description={GMAIL_DISCLOSURE}
                actions={<Badge tone={badge.tone} icon={badge.icon}>{badge.label}</Badge>}
                footer={footer}
            >
                <div className="flex flex-col gap-ds-4">
                    {state === 'not_connected' && (
                        <p className="text-ds-body text-ds-content-secondary [text-wrap:pretty]">
                            Connect your company&apos;s Gmail or Google Workspace account. Google asks you to choose it and
                            to allow &ldquo;Send email on your behalf&rdquo;; then SafeHaul sends your company&apos;s emails from it.
                        </p>
                    )}
                    {connected && <SendingFrom gmail={gmail} />}

                    {state === 'needs_reconnect' && (
                        <Notice tone="danger" title="Emails are not being sent">
                            Google no longer lets SafeHaul send from this account, so every email fails until Gmail is
                            reconnected. Nothing is sent through your mail server instead.
                            {!switchOn && ' Send from Gmail is switched off for your company, so it cannot be reconnected: disconnect it to send through your mail server again.'}
                        </Notice>
                    )}
                    {state === 'switched_off' && (
                        <Notice tone="info" title="Send from Gmail is switched off">
                            This account keeps sending your company&apos;s emails until you disconnect it. Once
                            disconnected, Gmail cannot be connected again while the switch is off.
                        </Notice>
                    )}

                    {canConnect && blocked && (
                        <p id={noteId} className="text-ds-xs text-ds-content-secondary">{SAVE_FIRST}</p>
                    )}
                    {connection.connectError && (
                        <Notice tone="danger" announce="assertive" title="Gmail was not connected">
                            {connection.connectError}
                        </Notice>
                    )}
                    {connection.testResult && (
                        <Notice
                            tone={connection.testResult.success ? 'success' : 'danger'}
                            announce={connection.testResult.success ? 'polite' : 'assertive'}
                            title={connection.testResult.success ? 'Test email sent' : 'Test email not sent'}
                        >
                            {connection.testResult.message}
                        </Notice>
                    )}
                </div>
            </FormSection>

            <ConfirmDialog
                isOpen={confirming}
                tone="warning"
                title="Disconnect Gmail?"
                description={`SafeHaul stops sending from ${gmail?.email || 'this Gmail'}. Emails go out through your mail-server settings again; without them, none are sent.${switchOn ? '' : ' Gmail cannot be connected again while Send from Gmail is switched off.'}`}
                confirmLabel="Disconnect Gmail"
                loading={connection.disconnecting}
                error={connection.disconnectError}
                onConfirm={confirmDisconnect}
                onCancel={closeDialog}
            />
        </>
    );
}
