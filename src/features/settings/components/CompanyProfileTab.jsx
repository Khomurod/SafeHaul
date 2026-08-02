import React, { useState, useEffect, useRef } from 'react';
import { saveCompanySettings } from '@features/companies';
import { uploadCompanyLogo } from '@lib/firebase';
import { Save, Edit2, Info, ListChecks } from 'lucide-react';
import { useToast } from '@shared/components/feedback';
import { useData } from '@/context/DataContext';
import { Button } from '@/design-system/components';
import { CompanyInfoSection, QuestionsTabContent } from './profile';

export function CompanyProfileTab({ currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const { currentUserClaims } = useData();

    const [activeTab, setActiveTab] = useState('info');
    const [compData, setCompData] = useState({});
    const [loading, setLoading] = useState(false);
    const [logoUploading, setLogoUploading] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const editButtonRef = useRef(null);
    const wasEditingRef = useRef(false);

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
            });
        }
    }, [currentCompanyProfile]);

    useEffect(() => {
        if (wasEditingRef.current && !isEditing) {
            editButtonRef.current?.focus();
        }
        wasEditingRef.current = isEditing;
    }, [isEditing]);

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
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end border-b border-ds-border-subtle pb-4 gap-4">
                <div>
                    <h2 className="text-xl font-bold text-ds-content">Company Profile</h2>
                    <p className="text-sm text-ds-content-muted mt-1">Manage your public presence and application settings.</p>
                </div>
                {isCompanyAdmin && !isEditing && (
                    <Button
                        variant="secondary"
                        size="lg"
                        ref={editButtonRef}
                        onClick={() => setIsEditing(true)}
                    >
                        <Edit2 size={16} aria-hidden="true" />
                        Edit Profile
                    </Button>
                )}
                {isEditing && (
                    <div className="flex flex-wrap gap-ds-2">
                        <Button
                            variant="ghost"
                            size="lg"
                            onClick={() => setIsEditing(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            size="lg"
                            loading={loading}
                            onClick={handleSaveCompany}
                        >
                            {!loading && <Save size={16} aria-hidden="true" />}
                            Save Changes
                        </Button>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 sm:flex border-b border-ds-border-subtle">
                {tabs.map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`min-h-11 px-4 py-3 text-sm font-medium border-b-2 flex items-center gap-2 text-left sm:whitespace-nowrap transition-colors ${activeTab === tab.id ? 'border-ds-action-primary text-ds-content-link' : 'border-transparent text-ds-content-muted hover:text-ds-content-secondary'}`}>
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
        </div>
    );
}
