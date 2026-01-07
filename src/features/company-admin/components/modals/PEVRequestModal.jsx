import React, { useState } from 'react';
import { X, Mail, Printer, Send, ShieldCheck, Info, FileText } from 'lucide-react';

export function PEVRequestModal({ employer, applicant, onClose, onProceed }) {
    const [deliveryMethod, setDeliveryMethod] = useState('email');
    const [contactInfo, setContactInfo] = useState({
        email: employer.email || '',
        fax: employer.fax || '',
        phone: employer.phone || ''
    });

    const methods = [
        { id: 'email', label: 'E-mail Delivery', icon: Mail, description: 'Send a digital form link to the employer.', active: !!employer.email },
        { id: 'fax', label: 'Fax Transmission', icon: Printer, description: 'Electronic fax delivery to the carrier.', active: !!employer.fax },
        { id: 'manual', label: 'Download / Print', icon: FileText, description: 'Download PDF to mail or email manually.', active: true }
    ];

    return (
        <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="bg-slate-900 p-6 text-white relative">
                    <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition">
                        <X size={20} />
                    </button>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-blue-500 rounded-lg">
                            <ShieldCheck size={24} />
                        </div>
                        <h3 className="text-xl font-bold">Initiate Verification</h3>
                    </div>
                    <p className="text-slate-400 text-sm">Verify employment for <span className="text-white font-semibold">{employer.name}</span></p>
                </div>

                <div className="p-6 space-y-6">
                    {/* Method Selection */}
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Select Delivery Method</label>
                        <div className="grid gap-3">
                            {methods.map((m) => (
                                <button
                                    key={m.id}
                                    onClick={() => setDeliveryMethod(m.id)}
                                    className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left group ${deliveryMethod === m.id
                                        ? 'border-blue-600 bg-blue-50'
                                        : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                                        }`}
                                >
                                    <div className={`p-3 rounded-lg transition-colors ${deliveryMethod === m.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200'
                                        }`}>
                                        <m.icon size={20} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                            <span className={`font-bold ${deliveryMethod === m.id ? 'text-blue-900' : 'text-gray-700'}`}>{m.label}</span>
                                            {!m.active && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold uppercase">Missing Info</span>}
                                        </div>
                                        <p className="text-xs text-gray-500 mt-0.5">{m.description}</p>
                                    </div>
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${deliveryMethod === m.id ? 'border-blue-600 bg-blue-600' : 'border-gray-200'
                                        }`}>
                                        {deliveryMethod === m.id && <div className="w-2 h-2 rounded-full bg-white" />}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Conditional Input */}
                    {deliveryMethod === 'email' && (
                        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 animate-in slide-in-from-top-2">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Recipient Email Address</label>
                            <div className="relative">
                                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="email"
                                    value={contactInfo.email}
                                    onChange={(e) => setContactInfo({ ...contactInfo, email: e.target.value })}
                                    className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-600 outline-none transition-all"
                                    placeholder="hr@company.com"
                                />
                            </div>
                        </div>
                    )}

                    {deliveryMethod === 'fax' && (
                        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 animate-in slide-in-from-top-2">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Recipient Fax Number</label>
                            <div className="relative">
                                <Printer size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="tel"
                                    value={contactInfo.fax}
                                    onChange={(e) => setContactInfo({ ...contactInfo, fax: e.target.value })}
                                    className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-600 outline-none transition-all"
                                    placeholder="(555) 000-0000"
                                />
                            </div>
                        </div>
                    )}

                    {/* Legal Note */}
                    <div className="flex gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
                        <Info size={18} className="text-amber-600 shrink-0" />
                        <p className="text-[11px] text-amber-800 leading-relaxed font-medium">
                            Verifications are performed in compliance with FMCSA 49 CFR Part 391.23. The driver's signed authorization is attached to the request automatically.
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors border border-gray-200 bg-white"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            if (deliveryMethod === 'email' && !contactInfo.email) {
                                return alert("Please provide a valid recipient email.");
                            }
                            if (deliveryMethod === 'fax' && !contactInfo.fax) {
                                return alert("Please provide a valid fax number.");
                            }
                            onProceed(deliveryMethod, contactInfo);
                        }}
                        className="flex-1 py-3 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-md shadow-blue-100 flex items-center justify-center gap-2"
                    >
                        <Send size={18} />
                        {deliveryMethod === 'manual' ? 'Preview & Print' : 'Continue to Preview'}
                    </button>
                </div>
            </div>
        </div>
    );
}
