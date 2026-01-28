import React, { useState, useEffect } from 'react';
import { saveCompanySettings } from '@features/companies/services/companyService';
import { uploadCompanyLogo } from '@lib/firebase';
import { Save, Loader2, Edit2, Info, ListChecks, Briefcase } from 'lucide-react';
import { useToast } from '@shared/components/feedback';
import { useData } from '@/context/DataContext';
import { INITIAL_HIRING_STATE } from './hiring/HiringConfig';
import { CompanyInfoSection, QuestionsTabContent, HiringTabContent } from './profile';

export function CompanyProfileTab({ currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const { currentUserClaims } = useData();

    const [activeTab, setActiveTab] = useState('info');
    const [compData, setCompData] = useState({});
    const [loading, setLoading] = useState(false);
    const [logoUploading, setLogoUploading] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

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
                applicationConfig: currentCompanyProfile.applicationConfig || {},
                customQuestions: currentCompanyProfile.customQuestions || [],
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

    const handleFieldChange = (field, value) => {
        setCompData(prev => ({ ...prev, [field]: value }));
    };

    const tabs = [
        { id: 'info', label: 'Company Information', icon: Info },
        { id: 'questions', label: 'Application Form Questions', icon: ListChecks }
    ];

    return (
        <div className="space-y-6 max-w-6xl animate-in fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end border-b border-gray-200 pb-4 gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Company Profile</h2>
                    <p className="text-sm text-gray-500 mt-1">Manage your public presence and application settings.</p>
                </div>
                {isCompanyAdmin && !isEditing && (
                    <button onClick={() => setIsEditing(true)} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 flex items-center gap-2 shadow-sm transition-all">
                        <Edit2 size={16} /> Edit Profile
                    </button>
                )}
                {isEditing && (
                    <div className="flex gap-2">
                        <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors">Cancel</button>
                        <button onClick={handleSaveCompany} disabled={loading} className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-md flex items-center gap-2 disabled:opacity-50">
                            {loading ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save Changes
                        </button>
                    </div>
                )}
            </div>

            <div className="flex border-b border-gray-200 overflow-x-auto no-scrollbar">
                {tabs.map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-3 text-sm font-medium border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                        <tab.icon size={16} /> {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === 'info' && (
                <CompanyInfoSection compData={compData} isEditing={isEditing} logoUploading={logoUploading} onLogoUpload={handleLogoUpload} onFieldChange={handleFieldChange} />
            )}
            {activeTab === 'questions' && (
                <QuestionsTabContent compData={compData} isCompanyAdmin={isCompanyAdmin} onConfigChange={(newConfig) => setCompData(prev => ({ ...prev, applicationConfig: newConfig }))} onQuestionsChange={(updatedQuestions) => setCompData(prev => ({ ...prev, customQuestions: updatedQuestions }))} onSave={handleSaveCompany} loading={loading} />
            )}
            {activeTab === 'hiring' && (
                <HiringTabContent compData={compData} isCompanyAdmin={isCompanyAdmin} onHiringChange={(newData) => setCompData(prev => ({ ...prev, hiringPositions: newData }))} />
            )}
        </div>
    );
}
