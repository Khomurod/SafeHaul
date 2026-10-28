import React, { useState, useEffect, useRef } from 'react';
import { saveCompanySettings } from '@features/companies';
import { uploadCompanyLogo } from '@lib/firebase/storage';
import { Icon, Save, Edit2 } from '@design-system/icons';
import { useToast } from '@shared/components/feedback';
import { useData } from '@/context/DataContext';
import { Button } from '@/design-system/components';
import { PageHeader } from '@/design-system/layouts';
import { useUnsavedChanges } from '@/design-system/patterns';
import { CompanyInfoSection } from './profile';
import { companyDetailsFields, companyDetailsOf } from '@features/companies/services/companyDetails';
import { isCompanyAdminForRoute } from '@app/auth/roles';

// The Company Information fields, which "Edit Profile" opens and Cancel puts back.
const INFO_FIELDS = ['companyName', ...Object.keys(companyDetailsOf({}))];

/**
 * Settings → Company profile: the company's name, logo, contact details and
 * address, as drivers see them. "Edit Profile" opens the fields; Save stores
 * them through `saveCompanySettings` with only these keys. The application
 * form has its own section (`ApplicationFormTab`).
 */
export function CompanyProfileTab({ currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const { currentUserClaims, applyCompanyChanges } = useData();

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

    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, currentCompanyProfile?.id);

    // The company as saved; while the fields are open, what is typed stays.
    useEffect(() => {
        if (currentCompanyProfile && !isEditing) {
            setCompData({
                companyName: currentCompanyProfile.companyName || '',
                // Either shape: a company the older Create screen made holds flat details.
                ...companyDetailsOf(currentCompanyProfile),
                companyLogoUrl: currentCompanyProfile.companyLogoUrl || '',
            });
        }
        // Only a new copy of the company re-syncs; closing the fields keeps what they hold.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
                companyLogoUrl: compData.companyLogoUrl,
            };
            const written = await saveCompanySettings(currentCompanyProfile.id, payload);
            // The company in use takes what was written (the header's name, a return here).
            applyCompanyChanges(currentCompanyProfile.id, written);
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
            const written = await saveCompanySettings(currentCompanyProfile.id, { companyLogoUrl: downloadURL });
            applyCompanyChanges(currentCompanyProfile.id, written);
            setCompData(prev => ({ ...prev, companyLogoUrl: downloadURL }));
            showSuccess("Logo uploaded successfully!");
        } catch (error) {
            console.error("Logo failed", error);
            showError("Logo upload failed: " + error.message);
        } finally {
            setLogoUploading(false);
        }
    };

    // While a save is on its way the fields hold still: what is typed then
    // would be neither saved nor kept once the save closes them.
    const handleFieldChange = (field, value) => {
        if (loading) return;
        setCompData(prev => ({ ...prev, [field]: value }));
    };

    const startEditing = () => {
        editStartRef.current = Object.fromEntries(INFO_FIELDS.map((field) => [field, compData[field]]));
        setIsEditing(true);
    };

    // Puts the information back as it was, so a later save cannot store what
    // was cancelled.
    const cancelEditing = () => {
        setCompData(prev => ({ ...prev, ...editStartRef.current }));
        setIsEditing(false);
    };

    return (
        <div className="space-y-ds-6">
            <PageHeader
                title="Company profile"
                description="Your name, logo, contact details and address, as drivers see them."
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

            <CompanyInfoSection compData={compData} isEditing={isEditing} logoUploading={logoUploading} onLogoUpload={handleLogoUpload} onFieldChange={handleFieldChange} />
        </div>
    );
}
