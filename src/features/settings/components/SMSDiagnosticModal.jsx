import React, { useState } from 'react';
import { X, Send, Loader2, Smartphone, CheckCircle, AlertTriangle } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback/ToastProvider';

/**
 * SMS Diagnostic Lab Modal
 * Allows admins to test specific phone lines from their inventory
 * by selecting a source number and sending to a destination.
 */
export function SMSDiagnosticModal({ companyId, inventory, onClose }) {
    const { showSuccess, showError } = useToast();
    const [sending, setSending] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [verificationResult, setVerificationResult] = useState(null);

    // State for the form
    const [destination, setDestination] = useState('');
    const [selectedSender, setSelectedSender] = useState(''); // Empty = Auto/Default

    const handleVerifyConfig = async () => {
        setVerifying(true);
        setVerificationResult(null);
        try {
            const verifyFn = httpsCallable(functions, 'verifySmsConfig');
            const result = await verifyFn({ companyId });
            setVerificationResult({ success: true, message: result.data.message });
        } catch (error) {
            setVerificationResult({ success: false, message: error.message });
        } finally {
            setVerifying(false);
        }
    };

    const handleSendTest = async (e) => {
        e.preventDefault();

        if (!destination) {
            showError("Please enter a destination phone number.");
            return;
        }

        setSending(true);
        try {
            const sendTest = httpsCallable(functions, 'sendTestSMS');

            await sendTest({
                companyId,
                testPhoneNumber: destination,
                fromNumber: selectedSender || null // Send null if they want to test Default routing
            });

            showSuccess(`Test message sent to ${destination}`);
            onClose();
        } catch (error) {
            console.error(error);
            showError(error.message || "Failed to send test.");
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
                {/* Header */}
                <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                    <h3 className="font-bold text-gray-800 flex items-center gap-2">
                        <Smartphone size={18} className="text-blue-600" />
                        SMS Diagnostic Lab
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSendTest} className="p-6 space-y-5">
                    {/* Sender Selection */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
                            Send From (Source)
                        </label>
                        <select
                            className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                            value={selectedSender}
                            onChange={(e) => setSelectedSender(e.target.value)}
                        >
                            <option value="">System Default (Auto-Route)</option>
                            <optgroup label="Inventory Numbers">
                                {inventory.map((item) => (
                                    <option key={item.phoneNumber} value={item.phoneNumber}>
                                        {item.phoneNumber} {item.usageType ? `(${item.usageType})` : ''}
                                    </option>
                                ))}
                            </optgroup>
                        </select>
                        <p className="text-[10px] text-gray-400 mt-1">
                            Choose specific number to verify individual line functionality.
                        </p>
                    </div>

                    {/* Destination Input */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
                            Send To (Destination)
                        </label>
                        <input
                            type="tel"
                            placeholder="+1 (555) 000-0000"
                            className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            value={destination}
                            onChange={(e) => setDestination(e.target.value)}
                        />
                    </div>

                    {/* Actions */}
                    <div className="pt-2 space-y-3">
                        <button
                            type="button"
                            onClick={handleVerifyConfig}
                            disabled={verifying}
                            className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-70"
                        >
                            {verifying ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                            {verifying ? 'Verifying...' : 'Verify Configuration'}
                        </button>

                        {verificationResult && (
                            <div className={`p-3 rounded-lg text-xs flex items-start gap-2 ${verificationResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                                {verificationResult.success ? <CheckCircle className="w-4 h-4 mt-0.5" /> : <AlertTriangle className="w-4 h-4 mt-0.5" />}
                                <span className="flex-1">{verificationResult.message}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={sending}
                            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-70"
                        >
                            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                            {sending ? 'Sending Test...' : 'Send Test Message'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
