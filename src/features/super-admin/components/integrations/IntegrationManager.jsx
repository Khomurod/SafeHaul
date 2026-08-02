import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { Save, Send, Database, ArrowLeft, Activity, CheckCircle } from 'lucide-react';
import { Badge, Button, Card, Checkbox, FormField, Input } from '@/design-system/components';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';
import { LineManager } from './LineManager';

/**
 * Super Admin SMS integration manager — provider credentials, sandbox toggle,
 * save/verify and test-message controls, plus the RingCentral Digital Wallet
 * (`LineManager`).
 *
 * Migrated to the design system 2026-07-28. Presentation only — every contract
 * frozen in `IntegrationManager.contract.test.jsx` is unchanged: the
 * `companies/{id}/integrations/sms_provider` read path, the initial
 * `ringcentral` / `isSandbox: true` defaults, the rule that encrypted
 * credentials are never loaded into (or rendered from) the form, the
 * `hasExistingCredentials` `:`-separator detection, the `__PRESERVE__` sentinel,
 * the RingCentral/8x8 required-credential validation and its exact wording, the
 * phone sanitisation and string coercion, the `saveIntegrationConfig` /
 * `sendTestSMS` payload shapes, and every save/verify/test toast string.
 *
 * Presentation defects fixed:
 *  - Legacy palette (`bg-white`/`bg-gray-50`/`bg-blue-*`/`text-green-600`, hex
 *    focus rings) replaced with `--ds-*` tokens and approved primitives.
 *  - Sub-12px text (`text-[10px]`/`text-[11px]` notes) removed — the 8x8 sender
 *    hint moved into the accessible `FormField` description and the info notes
 *    now use `text-ds-sm`.
 *  - The provider selector was two colour-only buttons (blue/orange ring, no
 *    programmatic selected state). It is now a `role="group"` of `Button`s with
 *    `aria-pressed`, matching the approved AnalyticsView date-range pattern.
 *  - The "credentials saved" indicator was a colour-only "✓ Saved" span; it is
 *    now a `Badge` (icon + text) and the fields keep their blank/placeholder
 *    contract.
 *  - Credential inputs had no programmatic label association; they are now
 *    `FormField` + `Input` with wired labels, required state and descriptions.
 *
 * Feature-owned: the RingCentral-only Digital Wallet (`LineManager`) is rendered
 * here but migrated separately; the provider tone choice (RingCentral vs 8x8)
 * stays feature-owned domain-to-visual mapping.
 */
export function IntegrationManager({ companyId, companyName, onBack }) {
    const { showSuccess, showError, showWarning } = useToast();
    const [provider, setProvider] = useState('ringcentral');

    // Default config state
    const [config, setConfig] = useState({
        isSandbox: true // Default to true for safety
    });

    // Track if credentials already exist (stored encrypted in Firestore)
    const [hasExistingCredentials, setHasExistingCredentials] = useState(false);

    const [testPhone, setTestPhone] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [isFetching, setIsFetching] = useState(true);
    const [fetchError, setFetchError] = useState(null);

    // 0. Load existing config on mount
    React.useEffect(() => {
        if (!companyId) {
            setIsFetching(false);
            return;
        }

        const fetchExisting = async () => {
            setIsFetching(true);
            setFetchError(null);
            try {
                const snap = await getDoc(doc(db, `companies/${companyId}/integrations`, 'sms_provider'));
                if (snap.exists()) {
                    const data = snap.data();
                    if (data.provider) setProvider(data.provider);

                    // IMPORTANT: Do NOT pre-fill clientId/clientSecret with encrypted values!
                    // The values in Firestore are encrypted. Loading them into the form and then
                    // saving would cause double-encryption. Instead, we track that credentials
                    // exist and show a placeholder. User can enter new credentials if needed.
                    const existingClientId = data.config?.clientId;
                    const existingClientSecret = data.config?.clientSecret;
                    const existingApiKey = data.config?.apiKey;
                    const existingApiSecret = data.config?.apiSecret;

                    // Check if credentials exist (encrypted values contain a colon separator)
                    const rcCredsExist = !!(existingClientId && existingClientId.includes(':'));
                    const eightCredsExist = !!(existingApiKey && existingApiKey.includes(':'));
                    setHasExistingCredentials(rcCredsExist || eightCredsExist);

                    setConfig(prev => ({
                        ...prev,
                        isSandbox: data.config?.isSandbox === 'true' || data.config?.isSandbox === true,
                        phoneNumber: data.config?.phoneNumber || '',
                        // Leave credentials empty - user enters new values if updating
                        clientId: '',
                        clientSecret: '',
                        apiKey: '',
                        apiSecret: '',
                        subAccountId: data.config?.subAccountId || ''
                    }));
                }
            } catch (err) {
                console.error("Error loading existing config:", err);
                setFetchError("Failed to load existing configuration. You can still set up new credentials.");
            } finally {
                setIsFetching(false);
            }
        };

        fetchExisting();
    }, [companyId]);

    const updateConfig = (key, val) => setConfig(prev => ({ ...prev, [key]: val }));

    const handleSave = async (e) => {
        e.preventDefault();
        if (!companyId) return showError("No company selected. Please go back and select a company first.");
        setIsLoading(true);
        try {
            // Prepare payload
            const payloadConfig = { ...config };

            // CRITICAL: If credentials exist and user didn't enter new ones, 
            // don't send empty credentials (would overwrite with blank)
            // Provider-aware credential handling
            if (provider === 'ringcentral') {
                const hasNewClientId = payloadConfig.clientId && payloadConfig.clientId.trim() !== '';
                const hasNewClientSecret = payloadConfig.clientSecret && payloadConfig.clientSecret.trim() !== '';

                if (hasExistingCredentials && !hasNewClientId) {
                    payloadConfig.clientId = '__PRESERVE__';
                }
                if (hasExistingCredentials && !hasNewClientSecret) {
                    payloadConfig.clientSecret = '__PRESERVE__';
                }

                if (!hasExistingCredentials && (!hasNewClientId || !hasNewClientSecret)) {
                    showError("Client ID and Client Secret are required.");
                    setIsLoading(false);
                    return;
                }
            } else if (provider === '8x8') {
                const hasNewApiKey = payloadConfig.apiKey && payloadConfig.apiKey.trim() !== '';
                const hasNewApiSecret = payloadConfig.apiSecret && payloadConfig.apiSecret.trim() !== '';

                if (hasExistingCredentials && !hasNewApiKey) {
                    payloadConfig.apiKey = '__PRESERVE__';
                }
                if (hasExistingCredentials && !hasNewApiSecret) {
                    payloadConfig.apiSecret = '__PRESERVE__';
                }

                if (!hasExistingCredentials && (!hasNewApiKey || !hasNewApiSecret)) {
                    showError("API Key and API Secret are required.");
                    setIsLoading(false);
                    return;
                }
            }

            // 1. Sanitize Phone Number (RingCentral needs E.164, e.g. +15551234567)
            if (payloadConfig.phoneNumber) {
                payloadConfig.phoneNumber = payloadConfig.phoneNumber.replace(/[^\d+]/g, '');
            }

            // 2. Ensure all values are strings (encryption helper expects strings)
            Object.keys(payloadConfig).forEach(key => {
                if (typeof payloadConfig[key] !== 'string' && payloadConfig[key] !== null) {
                    payloadConfig[key] = String(payloadConfig[key]);
                }
            });

            // 3. Set Server URL based on Sandbox Toggle
            // (Removed: Adapter now handles this via isSandbox flag using official SDK constants)
            // if (provider === 'ringcentral') { ... }

            const saveFn = httpsCallable(functions, 'saveIntegrationConfig');
            const result = await saveFn({ companyId, provider, config: payloadConfig });

            if (result.data?.warning) {
                showWarning(result.data.warning);
                showSuccess(`Configuration saved. (${result.data.inventoryCount || 0} numbers found)`);
            } else {
                const meta = result.data?.syncMeta;
                let msg = `Integration saved and verified successfully. (${result.data.inventoryCount || 0} numbers found)`;

                if (result.data.inventoryCount === 0 && meta) {
                    msg += ` - User: ${meta.identity || 'Unknown'} - Diagnostics: Acc(${meta.accCount}) Ext(${meta.extCount}) RawTotal(${meta.rawCount})`;
                    console.log("RingCentral Diagnostic Meta:", meta);
                }

                showSuccess(msg);
            }
        } catch (error) {
            console.error(error);
            showError(`Save Failed: ${error.message} `);
        } finally {
            setIsLoading(false);
        }
    };

    const handleTest = async () => {
        if (!testPhone) return showError("Enter a phone number to test.");
        setIsTesting(true);
        try {
            const testFn = httpsCallable(functions, 'sendTestSMS');
            const result = await testFn({ companyId, testPhoneNumber: testPhone });
            if (result.data.success) {
                showSuccess("Test Message Sent!");
            } else {
                showError("Test Failed: " + result.data.message);
            }
        } catch (error) {
            console.error(error);
            let userMessage = error.message;

            // Detect DNS / Connectivity issues
            if (error.message.includes('ENOTFOUND') || error.message.includes('network') || error.message.includes('fetch')) {
                userMessage = `The ${provider} server appears to be unreachable.This is likely a temporary service or DNS outage at ${provider}. Your settings are saved, but testing is currently disabled by the provider.`;
            }

            showError(`Test Failed: ${userMessage} `);
        } finally {
            setIsTesting(false);
        }
    };

    if (isFetching) {
        return (
            <Card padding="lg" className="flex flex-col items-center justify-center gap-ds-4">
                <SafeHaulLoader size="h-12 w-12" />
                <p role="status" className="text-ds-sm font-medium text-ds-content-muted">Loading existing configuration...</p>
            </Card>
        );
    }

    return (
        <Card padding="lg">
            <div className="mb-ds-4 flex flex-wrap items-center justify-between gap-ds-3">
                <h2 className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                    <Database className="text-ds-content-link" size={24} aria-hidden="true" />
                    <span>SMS Integration <span className="font-normal text-ds-content-muted">for</span> {companyName || 'Company'}</span>
                </h2>
                {onBack && (
                    <Button variant="ghost" size="sm" onClick={onBack}>
                        <ArrowLeft size={16} aria-hidden="true" /> Back to List
                    </Button>
                )}
            </div>

            {fetchError && (
                <div
                    role="alert"
                    className="mb-ds-6 flex items-center gap-ds-3 rounded-ds-md border border-ds-status-warning-border bg-ds-status-warning-bg p-ds-4 text-ds-sm text-ds-status-warning-fg"
                >
                    <Activity size={18} aria-hidden="true" />
                    {fetchError}
                </div>
            )}

            <form onSubmit={handleSave} className="space-y-ds-6">

                {/* Provider Selector — Button group with aria-pressed, not colour-only. */}
                <div role="group" aria-label="Select provider">
                    <p className="mb-ds-2 text-ds-sm font-semibold text-ds-content-secondary">Select Provider</p>
                    <div className="flex flex-col gap-ds-3 sm:flex-row">
                        <Button
                            type="button"
                            variant={provider === 'ringcentral' ? 'primary' : 'secondary'}
                            aria-pressed={provider === 'ringcentral'}
                            fullWidth
                            onClick={() => setProvider('ringcentral')}
                        >
                            RingCentral
                        </Button>
                        <Button
                            type="button"
                            variant={provider === '8x8' ? 'primary' : 'secondary'}
                            aria-pressed={provider === '8x8'}
                            fullWidth
                            onClick={() => setProvider('8x8')}
                        >
                            8x8
                        </Button>
                    </div>
                </div>

                {/* Dynamic Fields (Global Settings) */}
                <div className="space-y-ds-4 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                    {provider === 'ringcentral' && (
                        <>
                            <Checkbox
                                label="Use Sandbox Environment (DevTest)"
                                description="Routes through the provider's test environment instead of production."
                                checked={config.isSandbox || false}
                                onChange={(e) => updateConfig('isSandbox', e.target.checked)}
                            />

                            {hasExistingCredentials && (
                                <Badge tone="success" icon={CheckCircle}>Saved</Badge>
                            )}
                            <FormField
                                label="Client ID"
                                required={!hasExistingCredentials}
                                description={hasExistingCredentials ? 'Leave blank to keep the existing value.' : undefined}
                            >
                                <Input
                                    type="text"
                                    value={config.clientId || ''}
                                    onChange={e => updateConfig('clientId', e.target.value)}
                                    placeholder={hasExistingCredentials ? "(Leave blank to keep existing)" : "Enter Client ID"}
                                />
                            </FormField>
                            <FormField
                                label="Client Secret"
                                required={!hasExistingCredentials}
                                description={hasExistingCredentials ? 'Leave blank to keep the existing value.' : undefined}
                            >
                                <Input
                                    type="password"
                                    value={config.clientSecret || ''}
                                    onChange={e => updateConfig('clientSecret', e.target.value)}
                                    placeholder={hasExistingCredentials ? "(Leave blank to keep existing)" : "Enter Client Secret"}
                                />
                            </FormField>
                            <div className="rounded-ds-md border border-ds-status-info-border bg-ds-status-info-bg p-ds-3 text-ds-sm text-ds-status-info-fg">
                                <p className="mb-1 font-bold">Global Integration Note:</p>
                                These shared credentials allow the system to interact with your {provider} App. Individual phone lines and their JWTs are managed separately in the <b>Digital Wallet</b> section below.
                            </div>
                        </>
                    )}

                    {provider === '8x8' && (
                        <>
                            {hasExistingCredentials && (
                                <Badge tone="success" icon={CheckCircle}>Saved</Badge>
                            )}
                            <FormField
                                label="API Key"
                                required={!hasExistingCredentials}
                                description={hasExistingCredentials ? 'Leave blank to keep the existing value.' : undefined}
                            >
                                <Input
                                    type="text"
                                    value={config.apiKey || ''}
                                    onChange={e => updateConfig('apiKey', e.target.value)}
                                    placeholder={hasExistingCredentials ? "(Leave blank to keep existing)" : "Paste Key from 8x8 Admin Console"}
                                />
                            </FormField>
                            <FormField
                                label="API Secret"
                                required={!hasExistingCredentials}
                                description={hasExistingCredentials ? 'Leave blank to keep the existing value.' : undefined}
                            >
                                <Input
                                    type="password"
                                    value={config.apiSecret || ''}
                                    onChange={e => updateConfig('apiSecret', e.target.value)}
                                    placeholder={hasExistingCredentials ? "(Leave blank to keep existing)" : "Paste Secret from 8x8 Admin Console"}
                                />
                            </FormField>
                            <FormField label="SubAccount ID" required>
                                <Input
                                    type="text"
                                    value={config.subAccountId || ''}
                                    onChange={e => updateConfig('subAccountId', e.target.value)}
                                    placeholder="e.g. yourcompany_hq"
                                />
                            </FormField>
                            <FormField
                                label="Sender Phone Number"
                                required
                                description="US carriers require a real phone number — alphanumeric sender IDs are rejected"
                            >
                                <Input
                                    type="text"
                                    value={config.phoneNumber || ''}
                                    onChange={e => updateConfig('phoneNumber', e.target.value)}
                                    placeholder="+1234567890 (your 8x8 provisioned number)"
                                />
                            </FormField>
                            <div className="rounded-ds-md border border-ds-status-info-border bg-ds-status-info-bg p-ds-3 text-ds-sm text-ds-status-info-fg">
                                <p className="mb-1 font-bold">How to find these values:</p>
                                <p>1. Log into <b>8x8 Admin Console</b> → API Keys → copy <b>Key</b> & <b>Secret</b></p>
                                <p>2. <b>SubAccount ID</b>: found under Pricing/SubAccounts (usually ends with <code>_hq</code>)</p>
                                <p>3. <b>Sender Phone Number</b>: your SMS-enabled number from 8x8 (check under Numbers/DID)</p>
                            </div>
                        </>
                    )}

                </div>


                {/* Actions */}
                <div className="flex flex-col gap-ds-3 border-t border-ds-border-subtle pt-ds-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-ds-2">
                        <label htmlFor="sms-test-number" className="sr-only">Test phone number</label>
                        <Input
                            id="sms-test-number"
                            type="tel"
                            placeholder="+1 (555) 000-0000"
                            className="w-40"
                            value={testPhone}
                            onChange={e => setTestPhone(e.target.value)}
                        />
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={handleTest}
                            loading={isTesting}
                            disabled={!testPhone}
                        >
                            <Send size={14} aria-hidden="true" /> Test
                        </Button>
                    </div>

                    <Button type="submit" variant="primary" tone="success" loading={isLoading}>
                        <Save size={18} aria-hidden="true" /> Secure Save
                    </Button>
                </div>

            </form>

            {/* Digital Wallet - Line Manager Section */}
            {provider === 'ringcentral' && (
                <div className="mt-8 border-t border-ds-border-subtle pt-8">
                    <LineManager companyId={companyId} companyName={companyName} />
                </div>
            )}
        </Card>
    );
}