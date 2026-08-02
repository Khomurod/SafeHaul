import React, { useId, useState } from 'react';
import { X, Key, CheckCircle, AlertCircle, Plug } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { Button, Checkbox, FormField, IconButton, Input, Textarea } from '@/design-system/components';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Modal for Super Admins to add a new phone line to the Digital Wallet.
 * Supports both global (shared) credentials and per-line credentials.
 *
 * Migrated to the design system 2026-07-28. Presentation only — the
 * `usePerLineCredentials` / `needsCredentials` logic, the initial
 * `isSandbox: true`, the `testLineConnection` and `addPhoneLine` callable names
 * and payload shapes (including omitting credentials when not needed and the
 * `label || phoneNumber` fallback), every validation guard and its wording, and
 * the success/verify toasts are unchanged (frozen in
 * `AddLineModal.contract.test.jsx`).
 *
 * Presentation defects fixed: the hand-built `fixed inset-0` overlay (no focus
 * trap, no Escape, no focus restore) is replaced with the shared accessible
 * `Modal`; the legacy palette/gradient becomes `--ds-*` tokens; the inputs are
 * `FormField`/`Input`/`Textarea` with wired labels; the two checkboxes use the
 * `Checkbox` primitive; `text-[10px]` help text moved into accessible
 * `FormField` descriptions.
 */
export function AddLineModal({ companyId, onClose, onSuccess, sharedCredentials }) {
    const { showSuccess, showError } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState(null); // { success, message, accountId }
    const titleId = useId();

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
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-6 py-ds-4">
                <h3 id={titleId} className="flex items-center gap-ds-2 font-bold text-ds-content">
                    <Plug size={18} aria-hidden="true" className="text-ds-content-link" />
                    Add Phone Line
                </h3>
                <IconButton label="Close" variant="ghost" size="sm" onClick={onClose}>
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </div>

            {/* Body */}
            <form onSubmit={handleSubmit} className="space-y-ds-5 p-ds-6">
                <FormField
                    label="Phone Number"
                    required
                    description="E.164 format preferred (e.g., +15551234567)"
                >
                    <Input
                        type="tel"
                        placeholder="+1 (555) 123-4567"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                    />
                </FormField>

                <FormField label="Label (Optional)">
                    <Input
                        type="text"
                        placeholder="Recruitment Hotline"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                    />
                </FormField>

                <FormField
                    label="JWT Token for This Line"
                    required
                    description="Generate this in RingCentral Developer Portal for the user who owns this number."
                >
                    <Textarea
                        placeholder="eyJ0..."
                        className="font-mono"
                        rows={3}
                        value={jwt}
                        onChange={(e) => setJwt(e.target.value)}
                    />
                </FormField>

                {/* Per-Line Credentials Toggle */}
                {sharedCredentials?.hasCredentials && (
                    <div className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-3">
                        <Checkbox
                            label="Use per-line credentials"
                            description="Enable if this line belongs to a different RingCentral app/account"
                            checked={usePerLineCredentials}
                            onChange={(e) => setUsePerLineCredentials(e.target.checked)}
                        />
                    </div>
                )}

                {/* Credentials Section */}
                {needsCredentials && (
                    <div className="mt-ds-5 space-y-ds-4 border-t border-ds-border-subtle pt-ds-5">
                        <div className="flex items-center gap-ds-2 rounded-ds-md bg-ds-status-info-bg p-ds-2 text-ds-sm text-ds-status-info-fg">
                            <Key size={14} aria-hidden="true" />
                            <span className="font-medium">
                                {sharedCredentials?.hasCredentials
                                    ? 'Per-Line Credentials (Multi-Tenant Mode)'
                                    : 'Enter RingCentral App Credentials'}
                            </span>
                        </div>

                        <FormField label="Client ID" required>
                            <Input
                                type="text"
                                placeholder="Enter RingCentral Client ID"
                                value={clientId}
                                onChange={(e) => setClientId(e.target.value)}
                            />
                        </FormField>

                        <FormField label="Client Secret" required>
                            <Input
                                type="password"
                                placeholder="••••••••••••"
                                value={clientSecret}
                                onChange={(e) => setClientSecret(e.target.value)}
                            />
                        </FormField>

                        <Checkbox
                            label="Use Sandbox Environment (for testing)"
                            checked={isSandbox}
                            onChange={(e) => setIsSandbox(e.target.checked)}
                        />
                    </div>
                )}

                {/* Test Result */}
                {testResult && (
                    <div
                        role="status"
                        className={`rounded-ds-md border p-ds-3 text-ds-sm ${testResult.success
                            ? 'border-ds-status-success-border bg-ds-status-success-bg text-ds-status-success-fg'
                            : 'border-ds-status-danger-border bg-ds-status-danger-bg text-ds-status-danger-fg'
                            }`}
                    >
                        <div className="flex items-center gap-ds-2">
                            {testResult.success ? <CheckCircle size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
                            <span className="font-medium">
                                {testResult.success ? 'Connection Successful!' : 'Connection Failed'}
                            </span>
                        </div>
                        <p className="mt-1 text-ds-xs">{testResult.message}</p>
                        {testResult.availableNumbers?.length > 0 && (
                            <div className="mt-ds-2 text-ds-xs">
                                <span className="font-medium">Available Numbers: </span>
                                {testResult.availableNumbers.slice(0, 3).map(n => n.phoneNumber).join(', ')}
                                {testResult.availableNumbers.length > 3 && ` +${testResult.availableNumbers.length - 3} more`}
                            </div>
                        )}
                    </div>
                )}

                {/* Action Buttons */}
                <div className="space-y-ds-2 pt-ds-3">
                    <Button
                        type="button"
                        variant="secondary"
                        fullWidth
                        onClick={handleTestConnection}
                        loading={isTesting}
                        disabled={!jwt.trim()}
                    >
                        <Plug size={16} aria-hidden="true" />
                        Test Connection
                    </Button>

                    <Button type="submit" variant="primary" fullWidth loading={isSubmitting}>
                        <CheckCircle size={18} aria-hidden="true" />
                        Verify &amp; Add Line
                    </Button>
                    <p className="text-center text-ds-xs text-ds-content-muted">
                        Credentials will be verified before the line is provisioned
                    </p>
                </div>
            </form>
        </Modal>
    );
}

export default AddLineModal;
