import React, { useState } from 'react';
import { X, Key, Phone, Tag, Loader2, CheckCircle, AlertCircle, Plug } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback/ToastProvider';

/**
 * Modal for Super Admins to add a new phone line to the Digital Wallet
 * Supports both global credentials (shared) and per-line credentials (multi-tenant)
 */
export function AddLineModal({ companyId, onClose, onSuccess, sharedCredentials }) {
    const { showSuccess, showError } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState(null); // { success, message, accountId }

    // Form state
    const [phoneNumber, setPhoneNumber] = useState('');
    const [label, setLabel] = useState('');
    const [jwt, setJwt] = useState('');

    // Per-line credentials
    const [usePerLineCredentials, setUsePerLineCredentials] = useState(!sharedCredentials?.hasCredentials);
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [isSandbox, setIsSandbox] = useState(true);

    const needsCredentials = usePerLineCredentials || !sharedCredentials?.hasCredentials;

    // Test connection before saving
    const handleTestConnection = async () => {
        if (!jwt.trim()) {
            showError("JWT token is required to test connection.");
            return;
        }
        if (needsCredentials && (!clientId.trim() || !clientSecret.trim())) {
            showError("Client ID and Client Secret are required to test connection.");
            return;
        }

        setIsTesting(true);
        setTestResult(null);

        try {
            const testFn = httpsCallable(functions, 'testLineConnection');
            const result = await testFn({
                companyId,  // Pass companyId so backend can fetch shared creds if needed
                jwt: jwt.trim(),
                clientId: needsCredentials ? clientId.trim() : undefined,
                clientSecret: needsCredentials ? clientSecret.trim() : undefined,
                isSandbox
            });

            setTestResult({
                success: true,
                message: result.data.message,
                accountId: result.data.accountId,
                extensionName: result.data.extensionName,
                availableNumbers: result.data.availableNumbers || []
            });
            showSuccess(`✓ Connected! ${result.data.extensionName}`);
        } catch (error) {
            console.error('Test Connection Error:', error);
            setTestResult({
                success: false,
                message: error.message
            });
            showError(error.message || 'Connection test failed.');
        } finally {
            setIsTesting(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!phoneNumber.trim()) {
            showError("Phone number is required.");
            return;
        }
        if (!jwt.trim()) {
            showError("JWT token is required for this line.");
            return;
        }
        if (needsCredentials && (!clientId.trim() || !clientSecret.trim())) {
            showError("Client ID and Client Secret are required.");
            return;
        }

        setIsSubmitting(true);
        try {
            const addLineFn = httpsCallable(functions, 'addPhoneLine');
            const result = await addLineFn({
                companyId,
                phoneNumber: phoneNumber.trim(),
                label: label.trim() || phoneNumber.trim(),
                jwt: jwt.trim(),
                // Always send per-line credentials if using them
                ...(needsCredentials && {
                    clientId: clientId.trim(),
                    clientSecret: clientSecret.trim(),
                    isSandbox
                })
            });

            if (result.data.success) {
                showSuccess(result.data.message || `Line ${result.data.phoneNumber} added successfully.`);
                if (result.data.verification?.identity) {
                    showSuccess(`Verified: ${result.data.verification.identity}`);
                }
                onSuccess?.();
                onClose();
            }
        } catch (error) {
            console.error('Add Line Error:', error);
            showError(error.message || 'Failed to add phone line.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 flex justify-between items-center">
                    <h3 className="font-bold text-white flex items-center gap-2">
                        <Phone size={18} />
                        Add Phone Line
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-white/80 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {/* Phone Number */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
                            Phone Number *
                        </label>
                        <div className="relative">
                            <input
                                type="tel"
                                placeholder="+1 (555) 123-4567"
                                className="w-full p-2.5 pl-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value)}
                                required
                            />
                            <Phone size={16} className="absolute left-3 top-3 text-gray-400" />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1">
                            E.164 format preferred (e.g., +15551234567)
                        </p>
                    </div>

                    {/* Label */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
                            Label (Optional)
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Recruitment Hotline"
                                className="w-full p-2.5 pl-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                            />
                            <Tag size={16} className="absolute left-3 top-3 text-gray-400" />
                        </div>
                    </div>

                    {/* JWT Token */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
                            JWT Token for This Line *
                        </label>
                        <div className="relative">
                            <textarea
                                placeholder="eyJ0..."
                                className="w-full p-2.5 pl-10 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                                rows={3}
                                value={jwt}
                                onChange={(e) => setJwt(e.target.value)}
                                required
                            />
                            <Key size={16} className="absolute left-3 top-3 text-gray-400" />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1">
                            Generate this in RingCentral Developer Portal for the user who owns this number.
                        </p>
                    </div>

                    {/* Per-Line Credentials Toggle */}
                    {sharedCredentials?.hasCredentials && (
                        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer p-3 bg-gray-50 rounded-lg border border-gray-200">
                            <input
                                type="checkbox"
                                checked={usePerLineCredentials}
                                onChange={(e) => setUsePerLineCredentials(e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <div>
                                <span className="font-medium">Use per-line credentials</span>
                                <p className="text-[10px] text-gray-400 mt-0.5">
                                    Enable if this line belongs to a different RingCentral app/account
                                </p>
                            </div>
                        </label>
                    )}

                    {/* Credentials Section */}
                    {needsCredentials && (
                        <div className="border-t border-gray-200 pt-5 mt-5 space-y-4">
                            <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 p-2 rounded-lg">
                                <Key size={14} />
                                <span className="font-medium">
                                    {sharedCredentials?.hasCredentials
                                        ? 'Per-Line Credentials (Multi-Tenant Mode)'
                                        : 'Enter RingCentral App Credentials'}
                                </span>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
                                    Client ID *
                                </label>
                                <input
                                    type="text"
                                    placeholder="Enter RingCentral Client ID"
                                    className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={clientId}
                                    onChange={(e) => setClientId(e.target.value)}
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
                                    Client Secret *
                                </label>
                                <input
                                    type="password"
                                    placeholder="••••••••••••"
                                    className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={clientSecret}
                                    onChange={(e) => setClientSecret(e.target.value)}
                                    required
                                />
                            </div>

                            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={isSandbox}
                                    onChange={(e) => setIsSandbox(e.target.checked)}
                                    className="rounded text-blue-600 focus:ring-blue-500"
                                />
                                Use Sandbox Environment (for testing)
                            </label>
                        </div>
                    )}

                    {/* Test Result */}
                    {testResult && (
                        <div className={`p-3 rounded-lg text-sm ${testResult.success
                            ? 'bg-green-50 border border-green-200 text-green-700'
                            : 'bg-red-50 border border-red-200 text-red-700'
                            }`}>
                            <div className="flex items-center gap-2">
                                {testResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                                <span className="font-medium">
                                    {testResult.success ? 'Connection Successful!' : 'Connection Failed'}
                                </span>
                            </div>
                            <p className="text-xs mt-1">{testResult.message}</p>
                            {testResult.availableNumbers?.length > 0 && (
                                <div className="mt-2 text-xs">
                                    <span className="font-medium">Available Numbers: </span>
                                    {testResult.availableNumbers.slice(0, 3).map(n => n.phoneNumber).join(', ')}
                                    {testResult.availableNumbers.length > 3 && ` +${testResult.availableNumbers.length - 3} more`}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="pt-3 space-y-2">
                        {/* Test Connection Button */}
                        <button
                            type="button"
                            onClick={handleTestConnection}
                            disabled={isTesting || !jwt.trim()}
                            className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 border border-gray-300"
                        >
                            {isTesting ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Testing Connection...
                                </>
                            ) : (
                                <>
                                    <Plug size={16} />
                                    Test Connection
                                </>
                            )}
                        </button>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-70 shadow-md"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={18} className="animate-spin" />
                                    Verifying & Adding...
                                </>
                            ) : (
                                <>
                                    <CheckCircle size={18} />
                                    Verify & Add Line
                                </>
                            )}
                        </button>
                        <p className="text-[10px] text-gray-400 text-center">
                            Credentials will be verified before the line is provisioned
                        </p>
                    </div>
                </form>
            </div>
        </div>
    );
}

