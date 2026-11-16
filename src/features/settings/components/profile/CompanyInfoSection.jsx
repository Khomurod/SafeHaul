import React from 'react';
import {
    FieldDisplay,
    FormField,
    FormSection,
    Input,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
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

/*
 * C2 Company profile: three sections whose headings sit above their cards.
 * The layout follows the room the settings content gives it (a size
 * container), not the window: Contact Info and HQ Address sit side by side
 * only while the column holds both at 371px or more (HQ's City | State | Zip
 * row needs that), which is a 1440px window beside the settings rail.
 */
export function CompanyInfoSection({
    compData,
    isEditing,
    plan,
    logoUploading,
    onLogoUpload,
    onFieldChange,
}) {
    const companyName = (
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
    );

    return (
        <Stack gap="xl" data-testid="company-information">
            <FormSection
                layout="stacked"
                title="Company"
                description="Name and logo, as drivers see them."
            >
                {/* The logo with the name beside it; while editing, the upload
                    beside the logo and the name a field of its own under it.
                    Tab order: logo, name, MC, DOT. */}
                <div className="flex min-w-0 items-center gap-ds-4 md:gap-ds-5">
                    <BrandingSection
                        companyLogoUrl={compData.companyLogoUrl}
                        isEditing={isEditing}
                        logoUploading={logoUploading}
                        onLogoUpload={onLogoUpload}
                    />
                    {!isEditing && <div className="min-w-0 flex-1">{companyName}</div>}
                </div>
                {isEditing && companyName}

                {/* MC | DOT share their gutter with the two cards below when those
                    sit side by side, so MC ends where Contact Info does. */}
                <div className="grid min-w-0 grid-cols-2 gap-x-ds-4 gap-y-ds-5 md:gap-x-ds-5 [@container_(min-width:766px)]:gap-x-ds-6">
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

                    {/* Read only, so it is not among the fields Edit Profile opens. */}
                    {!isEditing && plan && (
                        <FieldDisplay label="Plan" className="col-span-2">
                            {plan} — to change it, contact support.
                        </FieldDisplay>
                    )}
                </div>
            </FormSection>

            <div className="grid min-w-0 grid-cols-1 items-start gap-ds-8 [@container_(min-width:766px)]:grid-cols-2 [@container_(min-width:766px)]:gap-ds-6">
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
        </Stack>
    );
}

function ContactInfoCard({ compData, isEditing, onFieldChange }) {
    return (
        <FormSection layout="stacked" title="Contact Info" description="How drivers reach you.">
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
        <FormSection layout="stacked" title="HQ Address" description="Your main office.">
            <ProfileField
                field="street"
                id="company-profile-street"
                label="Street"
                value={compData.street}
                fallback="N/A"
                isEditing={isEditing}
                onFieldChange={onFieldChange}
            />
            {/* City takes the room; State holds two letters and Zip five
                digits. On a phone City has the row and State | Zip share
                the next. */}
            <div className="grid min-w-0 grid-cols-2 gap-x-ds-4 gap-y-ds-5 md:grid-cols-[minmax(0,1fr)_4rem_5.5rem] md:gap-x-ds-5">
                <div className="col-span-2 min-w-0 md:col-span-1">
                    <ProfileField
                        field="city"
                        id="company-profile-city"
                        label="City"
                        value={compData.city}
                        fallback="N/A"
                        isEditing={isEditing}
                        onFieldChange={onFieldChange}
                    />
                </div>
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
