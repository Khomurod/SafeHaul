import React, { useState } from 'react';
import { X, UserPlus, Loader2, Phone, Mail, User } from 'lucide-react';
import { db, auth } from '@lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@shared/components/feedback/ToastProvider';

/**
 * Modal for quickly adding a new lead with basic information.
 * Used by recruiters to manually add leads they've contacted.
 */
export function QuickLeadModal({ companyId, onClose, onSuccess }) {
    const { showSuccess, showError } = useToast();
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSave = async (e) => {
        e.preventDefault();

        if (!firstName.trim() || !lastName.trim()) {
            showError("Please provide first and last name");
            return;
        }

        if (!phone.trim() && !email.trim()) {
            showError("Please provide at least a phone number or email");
            return;
        }

        setSaving(true);
        try {
            const leadsRef = collection(db, 'companies', companyId, 'leads');
            await addDoc(leadsRef, {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                phone: phone.trim() || null,
                email: email.trim() || null,
                status: 'New Lead',
                source: 'Manual Entry',
                isPlatformLead: false,
                createdAt: serverTimestamp(),
                createdBy: auth.currentUser?.uid || 'unknown',
                createdByName: auth.currentUser?.displayName || 'Unknown'
            });

            showSuccess("Lead added successfully!");
            onSuccess?.();
            onClose();
        } catch (error) {
            console.error("Error adding lead:", error);
            showError("Failed to add lead: " + error.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div
                className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 bg-gradient-to-r from-green-600 to-green-500 flex justify-between items-center">
                    <div className="flex items-center gap-3 text-white">
                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                            <UserPlus size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold">Quick Add Lead</h2>
                            <p className="text-xs text-green-100">Add a new lead to your pipeline</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-all"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSave} className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                                First Name *
                            </label>
                            <div className="relative">
                                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    value={firstName}
                                    onChange={e => setFirstName(e.target.value)}
                                    placeholder="John"
                                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
                                    required
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                                Last Name *
                            </label>
                            <div className="relative">
                                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    value={lastName}
                                    onChange={e => setLastName(e.target.value)}
                                    placeholder="Doe"
                                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                            Phone Number
                        </label>
                        <div className="relative">
                            <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="tel"
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                placeholder="(555) 123-4567"
                                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                            Email Address
                        </label>
                        <div className="relative">
                            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="john.doe@email.com"
                                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
                            />
                        </div>
                    </div>

                    <p className="text-xs text-gray-400 text-center">
                        * At least phone or email is required
                    </p>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 px-4 py-2.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition shadow-lg shadow-green-100 flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {saving ? (
                                <Loader2 className="animate-spin" size={18} />
                            ) : (
                                <UserPlus size={18} />
                            )}
                            {saving ? 'Adding...' : 'Add Lead'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
