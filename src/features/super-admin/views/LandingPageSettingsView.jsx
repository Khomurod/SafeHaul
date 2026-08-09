import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, RefreshCw, Send, Shield } from 'lucide-react';

import {
    Badge,
    Button,
    Card,
    Checkbox,
    DataTable,
    FieldDisplay,
    FieldMessage,
    FormField,
    Input,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { useToast } from '@shared/components/feedback';

import {
    describeDeliveryCode,
    describeLandingError,
    getLandingPageSettings,
    isReauthCancelled,
    isReauthRequired,
    listLandingLeads,
    ReauthCancelledError,
    retryLandingLeadDelivery,
    sendLandingTelegramTest,
    setLandingTelegramEnabled,
    updateLandingTelegramConfig,
} from '../services/landingSettings';
import { ReauthenticateModal } from '../components/environment/ReauthenticateModal';

/**
 * Super Admin → Landing Page Settings.
 *
 * ## What this screen is for
 *
 * Two things the marketing site could not previously do without a deploy:
 * point lead notifications at a different Telegram bot or chat, and find out
 * what happened to a lead that did not arrive.
 *
 * ## Why there is no "reveal" control here
 *
 * Every other credential surface in Super Admin pairs a masked value with an
 * eye that reveals it. This one deliberately does not, and the omission is the
 * design rather than an oversight. A Telegram bot token is a bearer credential
 * that Telegram places in the request *URL*; a reveal path would add an
 * exfiltration route while solving nothing, because an operator who has lost the
 * token gets a fresh one from BotFather in seconds.
 *
 * So the token is write-only from the browser's side. To answer "is the right
 * token live?" the screen shows a SHA-256 fingerprint, the bot's public
 * username, and the last four characters of the chat id — enough to recognise
 * the credentials, not enough to reconstruct them. The server enforces this: no
 * callable behind this screen can return the value.
 *
 * Saving verifies the token against Telegram first, so a truncated paste is
 * refused immediately instead of silently breaking the next lead.
 *
 * ## Layout
 *
 * Delivery configuration and the lead list are stacked rather than split across
 * tabs. The design system has no Tabs primitive on purpose, and hand-rolling
 * one here would be exactly the local competing primitive the UI policy
 * forbids. Stacking also happens to be better: an operator diagnosing a failed
 * delivery wants the configuration and the failing rows on one screen.
 *
 * No `PageHeader`: the Super Admin masthead owns the single `<h1>`.
 */
export function LandingPageSettingsView() {
    const { showSuccess, showError, showInfo } = useToast();

    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

    const [botToken, setBotToken] = useState('');
    const [chatId, setChatId] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [testing, setTesting] = useState(false);

    const [leads, setLeads] = useState([]);
    const [leadsLoading, setLeadsLoading] = useState(false);
    const [leadsError, setLeadsError] = useState(null);
    const [retryingId, setRetryingId] = useState(null);

    const [reauth, setReauth] = useState(null);

    const headingRef = useRef(null);

    const loadSettings = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const result = await getLandingPageSettings();
            setSettings(result);
            setEnabled(result?.telegram?.enabled !== false);
        } catch (error) {
            setLoadError(describeLandingError(error, 'Landing page settings could not be loaded.'));
        } finally {
            setLoading(false);
        }
    }, []);

    const loadLeads = useCallback(async () => {
        setLeadsLoading(true);
        setLeadsError(null);
        try {
            const result = await listLandingLeads(100);
            setLeads(result.leads || []);
        } catch (error) {
            setLeadsError(describeLandingError(error, 'The lead list could not be loaded.'));
        } finally {
            setLeadsLoading(false);
        }
    }, []);

    useEffect(() => { loadSettings(); }, [loadSettings]);
    useEffect(() => { loadLeads(); }, [loadLeads]);

    const requestReauth = useCallback(() => new Promise((resolve, reject) => {
        setReauth({ resolve, reject });
    }), []);

    /**
     * Runs a privileged operation, prompting for the password once if the
     * server reports a stale session and then retrying the same operation.
     * Identical to the environment vault's contract, so operators meet one
     * behaviour across every privileged screen.
     */
    const runGuarded = useCallback(async (operation) => {
        try {
            return await operation();
        } catch (error) {
            if (!isReauthRequired(error)) throw error;
            await requestReauth();
            return operation();
        }
    }, [requestReauth]);

    const handleSave = useCallback(async (event) => {
        event.preventDefault();
        setSaving(true);
        setSaveError(null);
        try {
            await runGuarded(() => updateLandingTelegramConfig({ botToken, chatId, enabled }));
            // Clear the field the moment it is stored. Leaving a token sitting
            // in an input is the sort of thing that ends up in a screen share.
            setBotToken('');
            setChatId('');
            showSuccess('Telegram delivery updated. Send a test message to confirm it works.');
            await loadSettings();
            headingRef.current?.focus();
        } catch (error) {
            if (isReauthCancelled(error)) return;
            setSaveError(describeLandingError(error, 'Those credentials could not be saved.'));
        } finally {
            setSaving(false);
        }
    }, [botToken, chatId, enabled, loadSettings, runGuarded, showSuccess]);

    const handleToggleEnabled = useCallback(async (next) => {
        setEnabled(next);
        try {
            await runGuarded(() => setLandingTelegramEnabled(next));
            showInfo(next ? 'Lead delivery is on.' : 'Lead delivery is paused. Leads are still recorded.');
            await loadSettings();
        } catch (error) {
            if (isReauthCancelled(error)) {
                setEnabled(!next);
                return;
            }
            setEnabled(!next);
            showError(describeLandingError(error, 'That setting could not be changed.'));
        }
    }, [loadSettings, runGuarded, showError, showInfo]);

    const handleTest = useCallback(async () => {
        setTesting(true);
        try {
            const result = await runGuarded(() => sendLandingTelegramTest());
            if (result.ok) {
                showSuccess('Test message delivered. Check the chat.');
            } else {
                showError(describeDeliveryCode(result.code) || 'The test message could not be delivered.');
            }
            await loadSettings();
        } catch (error) {
            if (isReauthCancelled(error)) return;
            showError(describeLandingError(error, 'The test message could not be sent.'));
        } finally {
            setTesting(false);
        }
    }, [loadSettings, runGuarded, showError, showSuccess]);

    const handleRetry = useCallback(async (lead) => {
        setRetryingId(lead.id);
        try {
            const result = await runGuarded(() => retryLandingLeadDelivery(lead.id));
            if (result.ok) {
                showSuccess(`Delivered "${lead.fullName}" to Telegram.`);
            } else {
                showError(describeDeliveryCode(result.code) || 'That lead could not be delivered.');
            }
            await loadLeads();
        } catch (error) {
            if (isReauthCancelled(error)) return;
            showError(describeLandingError(error, 'That lead could not be delivered.'));
        } finally {
            setRetryingId(null);
        }
    }, [loadLeads, runGuarded, showError, showSuccess]);

    // Memoised so the fallback object is not a new identity on every render,
    // which would defeat the memo below it.
    const telegram = useMemo(() => settings?.telegram || {}, [settings]);

    const statusBadge = useMemo(() => {
        if (loading) return null;
        if (!telegram.configured && !telegram.secretManagerFallbackAvailable) {
            return <Badge tone="warning">Not configured</Badge>;
        }
        if (telegram.enabled === false) return <Badge tone="neutral">Paused</Badge>;
        return <Badge tone="success">Active</Badge>;
    }, [loading, telegram]);

    const leadColumns = useMemo(() => [
        {
            key: 'contact',
            header: 'Lead',
            rowHeader: true,
            priority: 'primary',
            width: 'lg',
            render: (lead) => (
                <div className="flex flex-col gap-ds-1">
                    <span className="font-medium text-ds-content">{lead.fullName || 'Unnamed'}</span>
                    <span className="text-ds-sm text-ds-content-secondary">{lead.workEmail}</span>
                </div>
            ),
        },
        {
            key: 'company',
            header: 'Company',
            priority: 'secondary',
            width: 'md',
            render: (lead) => (
                <div className="flex flex-col gap-ds-1">
                    <span className="text-ds-sm text-ds-content">{lead.companyName || '—'}</span>
                    {lead.companySize && (
                        <span className="text-ds-sm text-ds-content-secondary">{lead.companySize} drivers</span>
                    )}
                </div>
            ),
        },
        {
            key: 'stage',
            header: 'Stage',
            priority: 'secondary',
            width: 'sm',
            render: (lead) => (lead.stage === 'qualified'
                ? <Badge tone="success">Qualified</Badge>
                // A contact-only lead is not a failure: it is someone who gave
                // their details and stopped, which the old single form lost.
                : <Badge tone="info">Contact only</Badge>),
        },
        {
            key: 'delivery',
            header: 'Delivery',
            priority: 'secondary',
            width: 'sm',
            render: (lead) => {
                const status = lead.delivery?.status;
                if (status === 'delivered') return <Badge tone="success">Delivered</Badge>;
                if (status === 'disabled') return <Badge tone="neutral">Not sent</Badge>;
                if (status === 'failed') return <Badge tone="danger">Failed</Badge>;
                return <Badge tone="warning">Pending</Badge>;
            },
        },
        {
            key: 'createdAt',
            header: 'Received',
            priority: 'tertiary',
            width: 'sm',
            render: (lead) => (
                <span className="text-ds-sm text-ds-content-secondary">
                    {lead.createdAt ? new Date(lead.createdAt).toLocaleString() : '—'}
                </span>
            ),
        },
        {
            key: 'actions',
            header: 'Actions',
            priority: 'actions',
            width: 'actions',
            align: 'end',
            render: (lead) => (
                <div className="flex justify-end">
                    {lead.delivery?.status !== 'delivered' && (
                        <Button
                            size="sm"
                            variant="secondary"
                            loading={retryingId === lead.id}
                            onClick={() => handleRetry(lead)}
                        >
                            <Send size={14} aria-hidden="true" /> Resend
                        </Button>
                    )}
                </div>
            ),
        },
    ], [handleRetry, retryingId]);

    return (
        <Stack gap="lg">
            <div>
                <h2
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-ds-heading-lg font-bold text-ds-content"
                >
                    Landing Page Settings
                </h2>
                <p className="mt-1 text-ds-sm text-ds-content-secondary">
                    Where leads from safehaul.io are delivered, and what happened to each one.
                    Every submission is recorded before delivery is attempted, so an outage
                    delays a notification rather than losing a customer.
                </p>
            </div>

            {loadError && (
                <Card padding="md" tone="danger">
                    <FieldMessage tone="error">{loadError}</FieldMessage>
                    <div className="mt-ds-2">
                        <Button variant="secondary" onClick={loadSettings}>
                            <RefreshCw size={14} aria-hidden="true" /> Try again
                        </Button>
                    </div>
                </Card>
            )}

            {!loadError && (
                <Stack gap="lg">
                    <Card padding="md">
                        <div className="flex flex-wrap items-center justify-between gap-ds-3">
                            <div className="flex items-center gap-ds-2">
                                <h3 className="text-ds-heading-sm font-semibold text-ds-content">
                                    Telegram lead delivery
                                </h3>
                                {statusBadge}
                            </div>
                            <div className="flex flex-wrap gap-ds-2">
                                <Button variant="secondary" onClick={loadSettings} disabled={loading}>
                                    <RefreshCw size={14} aria-hidden="true" /> Refresh
                                </Button>
                                <Button
                                    variant="secondary"
                                    loading={testing}
                                    disabled={loading || (!telegram.configured && !telegram.secretManagerFallbackAvailable)}
                                    onClick={handleTest}
                                >
                                    <Send size={14} aria-hidden="true" /> Send test message
                                </Button>
                            </div>
                        </div>

                        <div className="mt-ds-4 grid gap-ds-4 sm:grid-cols-2">
                            <FieldDisplay label="Bot">
                                {telegram.botUsername ? `@${telegram.botUsername}` : 'Not identified'}
                            </FieldDisplay>
                            <FieldDisplay label="Destination chat">
                                {telegram.chatIdLast4 ? `Ending ${telegram.chatIdLast4}` : 'Not set'}
                            </FieldDisplay>
                            <FieldDisplay label="Token fingerprint">
                                {telegram.botTokenFingerprint || 'No stored token'}
                            </FieldDisplay>
                            <FieldDisplay label="Configuration source">
                                {telegram.source === 'firestore' && 'Managed here'}
                                {telegram.source === 'secret-manager' && 'Secret Manager (deploy-time fallback)'}
                                {telegram.source === 'none' && 'No credentials stored'}
                            </FieldDisplay>
                            <FieldDisplay label="Last changed">
                                {telegram.updatedAt
                                    ? `${new Date(telegram.updatedAt).toLocaleString()}${telegram.updatedByEmail ? ` by ${telegram.updatedByEmail}` : ''}`
                                    : 'Never'}
                            </FieldDisplay>
                            <FieldDisplay label="Last delivery">
                                {telegram.lastDelivery
                                    ? `${telegram.lastDelivery.status === 'delivered' ? 'Delivered' : 'Failed'} · ${new Date(telegram.lastDelivery.at).toLocaleString()}`
                                    : 'No attempt recorded'}
                            </FieldDisplay>
                        </div>

                        {telegram.lastDelivery?.status === 'failed' && (
                            <div className="mt-ds-3">
                                <FieldMessage tone="error">
                                    {describeDeliveryCode(telegram.lastDelivery.code)}
                                </FieldMessage>
                            </div>
                        )}
                    </Card>

                    <Card padding="md">
                        <h3 className="text-ds-heading-sm font-semibold text-ds-content">
                            Update credentials
                        </h3>
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            Create a bot with <strong>@BotFather</strong>, add it to the destination
                            group, and paste the token below. The token is verified with Telegram
                            before it is stored, encrypted at rest, and never sent back to this
                            screen — so keep your own copy.
                        </p>

                        <form className="mt-ds-4 grid gap-ds-4" onSubmit={handleSave}>
                            <FormField
                                label="Bot token"
                                description="From BotFather, in the form 123456789:AA… . Stored encrypted; it cannot be read back here."
                                required
                            >
                                <Input
                                    type="password"
                                    value={botToken}
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder="123456789:AA…"
                                    onChange={(event) => setBotToken(event.target.value)}
                                />
                            </FormField>

                            <FormField
                                label="Destination chat ID"
                                description="A numeric chat ID (negative for groups) or an @channelusername."
                                required
                            >
                                <Input
                                    type="text"
                                    value={chatId}
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder="-1001234567890"
                                    onChange={(event) => setChatId(event.target.value)}
                                />
                            </FormField>

                            {saveError && <FieldMessage tone="error">{saveError}</FieldMessage>}

                            <div className="flex flex-wrap items-center gap-ds-3">
                                <Button type="submit" loading={saving} disabled={!botToken || !chatId}>
                                    <CheckCircle2 size={14} aria-hidden="true" /> Verify and save
                                </Button>
                                <Checkbox
                                    label="Deliver new leads to Telegram"
                                    checked={enabled}
                                    onChange={(event) => handleToggleEnabled(event.target.checked)}
                                />
                            </div>
                        </form>
                    </Card>

                    <Card padding="md" tone="info">
                        <div className="flex gap-ds-3">
                            <Shield size={18} aria-hidden="true" className="mt-1 shrink-0" />
                            <div>
                                <h3 className="text-ds-heading-sm font-semibold text-ds-content">
                                    How the token is protected
                                </h3>
                                <ul className="mt-ds-2 list-disc space-y-1 pl-ds-6 text-ds-sm text-ds-content-secondary">
                                    <li>Encrypted before storage and held in a Firestore document no client can read.</li>
                                    <li>Returned by no callable, so it never reaches browser memory, storage or a URL.</li>
                                    <li>Kept out of every log line: failures are recorded as classified codes, never as the underlying error, which would carry the token in its request URL.</li>
                                    <li>Changing it requires Super Admin, a password entered in the last 15 minutes, and writes an audit record that stores no value.</li>
                                </ul>
                            </div>
                        </div>
                    </Card>
                </Stack>
            )}

            <Stack gap="md">
                <div className="flex flex-wrap items-center justify-between gap-ds-3">
                    <div>
                        <h3 className="text-ds-heading-sm font-semibold text-ds-content">
                            Captured leads
                        </h3>
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            Every submission, including the ones that stopped after giving a name
                            and an email. Those are real prospects the previous single-step form
                            discarded.
                        </p>
                    </div>
                    <Button variant="secondary" onClick={loadLeads} disabled={leadsLoading}>
                        <RefreshCw size={14} aria-hidden="true" /> Refresh
                    </Button>
                </div>

                {leadsError && (
                    <Card padding="md" tone="danger">
                        <FieldMessage tone="error">{leadsError}</FieldMessage>
                    </Card>
                )}

                <DataTable
                    ariaLabel="Leads captured from the landing page"
                    density="compact"
                    minWidth="lg"
                    data={leads}
                    columns={leadColumns}
                    isLoading={leadsLoading}
                    loadingLabel="Loading leads"
                    empty={{
                        title: 'No leads yet.',
                        description: 'Submissions from the safehaul.io forms appear here as soon as they arrive.',
                    }}
                />
            </Stack>

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
        </Stack>
    );
}

export default LandingPageSettingsView;
