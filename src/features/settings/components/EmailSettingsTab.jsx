import React, { useState, useEffect } from 'react';
import { doc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from '@lib/firebase';
import { Save, Loader2, AlertTriangle, CheckCircle, Mail, Server, Lock, HelpCircle, ChevronDown, ChevronUp, TestTube } from 'lucide-react';
import { useToast } from '@shared/components/feedback';

export function EmailSettingsTab({ currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const [emailSettings, setEmailSettings] = useState({
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        smtpPass: '',
        email: '',
        signature: '',
    });
    const [loading, setLoading] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [showGuide, setShowGuide] = useState(false);

    useEffect(() => {
        if (currentCompanyProfile?.emailSettings) {
            setEmailSettings(prev => ({
                ...prev,
                ...currentCompanyProfile.emailSettings,
            }));
        }
    }, [currentCompanyProfile]);

    const handleTestConnection = async () => {
        setTesting(true);
        setTestResult(null);

        try {
            const testEmailConnectionFn = httpsCallable(functions, 'testEmailConnection');
            const result = await testEmailConnectionFn({
                smtpHost: emailSettings.smtpHost,
                smtpPort: emailSettings.smtpPort,
                smtpUser: emailSettings.smtpUser,
                smtpPass: emailSettings.smtpPass,
            });

            if (result.data.success) {
                setTestResult({ success: true, message: result.data.message });
                showSuccess('✅ Connection successful! You can now save these settings.');
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
        if (!emailSettings.smtpHost || !emailSettings.smtpUser || !emailSettings.smtpPass) {
            showError('Please fill in all SMTP fields (Host, User, Password)');
            return;
        }

        setLoading(true);
        try {
            const companyRef = doc(db, "companies", currentCompanyProfile.id);
            await updateDoc(companyRef, { emailSettings });
            showSuccess('Email settings saved successfully!');
            setTestResult(null); // Clear test result after save
        } catch (error) {
            console.error("Error saving email settings:", error);
            showError("Failed to save email settings.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-8 max-w-4xl animate-in fade-in">
            <div className="border-b border-gray-200 pb-4 mb-6">
                <h2 className="text-xl font-bold text-gray-900">Email Integration</h2>
                <p className="text-sm text-gray-500 mt-1">Configure your company's email server to send automated messages directly from your domain.</p>
            </div>

            {/* SMTP Configuration Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
                <h3 className="font-bold text-gray-800 border-b pb-2 mb-4 flex items-center gap-2">
                    <Server size={20} className="text-blue-600" />
                    SMTP Server Configuration
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            SMTP Host <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            value={emailSettings.smtpHost || ''}
                            onChange={e => setEmailSettings({ ...emailSettings, smtpHost: e.target.value })}
                            placeholder="smtp.gmail.com"
                        />
                        <p className="text-xs text-gray-500 mt-1">Example: smtp.gmail.com, smtp.office365.com</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            SMTP Port <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="number"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            value={emailSettings.smtpPort || 587}
                            onChange={e => setEmailSettings({ ...emailSettings, smtpPort: parseInt(e.target.value) })}
                            placeholder="587"
                            min="1"
                            max="65535"
                        />
                        <p className="text-xs text-gray-500 mt-1">Common: 587 (TLS), 465 (SSL), 25</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                            <Mail size={14} />
                            SMTP Username <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="email"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            value={emailSettings.smtpUser || ''}
                            onChange={e => setEmailSettings({ ...emailSettings, smtpUser: e.target.value })}
                            placeholder="your-email@company.com"
                        />
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                            <Lock size={14} />
                            SMTP Password <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="password"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            value={emailSettings.smtpPass || ''}
                            onChange={e => setEmailSettings({ ...emailSettings, smtpPass: e.target.value })}
                            placeholder="••••••••••••"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            For Gmail, use an <strong>App Password</strong>, not your regular password.
                        </p>
                    </div>
                </div>

                {/* Test Connection Section */}
                <div className="pt-4 border-t border-gray-200">
                    <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={testing || !emailSettings.smtpHost || !emailSettings.smtpUser || !emailSettings.smtpPass}
                        className="px-6 py-3 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-all"
                    >
                        {testing ? (
                            <>
                                <Loader2 className="animate-spin" size={18} />
                                Testing Connection...
                            </>
                        ) : (
                            <>
                                <TestTube size={18} />
                                Test Connection
                            </>
                        )}
                    </button>

                    {testResult && (
                        <div className={`mt-4 p-4 rounded-lg border ${testResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                            <div className="flex items-start gap-2">
                                {testResult.success ? (
                                    <CheckCircle size={20} className="text-green-600 shrink-0 mt-0.5" />
                                ) : (
                                    <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
                                )}
                                <div>
                                    <p className={`font-bold ${testResult.success ? 'text-green-800' : 'text-red-800'}`}>
                                        {testResult.success ? 'Connection Successful!' : 'Connection Failed'}
                                    </p>
                                    <p className={`text-sm ${testResult.success ? 'text-green-700' : 'text-red-700'} mt-1`}>
                                        {testResult.message}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Email Signature */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
                <h3 className="font-bold text-gray-800 border-b pb-2 mb-4">Email Signature (Optional)</h3>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Default Signature</label>
                    <textarea
                        className="w-full p-3 border border-gray-300 rounded-lg h-24 focus:ring-2 focus:ring-blue-500 outline-none"
                        value={emailSettings.signature || ''}
                        onChange={e => setEmailSettings({ ...emailSettings, signature: e.target.value })}
                        placeholder="Best regards,&#10;[Your Name]&#10;[Your Company]"
                    />
                    <p className="text-xs text-gray-500 mt-1">This signature will be automatically appended to all outgoing emails.</p>
                </div>
            </div>

            {/* Setup Guide */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 shadow-sm">
                <button
                    type="button"
                    onClick={() => setShowGuide(!showGuide)}
                    className="w-full flex items-center justify-between text-left group"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-600 rounded-lg">
                            <HelpCircle className="text-white" size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-900 text-lg">How to Set Up SMTP</h3>
                            <p className="text-sm text-gray-600">Step-by-step guides for Gmail, Outlook, and SendGrid</p>
                        </div>
                    </div>
                    {showGuide ? <ChevronUp className="text-blue-600" size={24} /> : <ChevronDown className="text-blue-600" size={24} />}
                </button>

                {showGuide && (
                    <div className="mt-6 space-y-6 animate-in fade-in slide-in-from-top-2">
                        {/* Gmail Guide */}
                        <div className="bg-white rounded-lg p-5 border border-gray-200 shadow-sm">
                            <h4 className="font-bold text-gray-900 text-lg mb-3 flex items-center gap-2">
                                <Mail className="text-red-500" size={20} />
                                Gmail / Google Workspace
                            </h4>
                            <ol className="space-y-2 text-sm text-gray-700 list-decimal list-inside">
                                <li>Go to your <a href="https://myaccount.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Google Account</a></li>
                                <li>Navigate to <strong>Security</strong> → <strong>2-Step Verification</strong> (you must enable this first)</li>
                                <li>Scroll down and click <strong>App passwords</strong></li>
                                <li>Select app: <strong>Mail</strong>, Select device: <strong>Other (Custom name)</strong></li>
                                <li>Enter "SafeHaul" and click <strong>Generate</strong></li>
                                <li>Copy the 16-character password (e.g., <code className="bg-gray-100 px-1 rounded">xxxx xxxx xxxx xxxx</code>)</li>
                            </ol>
                            <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200">
                                <p className="text-sm font-semibold text-blue-900">Configuration:</p>
                                <ul className="text-xs text-blue-800 mt-1 space-y-1">
                                    <li>• <strong>Host:</strong> smtp.gmail.com</li>
                                    <li>• <strong>Port:</strong> 587</li>
                                    <li>• <strong>Username:</strong> your-email@gmail.com</li>
                                    <li>• <strong>Password:</strong> [App Password from step 6]</li>
                                </ul>
                            </div>
                        </div>

                        {/* Outlook Guide */}
                        <div className="bg-white rounded-lg p-5 border border-gray-200 shadow-sm">
                            <h4 className="font-bold text-gray-900 text-lg mb-3 flex items-center gap-2">
                                <Mail className="text-blue-600" size={20} />
                                Outlook / Microsoft 365
                            </h4>
                            <ol className="space-y-2 text-sm text-gray-700 list-decimal list-inside">
                                <li>Ensure your Microsoft account has <strong>SMTP authentication enabled</strong></li>
                                <li>For Microsoft 365 admins: Go to <strong>Exchange Admin Center</strong> → <strong>Settings</strong> → Enable SMTP AUTH</li>
                                <li>Use your regular Outlook email and password (or create an app-specific password if using MFA)</li>
                            </ol>
                            <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200">
                                <p className="text-sm font-semibold text-blue-900">Configuration:</p>
                                <ul className="text-xs text-blue-800 mt-1 space-y-1">
                                    <li>• <strong>Host:</strong> smtp.office365.com</li>
                                    <li>• <strong>Port:</strong> 587</li>
                                    <li>• <strong>Username:</strong> your-email@outlook.com (or company domain)</li>
                                    <li>• <strong>Password:</strong> [Your Outlook password or app password]</li>
                                </ul>
                            </div>
                        </div>

                        {/* SendGrid Guide */}
                        <div className="bg-white rounded-lg p-5 border border-gray-200 shadow-sm">
                            <h4 className="font-bold text-gray-900 text-lg mb-3 flex items-center gap-2">
                                <Server className="text-indigo-600" size={20} />
                                SendGrid (Recommended for High Volume)
                            </h4>
                            <ol className="space-y-2 text-sm text-gray-700 list-decimal list-inside">
                                <li>Sign up for a free SendGrid account at <a href="https://sendgrid.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">sendgrid.com</a></li>
                                <li>Go to <strong>Settings</strong> → <strong>API Keys</strong></li>
                                <li>Click <strong>Create API Key</strong></li>
                                <li>Name: "SafeHaul SMTP", Permissions: <strong>Full Access</strong> (or Mail Send only)</li>
                                <li>Copy the generated API key (starts with <code className="bg-gray-100 px-1 rounded">SG.</code>)</li>
                            </ol>
                            <div className="mt-4 p-3 bg-indigo-50 rounded border border-indigo-200">
                                <p className="text-sm font-semibold text-indigo-900">Configuration:</p>
                                <ul className="text-xs text-indigo-800 mt-1 space-y-1">
                                    <li>• <strong>Host:</strong> smtp.sendgrid.net</li>
                                    <li>• <strong>Port:</strong> 587</li>
                                    <li>• <strong>Username:</strong> apikey (exactly as written)</li>
                                    <li>• <strong>Password:</strong> [Your SendGrid API key from step 5]</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Save Button */}
            <div className="pt-4 flex justify-end gap-3">
                <button
                    onClick={handleSaveEmailSettings}
                    disabled={loading || !emailSettings.smtpHost || !emailSettings.smtpUser || !emailSettings.smtpPass}
                    className="px-8 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-all"
                >
                    {loading ? <Loader2 className="animate-spin" /> : <Save size={18} />}
                    Save Settings
                </button>
            </div>
        </div>
    );
}
