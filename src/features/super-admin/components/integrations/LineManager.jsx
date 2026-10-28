import React, { useState, useEffect } from 'react';
import { Icon, Phone, Plus, Trash2, AlertCircle, CheckCircle, User } from '@design-system/icons';
import { db } from '@lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Badge, Button, Card, DataTable, IconButton } from '@/design-system/components';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';
import { AddLineModal } from './AddLineModal';
import { RemoveLineDialog } from './RemoveLineDialog';
import { useRemovePhoneLine } from './useRemovePhoneLine';

/**
 * Line Manager — Super Admin interface for the RingCentral "Digital Wallet":
 * lists provisioned phone lines and adds/removes lines with per-line JWTs.
 *
 * Presentation only. Frozen in `LineManager.contract.test.jsx`: the real-time
 * listener on `companies/{id}/integrations/sms_provider`, the
 * `inventory`/`hasCredentials`/`defaultPhoneNumber` mapping, the phone number as
 * the stable line identity used for removal, the `removePhoneLine({ companyId,
 * phoneNumber })` payload, the success / cleared-assignments / failure toast
 * wording, and the `hasCredentials` handed to `AddLineModal`.
 *
 * Presentation defects fixed: blocking `window.confirm` on the destructive
 * remove replaced with the shared accessible dialog (wording preserved); legacy
 * palette and the gradient header replaced with `--ds-*` tokens; colour-only
 * status/default pills replaced with `Badge`s carrying text + icon; the icon-only
 * remove control now has an accessible name; `text-[10px]` on the usage-type
 * chip and the security notice removed.
 *
 * The lines are an embedded `DataTable`: the number heads each row, and on a
 * phone each line is a card.
 */
export function LineManager({ companyId, companyName }) {
    const [inventory, setInventory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [hasCredentials, setHasCredentials] = useState(false);
    const { removingLine, removeLine } = useRemovePhoneLine(companyId);
    const [showAddModal, setShowAddModal] = useState(false);
    const [defaultNumber, setDefaultNumber] = useState(null);
    // Replaces the blocking `window.confirm` on remove; holds the line awaiting
    // confirmation.
    const [pendingRemove, setPendingRemove] = useState(null);

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
                        <Icon icon={Phone} size="xl" className="text-ds-content-link" />
                        Phone Line Wallet
                    </h3>
                    <p className="mt-0.5 text-ds-xs text-ds-content-muted">
                        {inventory.length} line{inventory.length !== 1 ? 's' : ''} provisioned for {companyName || 'this company'}
                    </p>
                </div>
                <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
                    <Icon icon={Plus} />
                    Add Line
                </Button>
            </div>

            {/* Empty State */}
            {inventory.length === 0 ? (
                <div className="p-12 text-center">
                    <div className="mx-auto mb-ds-4 flex h-16 w-16 items-center justify-center rounded-ds-full bg-ds-surface-subtle">
                        <Icon icon={Phone} size="3xl" className="text-ds-content-muted" />
                    </div>
                    <h4 className="mb-ds-2 font-bold text-ds-content">No Phone Lines</h4>
                    <p className="mx-auto mb-ds-6 max-w-sm text-ds-sm text-ds-content-muted">
                        Add phone lines to enable SMS functionality. Each line requires its own JWT token from RingCentral.
                    </p>
                    <Button variant="primary" onClick={() => setShowAddModal(true)}>
                        <Icon icon={Plus} />
                        Add First Line
                    </Button>
                </div>
            ) : (
                <DataTable
                    embedded
                    ariaLabel="Provisioned phone lines"
                    density="compact"
                    minWidth="standard"
                    mobilePresentation="cards"
                    data={inventory}
                    columns={lineColumns({ defaultNumber, removingLine, onRemove: setPendingRemove })}
                    getRowId={(line) => line.phoneNumber}
                />
            )}

            {/* Security Notice */}
            <div className="border-t border-ds-border-subtle bg-ds-surface-subtle px-ds-6 py-ds-3">
                <p className="flex items-center gap-1.5 text-ds-xs text-ds-content-muted">
                    <Icon icon={AlertCircle} size="xs" />
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
                    onConfirm={() => {
                        // The callable, payload and toasts live in `useRemovePhoneLine`.
                        setPendingRemove(null);
                        removeLine(pendingRemove.phoneNumber);
                    }}
                />
            )}
        </Card>
    );
}

/** The wallet's columns: number, label, status, default, and its remove action. */
function lineColumns({ defaultNumber, removingLine, onRemove }) {
    return [
        {
            key: 'phoneNumber',
            header: 'Phone Number',
            rowHeader: true,
            width: 'lg',
            render: (line) => (
                <span className="font-mono text-ds-sm font-medium text-ds-content">{line.phoneNumber}</span>
            ),
        },
        {
            key: 'label',
            header: 'Label',
            width: 'lg',
            render: (line) => (
                <span className="flex flex-wrap items-center gap-ds-2">
                    <span className="text-ds-sm text-ds-content-secondary [overflow-wrap:anywhere]">{line.label || '-'}</span>
                    {line.usageType && <Badge tone="neutral">{line.usageType}</Badge>}
                </span>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            width: 'md',
            render: (line) => (line.status === 'active' ? (
                <Badge tone="success" icon={CheckCircle}>Active</Badge>
            ) : (
                <Badge tone="warning" icon={AlertCircle}>{line.status || 'Unknown'}</Badge>
            )),
        },
        {
            key: 'default',
            header: 'Default',
            width: 'md',
            render: (line) => (line.phoneNumber === defaultNumber ? (
                <Badge tone="info" icon={User}>Default</Badge>
            ) : (
                <span className="text-ds-content-muted" aria-hidden="true">—</span>
            )),
        },
        {
            key: 'actions',
            header: 'Actions',
            align: 'end',
            width: 'actions',
            mobileLabel: '',
            render: (line) => (
                <IconButton
                    label={`Remove line ${line.phoneNumber}`}
                    variant="ghost"
                    size="sm"
                    loading={removingLine === line.phoneNumber}
                    // One removal at a time (see `useRemovePhoneLine`).
                    disabled={!!removingLine && removingLine !== line.phoneNumber}
                    onClick={() => onRemove(line)}
                >
                    <Icon icon={Trash2} className="text-ds-status-danger-fg" />
                </IconButton>
            ),
        },
    ];
}

export default LineManager;
