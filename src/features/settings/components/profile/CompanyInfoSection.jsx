import React from 'react';
import {
    Card,
    FieldDisplay,
    FormField,
    FormSection,
    Input,
} from '@/design-system/components';
import { BrandingSection } from './BrandingSection';

function ProfileField({
    field,
    id,
    label,
    value,
    fallback,
    isEditing,
    onFieldChange,
    type = 'text',
    maxLength,
    emphasis = 'normal',
}) {
    if (!isEditing) {
        return (
            <FieldDisplay label={label} emphasis={emphasis}>
                {value || fallback}
            </FieldDisplay>
        );
    }

    return (
        <FormField id={id} label={label}>
            <Input
                type={type}
                name={field}
                value={value || ''}
                maxLength={maxLength}
                autoFocus={field === 'companyName'}
                onChange={(event) => onFieldChange(field, event.target.value)}
            />
        </FormField>
    );
}

export function CompanyInfoSection({
    compData,
    isEditing,
    logoUploading,
    onLogoUpload,
    onFieldChange,
}) {
    return (
        <div
            className="space-y-ds-6 animate-in slide-in-from-bottom-2"
            data-testid="company-information"
        >
            <Card
                padding="lg"
                className="flex min-w-0 flex-col gap-ds-8 md:flex-row"
                aria-label="Company identity"
            >
                <BrandingSection
                    companyLogoUrl={compData.companyLogoUrl}
                    isEditing={isEditing}
                    logoUploading={logoUploading}
                    onLogoUpload={onLogoUpload}
                />

                <div className="grid w-full min-w-0 flex-1 gap-ds-5">
                    <ProfileField
                        field="companyName"
                        id="company-profile-company-name"
                        label="Company Name"
                        value={compData.companyName}
                        fallback="Not Set"
                        isEditing={isEditing}
                        onFieldChange={onFieldChange}
                        emphasis="strong"
                    />

                    <div className="grid min-w-0 grid-cols-1 gap-ds-4 sm:grid-cols-2">
                        <ProfileField
                            field="mcNumber"
                            id="company-profile-mc-number"
                            label="MC Number"
                            value={compData.mcNumber}
                            fallback="N/A"
                            isEditing={isEditing}
                            onFieldChange={onFieldChange}
                        />
                        <ProfileField
                            field="dotNumber"
                            id="company-profile-dot-number"
                            label="DOT Number"
                            value={compData.dotNumber}
                            fallback="N/A"
                            isEditing={isEditing}
                            onFieldChange={onFieldChange}
                        />
                    </div>
                </div>
            </Card>

            <div className="grid min-w-0 grid-cols-1 gap-ds-6 lg:grid-cols-2">
                <ContactInfoCard
                    compData={compData}
                    isEditing={isEditing}
                    onFieldChange={onFieldChange}
                />
                <AddressCard
                    compData={compData}
                    isEditing={isEditing}
                    onFieldChange={onFieldChange}
                />
            </div>
        </div>
    );
}

function ContactInfoCard({ compData, isEditing, onFieldChange }) {
    return (
        <FormSection title="Contact Info">
            <ProfileField
                field="phone"
                id="company-profile-phone"
                label="Phone"
                value={compData.phone}
                fallback="N/A"
                isEditing={isEditing}
                onFieldChange={onFieldChange}
            />
            <ProfileField
                field="email"
                id="company-profile-email"
                label="Email"
                value={compData.email}
                fallback="N/A"
                isEditing={isEditing}
                onFieldChange={onFieldChange}
                type="email"
            />
        </FormSection>
    );
}

function AddressCard({ compData, isEditing, onFieldChange }) {
    return (
        <FormSection title="HQ Address">
            <ProfileField
                field="street"
                id="company-profile-street"
                label="Street"
                value={compData.street}
                fallback="N/A"
                isEditing={isEditing}
                onFieldChange={onFieldChange}
            />
            <div className="grid min-w-0 grid-cols-1 gap-ds-4 sm:grid-cols-3">
                <ProfileField
                    field="city"
                    id="company-profile-city"
                    label="City"
                    value={compData.city}
                    fallback="N/A"
                    isEditing={isEditing}
                    onFieldChange={onFieldChange}
                />
                <ProfileField
                    field="state"
                    id="company-profile-state"
                    label="State"
                    value={compData.state}
                    fallback="XX"
                    isEditing={isEditing}
                    onFieldChange={onFieldChange}
                    maxLength={2}
                />
                <ProfileField
                    field="zip"
                    id="company-profile-zip"
                    label="Zip"
                    value={compData.zip}
                    fallback="00000"
                    isEditing={isEditing}
                    onFieldChange={onFieldChange}
                />
            </div>
        </FormSection>
    );
}
