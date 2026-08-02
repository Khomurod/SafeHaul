import React, { useState, useEffect, useCallback, useId } from 'react';
import { Phone, Plus, Trash2, AlertCircle, CheckCircle, User } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { Badge, Button, Card, IconButton } from '@/design-system/components';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';
import { Modal } from '@shared/components/modals/Modal';
import { AddLineModal } from './AddLineModal';

/**
 * Line Manager — Super Admin interface for the RingCentral "Digital Wallet":
 * lists provisioned phone lines and adds/removes lines with per-line JWTs.
 *
 * Migrated to the design system 2026-07-28. Presentation only — the real-time
 * listener on `companies/{id}/integrations/sms_provider`, the
 * `inventory`/`hasCredentials`/`defaultPhoneNumber` mapping, the phone number as
 * the stable line identity used for removal, the `removePhoneLine({ companyId,
 * phoneNumber })` payload, the success / cleared-assignments / failure toast
 * wording, and the `hasCredentials` handed to `AddLineModal` are all unchanged
 * (frozen in `LineManager.contract.test.jsx`).
 *
 * Presentation defects fixed: blocking `window.confirm` on the destructive
 * remove replaced with the shared accessible dialog (wording preserved); legacy
 * palette and the gradient header replaced with `--ds-*` tokens; colour-only
 * status/default pills replaced with `Badge`s carrying text + icon; the icon-only
 * remove control now has an accessible name; `text-[10px]` on the usage-type
 * chip and the security notice removed; the table sits in a named, focusable
 * scroll region so keyboard users can reach it on mobile.
 */
export function LineManager({ companyId, companyName }) {
    const { showSuccess, showError } = useToast();
    const [inventory, setInventory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [hasCredentials, setHasCredentials] = useState(false);
    const [removingLine, setRemovingLine] = useState(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [defaultNumber, setDefaultNumber] = useState(null);
    // Replaces the blocking `window.confirm` on remove; holds the line awaiting
    // confirmation.
    const [pendingRemove, setPendingRemove] = useState(null);
    const tableRegionId = useId();

    // Real-time listener for inventory changes
    useEffect(() => {
        if (!companyId) return;

        const docRef = doc(db, 'companies', companyId, 'integrations', 'sms_provider');
        const unsubscribe = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setInventory(data.inventory || []);
                setHasCredentials(!!(data.config?.clientId && data.config?.clientSecret));
                setDefaultNumber(data.defaultPhoneNumber || null);
            } else {
                setInventory([]);
                setHasCredentials(false);
            }
            setLoading(false);
        }, (error) => {
            console.error('Error listening to SMS config:', error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [companyId]);

    // The blocking `window.confirm` guard now lives in `<RemoveLineDialog>`; the
    // callable, payload and toasts below are unchanged.
    const confirmRemoveLine = useCallback(async (phoneNumber) => {
        setPendingRemove(null);
        setRemovingLine(phoneNumber);
        try {
            const removeLineFn = httpsCallable(functions, 'removePhoneLine');
            const result = await removeLineFn({ companyId, phoneNumber });

            if (result.data.success) {
                showSuccess(result.data.message || `Line ${phoneNumber} removed.`);
                if (result.data.clearedAssignments > 0) {
                    showSuccess(`${result.data.clearedAssignments} assignment(s) cleared.`);
                }
            }
        } catch (error) {
            console.error('Remove Line Error:', error);
            showError(error.message || 'Failed to remove line.');
        } finally {
            setRemovingLine(null);
        }
    }, [companyId, showSuccess, showError]);

    if (loading) {
        return (
            <Card padding="lg" className="flex flex-col items-center justify-center gap-ds-4">
                <SafeHaulLoader size="h-8 w-8" />
                <p role="status" className="text-ds-sm font-medium text-ds-content-muted">Loading phone lines...</p>
            </Card>
        );
    }

    return (
        <Card padding="none" className="overflow-hidden">
            {/* Header */}
            <div className="flex flex-col gap-ds-3 border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-6 py-ds-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 className="flex items-center gap-ds-2 font-bold text-ds-content">
                        <Phone className="text-ds-content-link" size={20} aria-hidden="true" />
                        Phone Line Wallet
                    </h3>
                    <p className="mt-0.5 text-ds-xs text-ds-content-muted">
                        {inventory.length} line{inventory.length !== 1 ? 's' : ''} provisioned for {companyName || 'this company'}
                    </p>
                </div>
                <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
                    <Plus size={16} aria-hidden="true" />
                    Add Line
                </Button>
            </div>

            {/* Empty State */}
            {inventory.length === 0 ? (
                <div className="p-12 text-center">
                    <div className="mx-auto mb-ds-4 flex h-16 w-16 items-center justify-center rounded-full bg-ds-surface-subtle">
                        <Phone className="text-ds-content-muted" size={32} aria-hidden="true" />
                    </div>
                    <h4 className="mb-ds-2 font-bold text-ds-content">No Phone Lines</h4>
                    <p className="mx-auto mb-ds-6 max-w-sm text-ds-sm text-ds-content-muted">
                        Add phone lines to enable SMS functionality. Each line requires its own JWT token from RingCentral.
                    </p>
                    <Button variant="primary" onClick={() => setShowAddModal(true)}>
                        <Plus size={16} aria-hidden="true" />
                        Add First Line
                    </Button>
                </div>
            ) : (
                <div
                    role="region"
                    aria-labelledby={tableRegionId}
                    tabIndex={0}
                    className="overflow-auto focus-visible:outline-none focus-visible:shadow-ds-focus"
                >
                    <table className="w-full border-collapse text-left">
                        <caption id={tableRegionId} className="sr-only">Provisioned phone lines</caption>
                        <thead className="bg-ds-surface-subtle text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">
                            <tr>
                                <th scope="col" className="px-ds-6 py-ds-3">Phone Number</th>
                                <th scope="col" className="px-ds-6 py-ds-3">Label</th>
                                <th scope="col" className="px-ds-6 py-ds-3 text-center">Status</th>
                                <th scope="col" className="px-ds-6 py-ds-3 text-center">Default</th>
                                <th scope="col" className="px-ds-6 py-ds-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ds-border-subtle">
                            {inventory.map((line) => (
                                <tr key={line.phoneNumber} className="transition-colors hover:bg-ds-surface-subtle">
                                    <th scope="row" className="px-ds-6 py-ds-4 text-left align-middle">
                                        <span className="font-mono text-ds-sm font-medium text-ds-content">
                                            {line.phoneNumber}
                                        </span>
                                    </th>
                                    <td className="px-ds-6 py-ds-4 align-middle">
                                        <span className="text-ds-sm text-ds-content-secondary">
                                            {line.label || '-'}
                                        </span>
                                        {line.usageType && (
                                            <span className="ml-ds-2 inline-flex align-middle">
                                                <Badge tone="neutral">{line.usageType}</Badge>
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-ds-6 py-ds-4 text-center align-middle">
                                        {line.status === 'active' ? (
                                            <Badge tone="success" icon={CheckCircle}>Active</Badge>
                                        ) : (
                                            <Badge tone="warning" icon={AlertCircle}>{line.status || 'Unknown'}</Badge>
                                        )}
                                    </td>
                                    <td className="px-ds-6 py-ds-4 text-center align-middle">
                                        {line.phoneNumber === defaultNumber ? (
                                            <Badge tone="info" icon={User}>Default</Badge>
                                        ) : (
                                            <span className="text-ds-content-muted" aria-hidden="true">—</span>
                                        )}
                                    </td>
                                    <td className="px-ds-6 py-ds-4 text-right align-middle">
                                        <IconButton
                                            label={`Remove line ${line.phoneNumber}`}
                                            variant="ghost"
                                            size="sm"
                                            loading={removingLine === line.phoneNumber}
                                            onClick={() => setPendingRemove(line)}
                                        >
                                            <Trash2 size={16} aria-hidden="true" className="text-ds-status-danger-fg" />
                                        </IconButton>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Security Notice */}
            <div className="border-t border-ds-border-subtle bg-ds-surface-subtle px-ds-6 py-ds-3">
                <p className="flex items-center gap-1.5 text-ds-xs text-ds-content-muted">
                    <AlertCircle size={12} aria-hidden="true" />
                    JWT tokens are encrypted and never exposed to Company Admins
                </p>
            </div>

            {/* Add Line Modal */}
            {showAddModal && (
                <AddLineModal
                    companyId={companyId}
                    onClose={() => setShowAddModal(false)}
                    onSuccess={() => {
                        // Inventory updates automatically via real-time listener
                    }}
                    sharedCredentials={{ hasCredentials }}
                />
            )}

            {pendingRemove && (
                <RemoveLineDialog
                    line={pendingRemove}
                    onCancel={() => setPendingRemove(null)}
                    onConfirm={() => confirmRemoveLine(pendingRemove.phoneNumber)}
                />
            )}
        </Card>
    );
}

/**
 * Replaces the blocking `window.confirm` that guarded line removal. The warning
 * wording is preserved verbatim.
 */
function RemoveLineDialog({ line, onCancel, onConfirm }) {
    const titleId = useId();
    const descriptionId = useId();

    return (
        <Modal
            onClose={onCancel}
            labelledBy={titleId}
            describedBy={descriptionId}
            closeOnBackdrop={false}
            className="w-full max-w-lg overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            <div className="p-ds-5">
                <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">
                    Remove phone line?
                </h2>
                <p id={descriptionId} className="mt-ds-3 text-ds-sm text-ds-content-secondary">
                    Are you sure you want to remove <strong className="font-mono text-ds-content">{line.phoneNumber}</strong>? Any users assigned to this line will be unassigned.
                </p>
            </div>
            <div className="flex justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                <Button variant="danger" onClick={onConfirm}>Remove line</Button>
            </div>
        </Modal>
    );
}

export default LineManager;
