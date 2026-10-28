import React, { useState, useEffect, useRef } from 'react';
import { saveCompanySettings } from '@features/companies';
import { uploadCompanyLogo } from '@lib/firebase/storage';
import { Icon, Save, Edit2, Info, ListChecks, SlidersHorizontal, Blocks, FileSignature } from '@design-system/icons';
import { useToast } from '@shared/components/feedback';
import { useData } from '@/context/DataContext';
import { Button, TabList, TabPanel } from '@/design-system/components';
import { PageHeader } from '@/design-system/layouts';
import { useUnsavedChanges } from '@/design-system/patterns';
import { CompanyInfoSection, QuestionsTabContent } from './profile';
import { ApplicationRulesPanel } from './rules/ApplicationRulesPanel';
import { ApplicationIntegrationsPanel } from './rules/ApplicationIntegrationsPanel';
import { AgreementsPanel } from './rules/AgreementsPanel';
import { companyDetailsFields, companyDetailsOf } from '@features/companies/services/companyDetails';
import { withoutBlankOptions } from '@/config/customQuestionOptions';
import { isCompanyAdminForRoute, isSuperAdminClaims } from '@app/auth/roles';

// The Company Information fields, which "Edit Profile" opens and Cancel puts back.
const INFO_FIELDS = ['companyName', ...Object.keys(companyDetailsOf({}))];

export function CompanyProfileTab({ currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const { currentUserClaims } = useData();

    const [activeTab, setActiveTab] = useState('info');
    const [compData, setCompData] = useState({});
    const [loading, setLoading] = useState(false);
    const [logoUploading, setLogoUploading] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    // An open edit is unsaved work: leaving asks first.
    useUnsavedChanges(isEditing);
    const editButtonRef = useRef(null);
    const wasEditingRef = useRef(false);
    // The information as it was when editing began.
    const editStartRef = useRef({});

    const isSuperAdmin = isSuperAdminClaims(currentUserClaims);
    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, currentCompanyProfile?.id);

    useEffect(() => {
        if (currentCompanyProfile) {
            setCompData({
                companyName: currentCompanyProfile.companyName || '',
                // Either shape: a company the older Create screen made holds flat details.
                ...companyDetailsOf(currentCompanyProfile),
                companyLogoUrl: currentCompanyProfile.companyLogoUrl || '',
                applicationConfig: currentCompanyProfile.applicationConfig || {},
                customQuestions: currentCompanyProfile.customQuestions || [],
                // Undefined until the company has rules or integrations of its own,
                // so a company that never opens those tabs saves exactly what it
                // always saved and keeps the platform defaults.
                applicationRules: currentCompanyProfile.applicationRules,
                applicationIntegrations: currentCompanyProfile.applicationIntegrations,
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
                ...companyDetailsFields(compData, currentCompanyProfile),
                applicationConfig: compData.applicationConfig,
                // An option whose text was cleared is no choice: a driver's page cannot draw it.
                customQuestions: withoutBlankOptions(compData.customQuestions),
                companyLogoUrl: compData.companyLogoUrl,
                applicationRules: compData.applicationRules,
                applicationIntegrations: compData.applicationIntegrations,
            };
            await saveCompanySettings(currentCompanyProfile.id, payload);
            setCompData(prev => ({ ...prev, customQuestions: payload.customQuestions }));
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

    const startEditing = () => {
        editStartRef.current = Object.fromEntries(INFO_FIELDS.map((field) => [field, compData[field]]));
        setIsEditing(true);
    };

    // Puts the information back as it was, so a later save cannot store what
    // was cancelled. The other sections keep their own changes.
    const cancelEditing = () => {
        setCompData(prev => ({ ...prev, ...editStartRef.current }));
        setIsEditing(false);
    };

    // The application's settings, in the order a company thinks about them:
    // which questions are asked, what happens when an answer needs more attention,
    // and which optional data sources help the applicant answer.
    const tabs = [
        { id: 'info', label: 'Company Information', icon: Info },
        { id: 'questions', label: 'Application Form Questions', icon: ListChecks },
        { id: 'rules', label: 'Application Rules', icon: SlidersHorizontal },
        { id: 'agreements', label: 'Agreements', icon: FileSignature },
        { id: 'integrations', label: 'Application Integrations', icon: Blocks },
    ];

    return (
        <div className="space-y-ds-6">
            <PageHeader
                title="Company profile"
                description="Manage your public presence and application settings."
                actions={(isCompanyAdmin || isEditing) && (<>
                {isCompanyAdmin && !isEditing && (
                    <Button
                        variant="secondary"
                        ref={editButtonRef}
                        onClick={startEditing}
                    >
                        <Icon icon={Edit2} />
                        Edit Profile
                    </Button>
                )}
                {isEditing && (
                    <div className="flex flex-wrap gap-ds-2">
                        {/* Not while a save is on its way: it stores the edit, and Cancel
                            would put back what it replaced, for the next save to store. */}
                        <Button
                            variant="ghost"
                            onClick={cancelEditing}
                            disabled={loading}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            loading={loading}
                            onClick={handleSaveCompany}
                        >
                            {!loading && <Icon icon={Save} />}
                            Save Changes
                        </Button>
                    </div>
                )}
                </>)}
            />

            {/*
              This was a row of plain `<button>`s with `activeTab` state and a
              coloured bottom border: tab BEHAVIOUR with no tab semantics at all.
              No `role="tablist"`, no `role="tab"`, no `aria-selected`, no
              `aria-controls`, no roving `tabIndex` and no arrow keys — so
              assistive technology could not tell it was a tab interface or say
              which section was current, and it was the only such strip left in
              the product. A tablist rule cannot see such a strip, precisely
              because it has no `role="tablist"` to match; the hand-styled
              button check is what catches it.
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
                {activeTab === 'rules' && (
                    <div className="space-y-ds-4">
                        <ApplicationRulesPanel
                            rules={compData.applicationRules}
                            readOnly={!isCompanyAdmin}
                            onChange={(nextRules) => setCompData(prev => ({ ...prev, applicationRules: nextRules }))}
                        />
                        {isCompanyAdmin && (
                            <div className="flex justify-end">
                                <Button variant="primary" loading={loading} onClick={handleSaveCompany}>
                                    {!loading && <Icon icon={Save} />}
                                    Save Application Rules
                                </Button>
                            </div>
                        )}
                    </div>
                )}
                {activeTab === 'agreements' && (
                    <AgreementsPanel companyId={currentCompanyProfile.id} canPublish={isSuperAdmin} />
                )}
                {activeTab === 'integrations' && (
                    <div className="space-y-ds-4">
                        <ApplicationIntegrationsPanel
                            integrations={compData.applicationIntegrations}
                            readOnly={!isCompanyAdmin}
                            onChange={(next) => setCompData(prev => ({ ...prev, applicationIntegrations: next }))}
                        />
                        {isCompanyAdmin && (
                            <div className="flex justify-end">
                                <Button variant="primary" loading={loading} onClick={handleSaveCompany}>
                                    {!loading && <Icon icon={Save} />}
                                    Save Integrations
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </TabPanel>
        </div>
    );
}
