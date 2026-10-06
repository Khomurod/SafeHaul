import React, { useCallback, useEffect, useId, useState } from 'react';
import { Icon, Bell } from '@design-system/icons';
import { Badge, Button, Card, FieldMessage } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { ConfirmDialog } from '@design-system/patterns';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { ReauthenticateModal } from '../environment/ReauthenticateModal';
import { TelegramTokenModal } from './TelegramTokenModal';
import {
    ReauthCancelledError,
    connectPlatformAlertChat,
    deletePlatformAlerts,
    describeAlertsError,
    getPlatformAlerts,
    isReauthCancelled,
    isReauthRequired,
    savePlatformAlertToken,
    sendPlatformAlertTest,
} from '../../services/platformAlerts';

/**
 * Super Admin → System Health → Telegram alerts.
 *
 * Three steps, in the order a person takes them: add a bot token from
 * @BotFather, write /start to the bot and connect that chat, send a test. Then
 * the hourly watcher (`functions/ops/watcher.js`) reports what it last saw.
 * Changes need a recent sign-in, as everywhere in this console, so a stale
 * session gets the password prompt and the action is retried once.
 */

const CHECKS = Object.freeze([
    { id: 'vision', label: 'AI reading photos' },
    { id: 'text', label: 'AI reading text' },
    { id: 'blog', label: 'Blog publishing' },
]);

function when(iso) {
    const date = iso ? new Date(iso) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : null;
}

/** One step: its words, and its buttons beside them, or below them on a phone (as Maintenance Actions). */
function Step({ number, title, children, actions }) {
    return (
        <li className="flex flex-col gap-ds-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
                <p className="font-semibold text-ds-content">{number}. {title}</p>
                <div className="mt-1 text-ds-sm text-ds-content-secondary">{children}</div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-ds-2">{actions}</div>
        </li>
    );
}

export function TelegramAlertsCard() {
    const headingId = useId();
    const { showSuccess, showError } = useToast();
    const [state, setState] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [busy, setBusy] = useState(null);
    const [tokenMode, setTokenMode] = useState(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [deleteError, setDeleteError] = useState(null);
    const [reauth, setReauth] = useState(null);

    const load = useCallback(async () => {
        setLoadError(null);
        try {
            setState(await getPlatformAlerts());
        } catch (error) {
            setLoadError(describeAlertsError(error, 'The alert settings could not be loaded.'));
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const requestReauth = useCallback(() => new Promise((resolve, reject) => {
        setReauth({ resolve, reject });
    }), []);

    /** Runs one change, re-authenticating once if the session has gone stale. */
    const runGuarded = useCallback(async (operation) => {
        try {
            return await operation();
        } catch (error) {
            if (!isReauthRequired(error)) throw error;
            await requestReauth();
            return operation();
        }
    }, [requestReauth]);

    const act = async (name, operation, success) => {
        setBusy(name);
        try {
            const result = await runGuarded(operation);
            showSuccess(success(result));
            await load();
        } catch (error) {
            if (!isReauthCancelled(error)) showError(describeAlertsError(error));
        } finally {
            setBusy(null);
        }
    };

    const saveToken = async (token) => {
        try {
            const result = await runGuarded(() => savePlatformAlertToken(token));
            setTokenMode(null);
            showSuccess(`Token saved. In Telegram, send /start to @${result.bot.username}, then press Connect chat.`);
            await load();
        } catch (error) {
            // A dismissed password prompt leaves the dialog open, saving nothing.
            if (isReauthCancelled(error)) return;
            throw new Error(describeAlertsError(error, 'The token could not be saved.'));
        }
    };

    const remove = async () => {
        setBusy('delete');
        setDeleteError(null);
        try {
            await runGuarded(() => deletePlatformAlerts());
            setConfirmingDelete(false);
            showSuccess('Telegram alerts are off, and the bot token was destroyed.');
            await load();
        } catch (error) {
            if (!isReauthCancelled(error)) setDeleteError(describeAlertsError(error));
        } finally {
            setBusy(null);
        }
    };

    const bot = state?.bot || null;
    const chat = state?.chat || null;
    const watch = state?.watch || {};
    const lastRun = when(watch.lastRunAt);

    return (
        <Card padding="md" aria-labelledby={headingId}>
            <Stack gap="md">
                <div>
                    <h3 id={headingId} className="flex items-center gap-ds-2 font-bold text-ds-content">
                        <Icon icon={Bell} size="lg" /> Telegram alerts
                    </h3>
                    <p className="mt-1 text-ds-sm text-ds-content-secondary">
                        Every hour SafeHaul checks that AI can read photos and text for users, and that the
                        blog has an article from yesterday or today. When a check fails, a message goes to
                        your Telegram, and another when it recovers. Nothing is sent while all is well.
                    </p>
                </div>

                {loadError && (
                    <div className="flex flex-wrap items-center gap-ds-2">
                        <FieldMessage tone="error">{loadError}</FieldMessage>
                        <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
                    </div>
                )}
                {!state && !loadError && <p className="text-ds-sm text-ds-content-secondary">Loading…</p>}

                {state && (
                    <ol className="space-y-ds-4">
                        <Step
                            number={1}
                            title={bot ? `Bot: @${bot.username}` : 'Add a bot token'}
                            actions={(
                                <>
                                    <Button size="sm" variant="secondary" onClick={() => setTokenMode(bot ? 'replace' : 'add')}>
                                        {bot ? 'Replace token' : 'Add token'}
                                    </Button>
                                    {bot && (
                                        <Button size="sm" variant="danger" onClick={() => { setDeleteError(null); setConfirmingDelete(true); }}>
                                            Remove
                                        </Button>
                                    )}
                                </>
                            )}
                        >
                            In Telegram, open @BotFather, send /newbot, and copy the token it sends back.
                        </Step>
                        <Step
                            number={2}
                            title={chat ? `Chat: ${chat.title}` : 'Connect your chat'}
                            actions={(
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={!bot}
                                    loading={busy === 'connect'}
                                    onClick={() => act('connect', connectPlatformAlertChat,
                                        (result) => `Connected to ${result.chat.title}. A confirmation is in your Telegram.`)}
                                >
                                    {chat ? 'Reconnect chat' : 'Connect chat'}
                                </Button>
                            )}
                        >
                            {bot ? `Send /start to @${bot.username}, then press Connect chat.` : 'Add the token first.'}
                        </Step>
                        <Step
                            number={3}
                            title="Send a test message"
                            actions={(
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={!chat}
                                    loading={busy === 'test'}
                                    onClick={() => act('test', sendPlatformAlertTest, () => 'Test message sent. Check your Telegram.')}
                                >
                                    Send test
                                </Button>
                            )}
                        >
                            {chat ? 'Check that the message arrives.' : 'Connect the chat first.'}
                        </Step>
                    </ol>
                )}

                {state && (lastRun ? (
                    <div>
                        <p className="text-ds-sm text-ds-content-secondary">Last check: {lastRun}</p>
                        <div className="mt-ds-2 flex flex-wrap gap-ds-2" role="list" aria-label="What the last check saw">
                            {CHECKS.map((check) => {
                                const status = watch.checks?.[check.id]?.status;
                                return (
                                    <span role="listitem" key={check.id}>
                                        <Badge tone={status === 'down' ? 'danger' : status === 'ok' ? 'success' : 'neutral'}>
                                            {check.label}: {status === 'down' ? 'Not working' : status === 'ok' ? 'Working' : 'Not checked'}
                                        </Badge>
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <p className="text-ds-sm text-ds-content-secondary">
                        Not checked yet. The first check runs within an hour of connecting the chat.
                    </p>
                ))}

                {watch.lastDeliveryError && (
                    <FieldMessage tone="error">
                        The last alert could not be delivered. Send /start to the bot again, press Reconnect chat,
                        and it will be sent at the next check.
                    </FieldMessage>
                )}
            </Stack>

            {tokenMode && (
                <TelegramTokenModal mode={tokenMode} onSubmit={saveToken} onCancel={() => setTokenMode(null)} />
            )}

            {confirmingDelete && (
                <ConfirmDialog
                    title="Turn off Telegram alerts?"
                    description="The bot token is destroyed and no more alerts are sent. You can connect again at any time."
                    tone="danger"
                    confirmLabel="Turn off alerts"
                    cancelLabel="Keep alerts"
                    loading={busy === 'delete'}
                    error={deleteError}
                    onConfirm={remove}
                    onCancel={() => { setConfirmingDelete(false); setDeleteError(null); }}
                />
            )}

            {reauth && (
                <ReauthenticateModal
                    onSuccess={() => {
                        const { resolve } = reauth;
                        setReauth(null);
                        resolve();
                    }}
                    onCancel={() => {
                        const { reject } = reauth;
                        setReauth(null);
                        reject(new ReauthCancelledError());
                    }}
                />
            )}
        </Card>
    );
}

export default TelegramAlertsCard;
