import React, { useState, useEffect } from 'react';
import { httpsCallable } from "firebase/functions";
import { functions } from '@lib/firebase';
import {
    Save, Loader2, CheckCircle, AlertTriangle, Mail, Server,
    HelpCircle, ChevronDown, ChevronUp, TestTube,
} from 'lucide-react';
import { useToast } from '@shared/components/feedback';
import {
    Badge,
    Button,
    Card,
    FormField,
    FormSection,
    Input,
    Textarea,
} from '@/design-system/components';

export function EmailSettingsTab({ currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const [emailSettings, setEmailSettings] = useState({
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        // NOTE: smtpPass is intentionally NOT stored in this state object.
        // The password lives only in the admin-only subcollection on the server.
        signature: '',
        isVerified: false
    });
    // Password input state — NEVER hydrated from any source, always starts empty.
    const [smtpPassInput, setSmtpPassInput] = useState('');
    // Tracks whether the company already has an SMTP password saved (from callable)
    const [hasExistingPassword, setHasExistingPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [showGuide, setShowGuide] = useState(false);
    const [settingsLoading, setSettingsLoading] = useState(true);

    // REFACTOR: Load settings via callable — never read smtpPass from Firestore directly.
    // The getEmailSettingsMeta callable returns sanitized data (hasPassword flag, no actual password).
    useEffect(() => {
        if (!currentCompanyProfile?.id) {
            setSettingsLoading(false);
            return;
        }

        const loadSettings = async () => {
            setSettingsLoading(true);
            try {
                const getMetaFn = httpsCallable(functions, 'getEmailSettingsMeta');
                const result = await getMetaFn({ companyId: currentCompanyProfile.id });

                if (result.data?.success && result.data.settings) {
                    const meta = result.data.settings;
                    setEmailSettings(prev => ({
                        ...prev,
                        smtpHost: meta.smtpHost || '',
                        smtpPort: meta.smtpPort || 587,
                        smtpUser: meta.smtpUser || '',
                        signature: meta.signature || '',
                        isVerified: meta.isVerified || false,
                    }));
                    setHasExistingPassword(meta.hasPassword || false);
                    // IMPORTANT: smtpPassInput stays empty — never hydrated
                }
            } catch (err) {
                console.warn('[EmailSettingsTab] Failed to load settings meta:', err.message);
                // Gracefully degrade — settings form still usable for first-time setup
            } finally {
                setSettingsLoading(false);
            }
        };

        loadSettings();
    }, [currentCompanyProfile?.id]);

    const handleTestConnection = async () => {
        // Test connection always requires a plaintext password from user input.
        if (!smtpPassInput) {
            showError('Please enter your SMTP password to test the connection.');
            return;
        }

        setTesting(true);
        setTestResult(null);

        try {
            const testEmailConnectionFn = httpsCallable(functions, 'testEmailConnection');
            const result = await testEmailConnectionFn({
                smtpHost: emailSettings.smtpHost,
                smtpPort: emailSettings.smtpPort,
                smtpUser: emailSettings.smtpUser,
                smtpPass: smtpPassInput, // Always plaintext from user input
            });

            if (result.data.success) {
                const verifiedSettings = { ...emailSettings, isVerified: true };
                setEmailSettings(verifiedSettings);

                // Auto-save on successful test
                try {
                    const saveSettingsFn = httpsCallable(functions, 'saveEmailSettings');
                    await saveSettingsFn({
                        companyId: currentCompanyProfile.id,
                        smtpHost: emailSettings.smtpHost,
                        smtpPort: emailSettings.smtpPort,
                        smtpUser: emailSettings.smtpUser,
                        smtpPass: smtpPassInput, // Always plaintext from user input
                        signature: emailSettings.signature,
                    });
                    setHasExistingPassword(true); // Password now saved
                    setTestResult({ success: true, message: 'Settings verified and saved securely!' });
                    showSuccess('✅ Connection successful and settings saved!');
                } catch (saveError) {
                    console.error('Save error:', saveError);
                    setTestResult({ success: false, message: 'Verified but failed to save to database.' });
                    showError('Verified but failed to save.');
                }
            } else {
                setTestResult({ success: false, message: result.data.error });
                showError(`Connection failed: ${result.data.error}`);
            }
        } catch (error) {
            console.error('Test connection error:', error);
            setTestResult({
                success: false,
                message: error.message || 'Failed to test connection'
            });
            showError('Connection test failed. Please check your credentials.');
        } finally {
            setTesting(false);
        }
    };

    const handleSaveEmailSettings = async () => {
        // Validate required fields
        if (!emailSettings.smtpHost || !emailSettings.smtpUser) {
            showError('Please fill in SMTP Host and Username.');
            return;
        }
        if (!smtpPassInput && !hasExistingPassword) {
            showError('Please enter your SMTP password.');
            return;
        }

        setLoading(true);
        try {
            const saveSettingsFn = httpsCallable(functions, 'saveEmailSettings');
            // PARTIAL UPDATE: Only include smtpPass if user entered a new one.
            // If empty, the backend will preserve the existing password in the subcollection.
            const payload = {
                companyId: currentCompanyProfile.id,
                smtpHost: emailSettings.smtpHost,
                smtpPort: emailSettings.smtpPort,
                smtpUser: emailSettings.smtpUser,
                signature: emailSettings.signature,
            };
            if (smtpPassInput) {
                payload.smtpPass = smtpPassInput; // Only send plaintext if user typed a new password
            }
            await saveSettingsFn(payload);
            if (smtpPassInput) setHasExistingPassword(true);
            showSuccess('Email settings saved securely!');
            setTestResult(null);
        } catch (error) {
            console.error("Error saving email settings:", error);
            showError("Failed to save email settings.");
        } finally {
            setLoading(false);
        }
    };

    // Show loading state while callable fetches settings
    if (settingsLoading) {
        return (
            <div className="max-w-4xl animate-in fade-in" data-testid="email-settings">
                <header className="border-b border-ds-border-subtle pb-ds-4">
                    <h2 className="text-ds-heading-lg font-bold text-ds-content">Email Integration</h2>
                    <p className="mt-ds-1 text-ds-sm text-ds-content-muted">Loading email settings…</p>
                </header>
                <p
                    role="status"
                    className="flex items-center justify-center gap-ds-2 py-24 text-ds-content-muted"
                >
                    <Loader2 className="animate-spin" size={32} aria-hidden="true" />
                    Loading email settings…
                </p>
            </div>
        );
    }

    const isConnected = emailSettings.isVerified && emailSettings.smtpUser;

    return (
        <div className="max-w-4xl animate-in fade-in space-y-ds-8 pb-12" data-testid="email-settings">
            <header className="border-b border-ds-border-subtle pb-ds-4">
                <h2 className="text-ds-heading-lg font-bold text-ds-content">Email Integration</h2>
                <p className="mt-ds-1 text-ds-sm text-ds-content-muted">
                    Configure your company&apos;s email server to send automated messages directly from your domain.
                </p>
            </header>

            {/* Connection Status Banner */}
            <Card padding="md" aria-label="Email connection status">
                {isConnected ? (
                    <div className="flex flex-col gap-ds-2">
                        <Badge tone="success" icon={CheckCircle}>Successfully Linked</Badge>
                        <p className="text-ds-sm text-ds-content">
                            Currently linked and sending emails as: <strong>{emailSettings.smtpUser}</strong>
                        </p>
                        <p className="text-ds-sm text-ds-content">
                            This email account is automatically being used to safely send **E-Docs** and **Previous Employment Verification (PEV)** forms.
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
                            value={emailSettings.smtpHost || ''}
                            onChange={e => setEmailSettings({ ...emailSettings, smtpHost: e.target.value, isVerified: false })}
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
                            value={emailSettings.smtpPort || 587}
                            onChange={e => setEmailSettings({ ...emailSettings, smtpPort: parseInt(e.target.value), isVerified: false })}
                            placeholder="587"
                        />
                    </FormField>

                    <FormField id="email-smtp-user" label="SMTP Username" required>
                        <Input
                            type="email"
                            value={emailSettings.smtpUser || ''}
                            onChange={e => setEmailSettings({ ...emailSettings, smtpUser: e.target.value, isVerified: false })}
                            placeholder="your-email@company.com"
                        />
                    </FormField>

                    <FormField
                        className="md:col-span-2"
                        id="email-smtp-password"
                        label="SMTP Password"
                        required={!hasExistingPassword}
                        description={hasExistingPassword
                            ? 'Password already saved. Enter a new password only if you want to change it.'
                            : 'For Gmail, use an App Password, not your regular password.'}
                    >
                        <Input
                            type="password"
                            value={smtpPassInput}
                            onChange={e => { setSmtpPassInput(e.target.value); setEmailSettings(prev => ({ ...prev, isVerified: false })); }}
                            placeholder={hasExistingPassword ? 'Password is saved but hidden. Enter new to rotate.' : '••••••••••••'}
                        />
                    </FormField>
                </div>

                {/* Test Connection */}
                <div className="border-t border-ds-border-subtle pt-ds-4">
                    <Button
                        type="button"
                        variant="secondary"
                        size="lg"
                        loading={testing}
                        disabled={!emailSettings.smtpHost || !emailSettings.smtpUser || !smtpPassInput}
                        onClick={handleTestConnection}
                    >
                        {!testing && <TestTube size={18} aria-hidden="true" />}
                        Test Connection
                    </Button>

                    {testResult && (
                        <div
                            role={testResult.success ? 'status' : 'alert'}
                            className={`mt-ds-4 rounded-ds-lg border p-ds-4 ${testResult.success
                                ? 'border-ds-status-success-border bg-ds-status-success-bg'
                                : 'border-ds-status-danger-border bg-ds-status-danger-bg'}`}
                        >
                            <Badge
                                tone={testResult.success ? 'success' : 'danger'}
                                icon={testResult.success ? CheckCircle : AlertTriangle}
                            >
                                {testResult.success ? 'Connection Connected & Saved!' : 'Connection Failed'}
                            </Badge>
                            <p className="mt-ds-2 text-ds-sm text-ds-content">{testResult.message}</p>
                        </div>
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
                        value={emailSettings.signature || ''}
                        onChange={e => setEmailSettings({ ...emailSettings, signature: e.target.value })}
                        placeholder={"Best regards,\n[Your Name]\n[Your Company]"}
                    />
                </FormField>
            </FormSection>

            {/* Setup Guide (feature-owned content) */}
            <Card padding="md">
                <h3 className="m-0">
                    <button
                        type="button"
                        onClick={() => setShowGuide(!showGuide)}
                        aria-expanded={showGuide}
                        aria-controls="email-setup-guide"
                        className="flex w-full items-center justify-between gap-ds-3 rounded-ds-lg text-left focus-visible:outline-none focus-visible:shadow-ds-focus"
                    >
                        <span className="flex items-center gap-ds-3">
                            <span className="rounded-ds-md bg-ds-action-primary p-2">
                                <HelpCircle className="text-ds-content-inverse" size={24} aria-hidden="true" />
                            </span>
                            <span>
                                <span className="block text-ds-heading-sm font-bold text-ds-content">How to Set Up SMTP</span>
                                <span className="block text-ds-sm text-ds-content-muted">Step-by-step guides for Gmail, Outlook, and SendGrid</span>
                            </span>
                        </span>
                        {showGuide
                            ? <ChevronUp className="text-ds-content-link" size={24} aria-hidden="true" />
                            : <ChevronDown className="text-ds-content-link" size={24} aria-hidden="true" />}
                    </button>
                </h3>

                {showGuide && (
                    <div id="email-setup-guide" className="mt-6 space-y-6 animate-in fade-in slide-in-from-top-2">
                        {/* Gmail Guide */}
                        <div className="bg-ds-surface rounded-lg p-5 border border-ds-border-subtle shadow-sm">
                            <h4 className="font-bold text-ds-content text-lg mb-3 flex items-center gap-2">
                                <Mail className="text-ds-status-danger-fg" size={20} />
                                Gmail / Google Workspace
                            </h4>
                            <ol className="space-y-2 text-sm text-ds-content-secondary list-decimal list-inside">
                                <li>Go to your <a href="https://myaccount.google.com/" target="_blank" rel="noopener noreferrer" className="text-ds-content-link underline">Google Account</a></li>
                                <li>Navigate to <strong>Security</strong> → <strong>2-Step Verification</strong> (you must enable this first)</li>
                                <li>Scroll down and click <strong>App passwords</strong></li>
                                <li>Select app: <strong>Mail</strong>, Select device: <strong>Other (Custom name)</strong></li>
                                <li>Enter "SafeHaul" and click <strong>Generate</strong></li>
                                <li>Copy the 16-character password (e.g., <code className="bg-ds-surface-subtle px-1 rounded">xxxx xxxx xxxx xxxx</code>)</li>
                            </ol>
                            <div className="mt-4 p-3 bg-ds-status-info-bg rounded border border-ds-status-info-border">
                                <p className="text-sm font-semibold text-ds-status-info-fg">Configuration:</p>
                                <ul className="text-xs text-ds-status-info-fg mt-1 space-y-1">
                                    <li>• <strong>Host:</strong> smtp.gmail.com</li>
                                    <li>• <strong>Port:</strong> 587</li>
                                    <li>• <strong>Username:</strong> your-email@gmail.com</li>
                                    <li>• <strong>Password:</strong> [App Password from step 6]</li>
                                </ul>
                            </div>
                        </div>

                        {/* Outlook Guide */}
                        <div className="bg-ds-surface rounded-lg p-5 border border-ds-border-subtle shadow-sm">
                            <h4 className="font-bold text-ds-content text-lg mb-3 flex items-center gap-2">
                                <Mail className="text-ds-status-info-fg" size={20} />
                                Outlook / Microsoft 365
                            </h4>
                            <ol className="space-y-2 text-sm text-ds-content-secondary list-decimal list-inside">
                                <li>Ensure your Microsoft account has <strong>SMTP authentication enabled</strong></li>
                                <li>For Microsoft 365 admins: Go to <strong>Exchange Admin Center</strong> → <strong>Settings</strong> → Enable SMTP AUTH</li>
                                <li>Use your regular Outlook email and password (or create an app-specific password if using MFA)</li>
                            </ol>
                            <div className="mt-4 p-3 bg-ds-status-info-bg rounded border border-ds-status-info-border">
                                <p className="text-sm font-semibold text-ds-status-info-fg">Configuration:</p>
                                <ul className="text-xs text-ds-status-info-fg mt-1 space-y-1">
                                    <li>• <strong>Host:</strong> smtp.office365.com</li>
                                    <li>• <strong>Port:</strong> 587</li>
                                    <li>• <strong>Username:</strong> your-email@outlook.com (or company domain)</li>
                                    <li>• <strong>Password:</strong> [Your Outlook password or app password]</li>
                                </ul>
                            </div>
                        </div>

                        {/* SendGrid Guide */}
                        <div className="bg-ds-surface rounded-lg p-5 border border-ds-border-subtle shadow-sm">
                            <h4 className="font-bold text-ds-content text-lg mb-3 flex items-center gap-2">
                                <Server className="text-ds-status-accent-fg" size={20} />
                                SendGrid (Recommended for High Volume)
                            </h4>
                            <ol className="space-y-2 text-sm text-ds-content-secondary list-decimal list-inside">
                                <li>Sign up for a free SendGrid account at <a href="https://sendgrid.com/" target="_blank" rel="noopener noreferrer" className="text-ds-content-link underline">sendgrid.com</a></li>
                                <li>Go to <strong>Settings</strong> → <strong>API Keys</strong></li>
                                <li>Click <strong>Create API Key</strong></li>
                                <li>Name: "SafeHaul SMTP", Permissions: <strong>Full Access</strong> (or Mail Send only)</li>
                                <li>Copy the generated API key (starts with <code className="bg-ds-surface-subtle px-1 rounded">SG.</code>)</li>
                            </ol>
                            <div className="mt-4 p-3 bg-ds-status-accent-bg rounded border border-ds-status-accent-border">
                                <p className="text-sm font-semibold text-ds-status-accent-fg">Configuration:</p>
                                <ul className="text-xs text-ds-status-accent-fg mt-1 space-y-1">
                                    <li>• <strong>Host:</strong> smtp.sendgrid.net</li>
                                    <li>• <strong>Port:</strong> 587</li>
                                    <li>• <strong>Username:</strong> apikey (exactly as written)</li>
                                    <li>• <strong>Password:</strong> [Your SendGrid API key from step 5]</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                )}
            </Card>

            {/* Save */}
            <div className="flex justify-end pt-ds-2">
                <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    loading={loading}
                    disabled={!emailSettings.smtpHost || !emailSettings.smtpUser || (!smtpPassInput && !hasExistingPassword)}
                    onClick={handleSaveEmailSettings}
                >
                    {!loading && <Save size={18} aria-hidden="true" />}
                    Save Settings
                </Button>
            </div>
        </div>
    );
}
