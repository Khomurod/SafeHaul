import React, { useState, useEffect, useRef } from 'react';
import { saveCompanySettings } from '@features/companies';
import { uploadCompanyLogo } from '@lib/firebase';
import { Save, Edit2, Info, ListChecks } from 'lucide-react';
import { useToast } from '@shared/components/feedback';
import { useData } from '@/context/DataContext';
import { Button, TabList, TabPanel } from '@/design-system/components';
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
                    <h2 className="text-ds-heading-lg font-bold text-ds-content">Company Profile</h2>
                    <p className="mt-ds-1 text-ds-body text-ds-content-muted">Manage your public presence and application settings.</p>
                </div>
                {isCompanyAdmin && !isEditing && (
                    <Button
                        variant="secondary"
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
                            onClick={() => setIsEditing(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            loading={loading}
                            onClick={handleSaveCompany}
                        >
                            {!loading && <Save size={16} aria-hidden="true" />}
                            Save Changes
                        </Button>
                    </div>
                )}
            </div>

            {/*
              This was a row of plain `<button>`s with `activeTab` state and a
              coloured bottom border: tab BEHAVIOUR with no tab semantics at all.
              No `role="tablist"`, no `role="tab"`, no `aria-selected`, no
              `aria-controls`, no roving `tabIndex` and no arrow keys — so
              assistive technology could not tell it was a tab interface or say
              which section was current, and it was the only such strip left in
              the product. `check:ui-contract`'s `hand-rolled-tablist` rule could
              not see it either, precisely because it had no `role="tablist"` to
              match; the `hand-styled-button` rule is what caught it, once the
              scanner stopped truncating attribute lists at the `>` in `=>`.
            */}
            <TabList
                ariaLabel="Company profile sections"
                idBase="company-profile"
                tabs={tabs}
                activeTab={activeTab}
                onChange={setActiveTab}
            />

            <TabPanel idBase="company-profile" tabId={activeTab}>
                {activeTab === 'info' && (
                    <CompanyInfoSection compData={compData} isEditing={isEditing} logoUploading={logoUploading} onLogoUpload={handleLogoUpload} onFieldChange={handleFieldChange} />
                )}
                {activeTab === 'questions' && (
                    <QuestionsTabContent compData={compData} isCompanyAdmin={isCompanyAdmin} onConfigChange={(newConfig) => setCompData(prev => ({ ...prev, applicationConfig: newConfig }))} onQuestionsChange={(updatedQuestions) => setCompData(prev => ({ ...prev, customQuestions: updatedQuestions }))} onSave={handleSaveCompany} loading={loading} />
                )}
            </TabPanel>
        </div>
    );
}
