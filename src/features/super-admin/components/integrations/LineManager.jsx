import React, { useState, useEffect, useCallback } from 'react';
import { Phone, Plus, Trash2, RefreshCw, AlertCircle, CheckCircle, User } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { AddLineModal } from './AddLineModal';

/**
 * Line Manager - Super Admin interface for managing the "Digital Wallet"
 * Lists all provisioned phone lines and allows adding/removing lines with per-line JWTs
 */
export function LineManager({ companyId, companyName }) {
    const { showSuccess, showError } = useToast();
    const [inventory, setInventory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [hasCredentials, setHasCredentials] = useState(false);
    const [removingLine, setRemovingLine] = useState(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [defaultNumber, setDefaultNumber] = useState(null);

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

    const handleRemoveLine = useCallback(async (phoneNumber) => {
        if (!window.confirm(`Are you sure you want to remove ${phoneNumber}? Any users assigned to this line will be unassigned.`)) {
            return;
        }

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
            <div className="bg-white border border-gray-200 rounded-xl p-8 flex flex-col items-center justify-center gap-4">
                <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                <p className="text-gray-500 font-medium">Loading phone lines...</p>
            </div>
        );
    }

    return (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                    <h3 className="font-bold text-gray-900 flex items-center gap-2">
                        <Phone className="text-blue-600" size={20} />
                        Phone Line Wallet
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {inventory.length} line{inventory.length !== 1 ? 's' : ''} provisioned for {companyName || 'this company'}
                    </p>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center gap-2 text-sm transition-colors shadow-sm"
                >
                    <Plus size={16} />
                    Add Line
                </button>
            </div>

            {/* Empty State */}
            {inventory.length === 0 ? (
                <div className="p-12 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Phone className="w-8 h-8 text-gray-400" />
                    </div>
                    <h4 className="font-bold text-gray-800 mb-2">No Phone Lines</h4>
                    <p className="text-sm text-gray-500 max-w-sm mx-auto mb-6">
                        Add phone lines to enable SMS functionality. Each line requires its own JWT token from RingCentral.
                    </p>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg inline-flex items-center gap-2 transition-colors"
                    >
                        <Plus size={16} />
                        Add First Line
                    </button>
                </div>
            ) : (
                /* Lines Table */
                <table className="w-full">
                    <thead className="bg-gray-50 text-xs font-bold text-gray-500 uppercase">
                        <tr>
                            <th className="px-6 py-3 text-left">Phone Number</th>
                            <th className="px-6 py-3 text-left">Label</th>
                            <th className="px-6 py-3 text-center">Status</th>
                            <th className="px-6 py-3 text-center">Default</th>
                            <th className="px-6 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {inventory.map((line) => (
                            <tr
                                key={line.phoneNumber}
                                className="hover:bg-gray-50 transition-colors"
                            >
                                <td className="px-6 py-4">
                                    <span className="font-mono text-sm font-medium text-gray-900">
                                        {line.phoneNumber}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="text-sm text-gray-600">
                                        {line.label || '-'}
                                    </span>
                                    {line.usageType && (
                                        <span className="ml-2 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                                            {line.usageType}
                                        </span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-center">
                                    {line.status === 'active' ? (
                                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                                            <CheckCircle size={12} />
                                            Active
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 bg-orange-50 px-2 py-1 rounded-full">
                                            <AlertCircle size={12} />
                                            {line.status || 'Unknown'}
                                        </span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-center">
                                    {line.phoneNumber === defaultNumber ? (
                                        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-1 rounded-full">
                                            <User size={12} />
                                            Default
                                        </span>
                                    ) : (
                                        <span className="text-gray-300">-</span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <button
                                        onClick={() => handleRemoveLine(line.phoneNumber)}
                                        disabled={removingLine === line.phoneNumber}
                                        className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition-colors disabled:opacity-50"
                                        title="Remove Line"
                                    >
                                        {removingLine === line.phoneNumber ? (
                                            <RefreshCw size={16} className="animate-spin" />
                                        ) : (
                                            <Trash2 size={16} />
                                        )}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {/* Security Notice */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
                <p className="text-[10px] text-gray-400 flex items-center gap-1.5">
                    <AlertCircle size={10} />
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
        </div>
    );
}
