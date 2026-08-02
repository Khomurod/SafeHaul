import React, { useState } from 'react';
import { Send, CheckCircle, AlertTriangle } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { Button, FieldMessage, FormField, Input, Select } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';

/**
 * SMS Diagnostic Lab Modal
 * Allows admins to test specific phone lines from their inventory
 * by selecting a source number and sending to a destination.
 *
 * Migrated to the design system 2026-07-27. The previous overlay was a bare
 * `fixed inset-0` div with no dialog semantics (no focus move/trap/restore,
 * no Escape) and its close control was icon-only with no accessible name;
 * both now come from the shared accessible `Modal`. The sender `<select>`
 * had a visually adjacent `<label>` with no `htmlFor`/`id` pairing, so it was
 * never programmatically associated — now a `FormField`. Every
 * `verifySmsConfig`/`sendTestSMS` payload, guard, and message is unchanged.
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
        <Modal
            onClose={onClose}
            labelledBy="sms-diagnostic-title"
            className="w-full max-w-md overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            <header className="flex items-center justify-between border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-6 py-ds-4">
                <h2 id="sms-diagnostic-title" className="flex items-center gap-ds-2 font-bold text-ds-content">
                    SMS Diagnostic Lab
                </h2>
                <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
                    Close
                </Button>
            </header>

            <form onSubmit={handleSendTest} className="p-ds-6">
                <Stack gap="lg">
                    <FormField
                        label="Send From (Source)"
                        description="Choose a specific number to verify individual line functionality."
                    >
                        <Select
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
                        </Select>
                    </FormField>

                    <FormField label="Send To (Destination)">
                        <Input
                            type="tel"
                            placeholder="+1 (555) 000-0000"
                            value={destination}
                            onChange={(e) => setDestination(e.target.value)}
                        />
                    </FormField>

                    <Stack gap="sm">
                        <Button
                            type="button"
                            variant="secondary"
                            fullWidth
                            onClick={handleVerifyConfig}
                            disabled={verifying}
                            loading={verifying}
                        >
                            {!verifying && <CheckCircle size={18} aria-hidden="true" />}
                            {verifying ? 'Verifying...' : 'Verify Configuration'}
                        </Button>

                        {verificationResult && (
                            <FieldMessage
                                tone={verificationResult.success ? 'success' : 'error'}
                                role={verificationResult.success ? 'status' : 'alert'}
                            >
                                {verificationResult.success ? <CheckCircle size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
                                {' '}{verificationResult.message}
                            </FieldMessage>
                        )}

                        <Button
                            type="submit"
                            variant="primary"
                            fullWidth
                            disabled={sending}
                            loading={sending}
                        >
                            {!sending && <Send size={18} aria-hidden="true" />}
                            {sending ? 'Sending Test...' : 'Send Test Message'}
                        </Button>
                    </Stack>
                </Stack>
            </form>
        </Modal>
    );
}
