// src/features/settings/components/CompanyProfileTab.jsx
import React, { useState, useEffect } from 'react';
import { saveCompanySettings } from '@features/companies/services/companyService';
import { uploadCompanyLogo } from '@lib/firebase';
import { 
    Building, Save, Loader2, Edit2, 
    MapPin, Phone, Hash, HelpCircle, Briefcase, Info, ListChecks 
} from 'lucide-react';
import { useToast } from '@shared/components/feedback';
import { useData } from '@/context/DataContext';

// --- SUB-COMPONENTS ---
import { CustomQuestionsBuilder } from './questions/CustomQuestionsBuilder';
import { StandardQuestionsConfig } from './questions/StandardQuestionsConfig';
import { HiringPositionsBuilder } from './hiring/HiringPositionsBuilder';
import { INITIAL_HIRING_STATE } from './hiring/HiringConfig';

export function CompanyProfileTab({ currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const { currentUserClaims } = useData();

    const [activeTab, setActiveTab] = useState('info'); // 'info', 'questions', 'hiring'
    const [compData, setCompData] = useState({});
    const [loading, setLoading] = useState(false);
    const [logoUploading, setLogoUploading] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    // Permission Check
    const isCompanyAdmin = currentUserClaims?.roles?.[currentCompanyProfile.id] === 'company_admin' 
                           || currentUserClaims?.roles?.globalRole === 'super_admin';

    useEffect(() => {
        if (currentCompanyProfile) {
            setCompData({
                companyName: currentCompanyProfile.companyName || '',
                phone: currentCompanyProfile.contact?.phone || '',
                email: currentCompanyProfile.contact?.email || '',
                street: currentCompanyProfile.address?.street || '',
                city: currentCompanyProfile.address?.city || '',
                state: currentCompanyProfile.address?.state || '',
                zip: currentCompanyProfile.address?.zip || '',
                mcNumber: currentCompanyProfile.legal?.mcNumber || '',
                dotNumber: currentCompanyProfile.legal?.dotNumber || '',
                companyLogoUrl: currentCompanyProfile.companyLogoUrl || '',

                // Configurations
                applicationConfig: currentCompanyProfile.applicationConfig || {},
                customQuestions: currentCompanyProfile.customQuestions || [],

                // Hiring Structure
                hiringPositions: currentCompanyProfile.hiringPositions || INITIAL_HIRING_STATE
            });
        }
    }, [currentCompanyProfile]);

    const handleSaveCompany = async () => {
        setLoading(true);
        try {
            const payload = {
                companyName: compData.companyName,
                contact: { phone: compData.phone, email: compData.email },
                address: { street: compData.street, city: compData.city, state: compData.state, zip: compData.zip },
                legal: { mcNumber: compData.mcNumber, dotNumber: compData.dotNumber },

                // Saved Data
                applicationConfig: compData.applicationConfig,
                customQuestions: compData.customQuestions,
                hiringPositions: compData.hiringPositions,

                companyLogoUrl: compData.companyLogoUrl
            };

            await saveCompanySettings(currentCompanyProfile.id, payload);
            showSuccess('Company settings saved successfully.');
            setIsEditing(false);
        } catch (error) {
            console.error("Save failed", error);
            showError("Failed to save settings: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLogoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setLogoUploading(true);
        try {
            const downloadURL = await uploadCompanyLogo(currentCompanyProfile.id, file);
            await saveCompanySettings(currentCompanyProfile.id, { companyLogoUrl: downloadURL });
            setCompData(prev => ({ ...prev, companyLogoUrl: downloadURL }));
            showSuccess("Logo uploaded successfully!");
        } catch (error) {
            console.error("Logo failed", error);
            showError("Logo upload failed: " + error.message);
        } finally {
            setLogoUploading(false);
        }
    };

    return (
        <div className="space-y-6 max-w-6xl animate-in fade-in">

            {/* --- HEADER & ACTIONS --- */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end border-b border-gray-200 pb-4 gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Company Profile</h2>
                    <p className="text-sm text-gray-500 mt-1">Manage your public presence and application settings.</p>
                </div>

                {isCompanyAdmin && !isEditing && (
                    <button 
                        onClick={() => setIsEditing(true)}
                        className="px-4 py-2 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 flex items-center gap-2 shadow-sm transition-all"
                    >
                        <Edit2 size={16} /> Edit Profile
                    </button>
                )}

                {isEditing && (
                    <div className="flex gap-2">
                        <button 
                            onClick={() => { setIsEditing(false); }}
                            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleSaveCompany} 
                            disabled={loading}
                            className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-md flex items-center gap-2 disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save Changes
                        </button>
                    </div>
                )}
            </div>

            {/* --- TABS NAVIGATION --- */}
            <div className="flex border-b border-gray-200 overflow-x-auto no-scrollbar">
                <button
                    onClick={() => setActiveTab('info')}
                    className={`px-4 py-3 text-sm font-medium border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
                        activeTab === 'info' 
                        ? 'border-blue-600 text-blue-600' 
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <Info size={16} /> Company Information
                </button>
                <button
                    onClick={() => setActiveTab('questions')}
                    className={`px-4 py-3 text-sm font-medium border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
                        activeTab === 'questions' 
                        ? 'border-blue-600 text-blue-600' 
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <ListChecks size={16} /> Application Form Questions
                </button>
                <button
                    onClick={() => setActiveTab('hiring')}
                    className={`px-4 py-3 text-sm font-medium border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
                        activeTab === 'hiring' 
                        ? 'border-blue-600 text-blue-600' 
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <Briefcase size={16} /> Hiring Positions & Offers
                </button>
            </div>

            {/* --- TAB CONTENT --- */}

            {/* 1. COMPANY INFORMATION */}
            {activeTab === 'info' && (
                <div className="space-y-6 animate-in slide-in-from-bottom-2">
                    <div className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col md:flex-row gap-8 shadow-sm">
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-32 h-32 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-200 overflow-hidden shadow-inner">
                                {compData.companyLogoUrl ? (
                                    <img src={compData.companyLogoUrl} alt="Logo" className="w-full h-full object-contain" />
                                ) : (
                                    <Building className="text-gray-400" size={48} />
                                )}
                            </div>
                            {isEditing && (
                                <label className="cursor-pointer px-3 py-1.5 bg-blue-50 text-blue-600 rounded-md text-xs font-bold hover:bg-blue-100 transition-colors">
                                    {logoUploading ? 'Uploading...' : 'Change Logo'}
                                    <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} disabled={logoUploading} />
                                </label>
                            )}
                        </div>

                        <div className="flex-1 space-y-4 w-full">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Company Name</label>
                                {isEditing ? (
                                    <input 
                                        type="text" 
                                        value={compData.companyName || ''} 
                                        onChange={(e) => setCompData({ ...compData, companyName: e.target.value })} 
                                        className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-900" 
                                    />
                                ) : (
                                    <p className="text-xl font-bold text-gray-900">{compData.companyName || 'Not Set'}</p>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">MC Number</label>
                                    {isEditing ? (
                                        <div className="relative">
                                            <Hash size={14} className="absolute left-3 top-3 text-gray-400" />
                                            <input 
                                                type="text" 
                                                value={compData.mcNumber || ''} 
                                                onChange={(e) => setCompData({ ...compData, mcNumber: e.target.value })} 
                                                className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                            />
                                        </div>
                                    ) : (
                                        <p className="text-sm font-medium text-gray-800 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                                            {compData.mcNumber || 'N/A'}
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">DOT Number</label>
                                    {isEditing ? (
                                        <div className="relative">
                                            <Hash size={14} className="absolute left-3 top-3 text-gray-400" />
                                            <input 
                                                type="text" 
                                                value={compData.dotNumber || ''} 
                                                onChange={(e) => setCompData({ ...compData, dotNumber: e.target.value })} 
                                                className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                            />
                                        </div>
                                    ) : (
                                        <p className="text-sm font-medium text-gray-800 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                                            {compData.dotNumber || 'N/A'}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                            <h3 className="font-bold text-gray-900 border-b border-gray-100 pb-2 mb-4 flex items-center gap-2">
                                <Phone size={18} className="text-blue-600" /> Contact Info
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Phone</label>
                                    {isEditing ? (
                                        <input 
                                            type="text" 
                                            value={compData.phone || ''} 
                                            onChange={(e) => setCompData({ ...compData, phone: e.target.value })} 
                                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                        />
                                    ) : (
                                        <p className="text-sm font-medium text-gray-800">{compData.phone || 'N/A'}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                                    {isEditing ? (
                                        <input 
                                            type="email" 
                                            value={compData.email || ''} 
                                            onChange={(e) => setCompData({ ...compData, email: e.target.value })} 
                                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                        />
                                    ) : (
                                        <p className="text-sm font-medium text-gray-800">{compData.email || 'N/A'}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                            <h3 className="font-bold text-gray-900 border-b border-gray-100 pb-2 mb-4 flex items-center gap-2">
                                <MapPin size={18} className="text-blue-600" /> HQ Address
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Street</label>
                                    {isEditing ? (
                                        <input 
                                            type="text" 
                                            value={compData.street || ''} 
                                            onChange={(e) => setCompData({ ...compData, street: e.target.value })} 
                                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                        />
                                    ) : (
                                        <p className="text-sm font-medium text-gray-800">{compData.street || 'N/A'}</p>
                                    )}
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="col-span-1">
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">City</label>
                                        {isEditing ? (
                                            <input 
                                                type="text" 
                                                value={compData.city || ''} 
                                                onChange={(e) => setCompData({ ...compData, city: e.target.value })} 
                                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                            />
                                        ) : (
                                            <p className="text-sm font-medium text-gray-800">{compData.city || 'N/A'}</p>
                                        )}
                                    </div>
                                    <div className="col-span-1">
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">State</label>
                                        {isEditing ? (
                                            <input 
                                                type="text" 
                                                value={compData.state || ''} 
                                                onChange={(e) => setCompData({ ...compData, state: e.target.value })} 
                                                maxLength={2}
                                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                            />
                                        ) : (
                                            <p className="text-sm font-medium text-gray-800">{compData.state || 'XX'}</p>
                                        )}
                                    </div>
                                    <div className="col-span-1">
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Zip</label>
                                        {isEditing ? (
                                            <input 
                                                type="text" 
                                                value={compData.zip || ''} 
                                                onChange={(e) => setCompData({ ...compData, zip: e.target.value })} 
                                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                            />
                                        ) : (
                                            <p className="text-sm font-medium text-gray-800">{compData.zip || '00000'}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 2. APPLICATION FORM QUESTIONS */}
            {activeTab === 'questions' && (
                <div className="space-y-8 animate-in slide-in-from-bottom-2">
                    {/* Standard Questions Config */}
                    <div>
                        <div className="mb-4">
                            <h3 className="text-lg font-bold text-gray-900">Standard DOT Questions</h3>
                            <p className="text-sm text-gray-500">Configure visibility and requirements for standard application fields.</p>
                        </div>

                        {isCompanyAdmin ? (
                            <StandardQuestionsConfig 
                                config={compData.applicationConfig}
                                onChange={(newConfig) => setCompData({...compData, applicationConfig: newConfig})}
                            />
                        ) : (
                             <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center text-gray-500">
                                <p>Read-only view for standard questions.</p>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-gray-200 pt-6">
                        <div className="mb-6">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <HelpCircle size={20} className="text-blue-600"/> Custom Questions
                            </h3>
                            <p className="text-sm text-gray-500">Add specific questions for your company (e.g. "Do you have flatbed experience?").</p>
                        </div>

                        {isCompanyAdmin ? (
                            <CustomQuestionsBuilder 
                                questions={compData.customQuestions || []}
                                onChange={(updatedQuestions) => setCompData({...compData, customQuestions: updatedQuestions})}
                                onSave={handleSaveCompany}
                                loading={loading}
                            />
                        ) : (
                            <div className="p-6 bg-gray-50 border border-gray-200 rounded-xl text-center text-gray-500">
                                <p>Only Company Admins can edit application questions.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 3. HIRING POSITIONS & OFFERS */}
            {activeTab === 'hiring' && (
                <div className="animate-in slide-in-from-bottom-2">
                    <div className="mb-6">
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <Briefcase size={20} className="text-blue-600"/> Hiring Positions & Offers
                        </h3>
                        <p className="text-sm text-gray-500">Configure pay structures, benefits, and logistics for your open positions.</p>
                    </div>

                    {isCompanyAdmin ? (
                        <HiringPositionsBuilder 
                            data={compData.hiringPositions}
                            onChange={(newData) => setCompData({...compData, hiringPositions: newData})}
                            isCompanyAdmin={true}
                        />
                    ) : (
                        <div className="p-6 bg-gray-50 border border-gray-200 rounded-xl text-center text-gray-500">
                            <p>Only Company Admins can configure hiring positions.</p>
                        </div>
                    )}
                </div>
            )}

        </div>
    );
}