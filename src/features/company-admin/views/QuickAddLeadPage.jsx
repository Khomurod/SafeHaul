import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { db } from '@lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { PlusCircle, User, Phone, Mail, MapPin, Truck, Save, X } from 'lucide-react';

export const QuickAddLeadPage = () => {
    const { currentCompanyProfile, currentUser } = useData();
    const { showSuccess, showError } = useToast();
    const navigate = useNavigate();
    const companyId = currentCompanyProfile?.id;

    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        phone: '',
        email: '',
        city: '',
        state: '',
        yearsExperience: '',
        cdlClass: 'A',
        notes: ''
    });
    const [isSaving, setIsSaving] = useState(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Security: Ensure companyId exists before write
        if (!companyId) {
            showError('No company selected. Cannot add lead.');
            return;
        }

        if (!formData.firstName || !formData.lastName || !formData.phone) {
            showError('Please fill in required fields (First Name, Last Name, Phone).');
            return;
        }

        setIsSaving(true);
        try {
            const leadData = {
                ...formData,
                name: `${formData.firstName} ${formData.lastName}`.trim(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                status: 'New',
                isPlatformLead: false, // This is a company lead
                source: 'manual_entry',
                createdBy: currentUser?.uid || 'unknown',
            };

            await addDoc(collection(db, 'companies', companyId, 'leads'), leadData);
            showSuccess('Lead added successfully!');
            navigate('/company/drivers/leads/company');
        } catch (err) {
            console.error('Error adding lead:', err);
            showError('Failed to add lead. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    // Guard: No company selected
    if (!companyId) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-gray-50 p-8">
                <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center border border-gray-200">
                    <h2 className="text-xl font-bold text-gray-900 mb-2">No Company Selected</h2>
                    <p className="text-gray-600 mb-6">
                        Please select a company before adding leads.
                    </p>
                    <button
                        onClick={() => navigate('/company/settings')}
                        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
                    >
                        Select Company
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-gray-50">
            {/* Page Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
                <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <PlusCircle size={24} className="text-purple-600" />
                    Quick Add Lead
                </h1>
                <p className="text-sm text-gray-500">Manually add a new lead to your pipeline.</p>
            </div>

            {/* Form Content */}
            <div className="flex-1 overflow-auto p-6">
                <form onSubmit={handleSubmit} className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">

                    {/* Name Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                <User size={14} className="inline mr-1" /> First Name *
                            </label>
                            <input
                                type="text"
                                name="firstName"
                                value={formData.firstName}
                                onChange={handleChange}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                placeholder="John"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                            <input
                                type="text"
                                name="lastName"
                                value={formData.lastName}
                                onChange={handleChange}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                placeholder="Doe"
                                required
                            />
                        </div>
                    </div>

                    {/* Contact Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                <Phone size={14} className="inline mr-1" /> Phone *
                            </label>
                            <input
                                type="tel"
                                name="phone"
                                value={formData.phone}
                                onChange={handleChange}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                placeholder="(555) 123-4567"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                <Mail size={14} className="inline mr-1" /> Email
                            </label>
                            <input
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                placeholder="john.doe@email.com"
                            />
                        </div>
                    </div>

                    {/* Location Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                <MapPin size={14} className="inline mr-1" /> City
                            </label>
                            <input
                                type="text"
                                name="city"
                                value={formData.city}
                                onChange={handleChange}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                placeholder="Dallas"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                            <input
                                type="text"
                                name="state"
                                value={formData.state}
                                onChange={handleChange}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                placeholder="TX"
                            />
                        </div>
                    </div>

                    {/* Experience Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                <Truck size={14} className="inline mr-1" /> Years of Experience
                            </label>
                            <input
                                type="number"
                                name="yearsExperience"
                                value={formData.yearsExperience}
                                onChange={handleChange}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                placeholder="5"
                                min="0"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">CDL Class</label>
                            <select
                                name="cdlClass"
                                value={formData.cdlClass}
                                onChange={handleChange}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                            >
                                <option value="A">Class A</option>
                                <option value="B">Class B</option>
                                <option value="C">Class C</option>
                                <option value="None">No CDL</option>
                            </select>
                        </div>
                    </div>

                    {/* Notes */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                        <textarea
                            name="notes"
                            value={formData.notes}
                            onChange={handleChange}
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                            placeholder="Any additional notes about this lead..."
                        />
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                        <button
                            type="button"
                            onClick={() => navigate('/company/dashboard')}
                            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition font-medium flex items-center gap-2"
                        >
                            <X size={16} /> Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-semibold flex items-center gap-2 disabled:opacity-50"
                        >
                            <Save size={16} /> {isSaving ? 'Saving...' : 'Save Lead'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default QuickAddLeadPage;
