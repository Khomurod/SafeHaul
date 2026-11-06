import React, { useState } from 'react';
import { Icon, Loader2, CheckCircle, AlertTriangle, Mail, Server, HelpCircle, TestTube } from '@design-system/icons';
import {
    Badge,
    Button,
    Card,
    Disclosure,
    FormField,
    FormSection,
    Input,
    Link,
    Notice,
    Textarea,
} from '@/design-system/components';
import { PageHeader } from '@/design-system/layouts';
import { SaveBar, useUnsavedChanges } from '@/design-system/patterns';
import { PevCopiesSection } from './PevCopiesSection';
import { useSmtpSettingsDraft } from '../hooks/useSmtpSettingsDraft';
import { usePevCopiesDraft } from '../hooks/usePevCopiesDraft';
import { saveBarSummary } from '../utils/saveBarSummary';

/**
 * Settings → Email: the company's SMTP server (`useSmtpSettingsDraft`) and the
 * people verification requests copy (`usePevCopiesDraft`). Edits to either stay
 * on the page until the save bar's Save, which checks both and writes only the
 * parts changed; the company shell's leave guard watches them. Test Connection
 * checks what is typed and, when it connects, saves the server settings itself.
 */
export function EmailSettingsTab({ currentCompanyProfile }) {
    const smtp = useSmtpSettingsDraft(currentCompanyProfile?.id);
    const copies = usePevCopiesDraft(currentCompanyProfile);
    const [showGuide, setShowGuide] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);

    const dirty = smtp.dirty || copies.dirty;
    useUnsavedChanges(dirty);
    // A failure is about changes that are no longer there once the page is clean.
    if (!dirty && saveError) setSaveError(null);

    const handleSave = async () => {
        setSaveError(null);
        // Nothing is written while either part cannot be saved as it is.
        const problems = [smtp.dirty && smtp.validate(), copies.dirty && copies.validate()].filter(Boolean);
        if (problems.length > 0) {
            setSaveError(problems.join(' '));
            return;
        }
        setSaving(true);
        try {
            const failures = [];
            if (smtp.dirty) failures.push(await smtp.save());
            if (copies.dirty) failures.push(await copies.save());
            const failed = failures.filter(Boolean);
            if (failed.length > 0) setSaveError(failed.join(' '));
        } finally {
            setSaving(false);
        }
    };

    const discard = () => {
        smtp.discard();
        copies.discard();
        setSaveError(null);
    };

    // Show loading state while callable fetches settings
    if (smtp.loading) {
        return (
            <div className="space-y-ds-6" data-testid="email-settings">
                <PageHeader title="Email" description="Loading email settings…" />
                <p
                    role="status"
                    className="flex items-center justify-center gap-ds-2 py-24 text-ds-content-muted"
                >
                    <Icon icon={Loader2} size="3xl" className="animate-spin" />
                    Loading email settings…
                </p>
            </div>
        );
    }

    const { form, testResult } = smtp;
    const changed = [...smtp.changed, ...(copies.dirty ? ['Verification copies'] : [])];

    return (
        <div className="space-y-ds-6" data-testid="email-settings">
            <PageHeader
                title="Email"
                description="Configure your company's email server to send automated messages directly from your domain."
            />

            {/* Connection Status Banner */}
            <Card padding="md" aria-label="Email connection status">
                {smtp.isConnected ? (
                    <div className="flex flex-col gap-ds-2">
                        <Badge tone="success" icon={CheckCircle}>Successfully Linked</Badge>
                        <p className="text-ds-sm text-ds-content">
                            Currently linked and sending emails as: <strong>{smtp.savedUser}</strong>
                        </p>
                        <p className="text-ds-sm text-ds-content">
                            This email account is automatically being used to safely send <strong>E-Docs</strong> and <strong>Previous Employment Verification (PEV)</strong> forms.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-ds-2">
                        <Badge tone="warning" icon={AlertTriangle}>Not Connected / Unverified</Badge>
                        <p className="text-ds-sm text-ds-content">
                            Please enter your credentials and run a Test Connection to verify your email setup.
                        </p>
                    </div>
                )}
            </Card>

            {/* SMTP Configuration */}
            <FormSection title="SMTP Server Configuration">
                <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-2">
                    <FormField
                        className="md:col-span-2"
                        id="email-smtp-host"
                        label="SMTP Host"
                        required
                        description="Example: smtp.gmail.com, smtp.office365.com"
                    >
                        <Input
                            type="text"
                            value={form.smtpHost || ''}
                            onChange={e => smtp.setField('smtpHost', e.target.value)}
                            placeholder="smtp.gmail.com"
                        />
                    </FormField>

                    <FormField
                        id="email-smtp-port"
                        label="SMTP Port"
                        required
                        description="Common: 587 (TLS), 465 (SSL), 25"
                    >
                        <Input
                            type="number"
                            min="1"
                            max="65535"
                            value={form.smtpPort || 587}
                            onChange={e => smtp.setField('smtpPort', parseInt(e.target.value))}
                            placeholder="587"
                        />
                    </FormField>

                    <FormField id="email-smtp-user" label="SMTP Username" required>
                        <Input
                            type="email"
                            value={form.smtpUser || ''}
                            onChange={e => smtp.setField('smtpUser', e.target.value)}
                            placeholder="your-email@company.com"
                        />
                    </FormField>

                    <FormField
                        className="md:col-span-2"
                        id="email-smtp-password"
                        label="SMTP Password"
                        required={!smtp.hasPassword}
                        description={smtp.hasPassword
                            ? 'Password already saved. Enter a new password only if you want to change it.'
                            : 'For Gmail, use an App Password, not your regular password.'}
                    >
                        <Input
                            type="password"
                            value={smtp.password}
                            onChange={e => smtp.setPassword(e.target.value)}
                            placeholder={smtp.hasPassword ? 'Password is saved but hidden. Enter new to rotate.' : '••••••••••••'}
                        />
                    </FormField>
                </div>

                {/* Test Connection */}
                <div className="border-t border-ds-border-subtle pt-ds-4">
                    <Button
                        type="button"
                        variant="secondary"
                        loading={smtp.testing}
                        // Not while Save is writing: both write the same settings.
                        disabled={!form.smtpHost || !form.smtpUser || !smtp.password || saving}
                        onClick={smtp.test}
                    >
                        {!smtp.testing && <Icon icon={TestTube} size="lg" />}
                        Test Connection
                    </Button>

                    {testResult && (
                        /* Tone and announcement both follow the same test the
                           hand-built version already ran. This is the "tone from
                           a lookup" shape 6a counted separately and could not
                           classify from a line — and it is exactly what `tone`
                           and `announce` being props is for.
                           The inner `Badge` goes: it was standing in for a
                           title, and a chip inside a message says the state
                           twice once the block has a glyph of its own. */
                        <Notice
                            tone={testResult.success ? 'success' : 'danger'}
                            announce={testResult.success ? 'polite' : 'assertive'}
                            title={testResult.success ? 'Connection Connected & Saved!' : 'Connection Failed'}
                            className="mt-ds-4"
                        >
                            {testResult.message}
                        </Notice>
                    )}
                </div>
            </FormSection>

            {/* Email Signature */}
            <FormSection title="Email Signature (Optional)">
                <FormField
                    id="email-signature"
                    label="Default Signature"
                    description="This signature will be automatically appended to all outgoing emails."
                >
                    <Textarea
                        value={form.signature || ''}
                        onChange={e => smtp.setField('signature', e.target.value)}
                        placeholder={"Best regards,\n[Your Name]\n[Your Company]"}
                    />
                </FormField>
            </FormSection>

            <PevCopiesSection text={copies.text} error={copies.error} onChange={copies.onChange} />

            {/* Setup Guide (feature-owned content) */}
            <Card padding="md">
                <Disclosure
                    variant="card"
                    title="How to Set Up SMTP"
                    description="Step-by-step guides for Gmail, Outlook, and SendGrid"
                    leading={
                        <span className="rounded-ds-md bg-ds-action-primary p-ds-2">
                            <Icon icon={HelpCircle} size="2xl" className="text-ds-content-inverse" />
                        </span>
                    }
                    open={showGuide}
                    onToggle={setShowGuide}
                >
                    <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                        {/* Gmail Guide */}
                        <div className="rounded-ds-md border border-ds-border-subtle bg-ds-surface p-5 shadow-ds-xs">
                            <h4 className="font-bold text-ds-content text-ds-heading-md mb-ds-3 flex items-center gap-2">
                                <Icon icon={Mail} size="xl" className="text-ds-status-danger-fg" />
                                Gmail / Google Workspace
                            </h4>
                            <ol className="space-y-ds-2 text-ds-body text-ds-content-secondary list-decimal list-inside">
                                <li>Go to your <Link href="https://myaccount.google.com/" external>Google Account</Link></li>
                                <li>Navigate to <strong>Security</strong> → <strong>2-Step Verification</strong> (you must enable this first)</li>
                                <li>Scroll down and click <strong>App passwords</strong></li>
                                <li>Select app: <strong>Mail</strong>, Select device: <strong>Other (Custom name)</strong></li>
                                <li>Enter "SafeHaul" and click <strong>Generate</strong></li>
                                <li>Copy the 16-character password (e.g., <code className="bg-ds-surface-subtle px-1 rounded-ds-sm">xxxx xxxx xxxx xxxx</code>)</li>
                            </ol>
                            <div className="mt-4 p-3 bg-ds-status-info-bg rounded-ds-sm border border-ds-status-info-border">
                                <p className="text-ds-body font-semibold text-ds-status-info-fg">Configuration:</p>
                                <ul className="text-ds-xs text-ds-status-info-fg mt-ds-1 space-y-ds-1">
                                    <li>• <strong>Host:</strong> smtp.gmail.com</li>
                                    <li>• <strong>Port:</strong> 587</li>
                                    <li>• <strong>Username:</strong> your-email@gmail.com</li>
                                    <li>• <strong>Password:</strong> [App Password from step 6]</li>
                                </ul>
                            </div>
                        </div>

                        {/* Outlook Guide */}
                        <div className="rounded-ds-md border border-ds-border-subtle bg-ds-surface p-5 shadow-ds-xs">
                            <h4 className="font-bold text-ds-content text-ds-heading-md mb-ds-3 flex items-center gap-2">
                                <Icon icon={Mail} size="xl" className="text-ds-status-info-fg" />
                                Outlook / Microsoft 365
                            </h4>
                            <ol className="space-y-ds-2 text-ds-body text-ds-content-secondary list-decimal list-inside">
                                <li>Ensure your Microsoft account has <strong>SMTP authentication enabled</strong></li>
                                <li>For Microsoft 365 admins: Go to <strong>Exchange Admin Center</strong> → <strong>Settings</strong> → Enable SMTP AUTH</li>
                                <li>Use your regular Outlook email and password (or create an app-specific password if using MFA)</li>
                            </ol>
                            <div className="mt-4 p-3 bg-ds-status-info-bg rounded-ds-sm border border-ds-status-info-border">
                                <p className="text-ds-body font-semibold text-ds-status-info-fg">Configuration:</p>
                                <ul className="text-ds-xs text-ds-status-info-fg mt-ds-1 space-y-ds-1">
                                    <li>• <strong>Host:</strong> smtp.office365.com</li>
                                    <li>• <strong>Port:</strong> 587</li>
                                    <li>• <strong>Username:</strong> your-email@outlook.com (or company domain)</li>
                                    <li>• <strong>Password:</strong> [Your Outlook password or app password]</li>
                                </ul>
                            </div>
                        </div>

                        {/* SendGrid Guide */}
                        <div className="rounded-ds-md border border-ds-border-subtle bg-ds-surface p-5 shadow-ds-xs">
                            <h4 className="font-bold text-ds-content text-ds-heading-md mb-ds-3 flex items-center gap-2">
                                <Icon icon={Server} size="xl" className="text-ds-status-accent-fg" />
                                SendGrid (Recommended for High Volume)
                            </h4>
                            <ol className="space-y-ds-2 text-ds-body text-ds-content-secondary list-decimal list-inside">
                                <li>Sign up for a free SendGrid account at <Link href="https://sendgrid.com/" external>sendgrid.com</Link></li>
                                <li>Go to <strong>Settings</strong> → <strong>API Keys</strong></li>
                                <li>Click <strong>Create API Key</strong></li>
                                <li>Name: "SafeHaul SMTP", Permissions: <strong>Full Access</strong> (or Mail Send only)</li>
                                <li>Copy the generated API key (starts with <code className="bg-ds-surface-subtle px-1 rounded-ds-sm">SG.</code>)</li>
                            </ol>
                            <div className="mt-4 p-3 bg-ds-status-accent-bg rounded-ds-sm border border-ds-status-accent-border">
                                <p className="text-ds-body font-semibold text-ds-status-accent-fg">Configuration:</p>
                                <ul className="text-ds-xs text-ds-status-accent-fg mt-ds-1 space-y-ds-1">
                                    <li>• <strong>Host:</strong> smtp.sendgrid.net</li>
                                    <li>• <strong>Port:</strong> 587</li>
                                    <li>• <strong>Username:</strong> apikey (exactly as written)</li>
                                    <li>• <strong>Password:</strong> [Your SendGrid API key from step 5]</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </Disclosure>
            </Card>

            {dirty && (
                <SaveBar
                    summary={saveBarSummary(changed)}
                    // A successful Test Connection saves the server settings too.
                    saving={saving || smtp.testing}
                    error={saveError}
                    onSave={handleSave}
                    onDiscard={discard}
                />
            )}
        </div>
    );
}
