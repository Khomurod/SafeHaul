import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { Lock, Save, Send, Database, Key, Phone, Server, ArrowLeft, Activity } from 'lucide-react';
import { LineManager } from './LineManager';

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

                    // Check if credentials exist (encrypted values contain a colon separator)
                    const credsExist = !!(existingClientId && existingClientId.includes(':'));
                    setHasExistingCredentials(credsExist);

                    setConfig(prev => ({
                        ...prev,
                        isSandbox: data.config?.isSandbox === 'true' || data.config?.isSandbox === true,
                        phoneNumber: data.config?.phoneNumber || '',
                        // Leave clientId/clientSecret empty - user enters new values if updating
                        clientId: '',
                        clientSecret: '',
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
            const hasNewClientId = payloadConfig.clientId && payloadConfig.clientId.trim() !== '';
            const hasNewClientSecret = payloadConfig.clientSecret && payloadConfig.clientSecret.trim() !== '';

            // If user has existing credentials but didn't enter new ones, 
            // mark these fields as "preserve" so backend knows not to overwrite
            if (hasExistingCredentials && !hasNewClientId) {
                payloadConfig.clientId = '__PRESERVE__';
            }
            if (hasExistingCredentials && !hasNewClientSecret) {
                payloadConfig.clientSecret = '__PRESERVE__';
            }

            // If NO existing credentials AND user didn't enter new ones, that's an error
            if (!hasExistingCredentials && (!hasNewClientId || !hasNewClientSecret)) {
                showError("Client ID and Client Secret are required.");
                setIsLoading(false);
                return;
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
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-10 flex flex-col items-center justify-center gap-4">
                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-gray-500 font-medium font-inter">Loading existing configuration...</p>
            </div>
        );
    }

    return (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <Database className="text-blue-600" size={24} />
                    <span>SMS Integration <span className="text-gray-400 font-normal">for</span> {companyName || 'Company'}</span>
                </h2>
                {onBack && (
                    <button
                        onClick={onBack}
                        className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors"
                    >
                        <ArrowLeft size={16} /> Back to List
                    </button>
                )}
            </div>

            {fetchError && (
                <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-lg text-orange-800 text-sm flex items-center gap-3">
                    <Activity size={18} />
                    {fetchError}
                </div>
            )}

            <form onSubmit={handleSave} className="space-y-6">

                {/* Provider Selector */}
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Select Provider</label>
                    <div className="flex gap-4">
                        <button
                            type="button"
                            onClick={() => setProvider('ringcentral')}
                            className={`flex-1 py-3 px-4 rounded-lg border font-medium transition-all ${provider === 'ringcentral'
                                ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500'
                                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            RingCentral
                        </button>
                        <button
                            type="button"
                            onClick={() => setProvider('8x8')}
                            className={`flex-1 py-3 px-4 rounded-lg border font-medium transition-all ${provider === '8x8'
                                ? 'bg-orange-50 border-orange-500 text-orange-700 ring-1 ring-orange-500'
                                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            8x8
                        </button>
                    </div>
                </div>

                {/* Dynamic Fields (Global Settings) */}
                <div className="bg-gray-50 p-5 rounded-lg border border-gray-200 space-y-4">
                    {provider === 'ringcentral' && (
                        <>
                            <div className="flex items-center gap-2 mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                                <Server size={14} />
                                <label className="font-bold flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={config.isSandbox || false}
                                        onChange={(e) => updateConfig('isSandbox', e.target.checked)}
                                        className="rounded text-blue-600 focus:ring-blue-500"
                                    />
                                    Use Sandbox Environment (DevTest)
                                </label>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                    Client ID
                                    {hasExistingCredentials && (
                                        <span className="ml-2 text-green-600 font-normal normal-case">✓ Saved</span>
                                    )}
                                </label>
                                <input
                                    type="text"
                                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={config.clientId || ''}
                                    onChange={e => updateConfig('clientId', e.target.value)}
                                    placeholder={hasExistingCredentials ? "(Leave blank to keep existing)" : "Enter Client ID"}
                                    required={!hasExistingCredentials}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                    Client Secret
                                    {hasExistingCredentials && (
                                        <span className="ml-2 text-green-600 font-normal normal-case">✓ Saved</span>
                                    )}
                                </label>
                                <div className="relative">
                                    <input
                                        type="password"
                                        className="w-full p-2 pl-10 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={config.clientSecret || ''}
                                        onChange={e => updateConfig('clientSecret', e.target.value)}
                                        placeholder={hasExistingCredentials ? "(Leave blank to keep existing)" : "Enter Client Secret"}
                                        required={!hasExistingCredentials}
                                    />
                                    <Lock size={16} className="absolute left-3 top-2.5 text-gray-400" />
                                </div>
                            </div>
                            <div className="p-3 bg-blue-50 border border-blue-100 rounded text-[11px] text-blue-800">
                                <p className="font-bold mb-1">Global Integration Note:</p>
                                These shared credentials allow the system to interact with your {provider} App. Individual phone lines and their JWTs are managed separately in the <b>Digital Wallet</b> section below.
                            </div>
                        </>
                    )}

                    {provider === '8x8' && (
                        <>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">SubAccount ID</label>
                                <input
                                    type="text"
                                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={config.subAccountId || ''}
                                    onChange={e => updateConfig('subAccountId', e.target.value)}
                                    placeholder="Enter SubAccount ID"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">API Key</label>
                                <div className="relative">
                                    <input
                                        type="password"
                                        className="w-full p-2 pl-10 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={config.apiKey || ''}
                                        onChange={e => updateConfig('apiKey', e.target.value)}
                                        placeholder="••••••••••••••••"
                                        required
                                    />
                                    <Key size={16} className="absolute left-3 top-2.5 text-gray-400" />
                                </div>
                            </div>
                        </>
                    )}

                </div>


                {/* Actions */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                        <input
                            type="tel"
                            placeholder="+1 (555) 000-0000"
                            className="p-2 border border-gray-300 rounded w-40 text-sm"
                            value={testPhone}
                            onChange={e => setTestPhone(e.target.value)}
                        />
                        <button
                            type="button"
                            onClick={handleTest}
                            disabled={isTesting || !testPhone}
                            className="px-3 py-2 bg-gray-100 text-gray-700 font-bold rounded hover:bg-gray-200 disabled:opacity-50 flex items-center gap-2 text-sm"
                        >
                            {isTesting ? 'Sending...' : <><Send size={14} /> Test</>}
                        </button>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="px-6 py-2 bg-green-600 text-white font-bold rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 shadow-sm"
                    >
                        {isLoading ? 'Saving...' : <><Save size={18} /> Secure Save</>}
                    </button>
                </div>

            </form>

            {/* Digital Wallet - Line Manager Section */}
            {provider === 'ringcentral' && (
                <div className="mt-8 pt-8 border-t border-gray-200">
                    <LineManager companyId={companyId} companyName={companyName} />
                </div>
            )}
        </div>
    );
}