import React, { useId } from 'react';
import { Building } from 'lucide-react';
import { FieldMessage, FileInput } from '@/design-system/components';

/**
 * Company logo preview + upload affordance.
 *
 * Presentation only. Upload and persistence stay in the feature parent: the
 * native file input's change event is forwarded verbatim through `onLogoUpload`,
 * which owns `uploadCompanyLogo` (Storage) and `saveCompanySettings` (Firestore).
 * This component adds no Company, Firebase, or branding knowledge.
 *
 * The picker is the design system's `FileInput` (2026-08-25), which is where the
 * `loading` state it needed now lives. It was a hidden input driven by a `Button`
 * calling `.click()` on it, under a comment saying the design system had no
 * file-input primitive — untrue from 2026-08-21. Same change, and the same
 * reasoning, as `ProfileAvatarField`: the accessible name belongs on the field
 * rather than on the trigger, and `aria-busy` plus the label text replace the
 * `role="status"` region and the focus-restoring effect.
 */
export function BrandingSection({
    companyLogoUrl,
    isEditing,
    logoUploading,
    onLogoUpload,
}) {
    const rawId = useId().replace(/:/g, '');
    const inputId = `company-logo-input-${rawId}`;
    const helpId = `company-logo-help-${rawId}`;

    return (
        <div className="flex flex-col items-center gap-ds-3">
            <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface-subtle">
                {companyLogoUrl ? (
                    <img
                        src={companyLogoUrl}
                        alt="Company logo"
                        className="h-full w-full object-contain"
                    />
                ) : (
                    <span
                        role="img"
                        aria-label="No company logo set"
                        className="flex h-full w-full items-center justify-center"
                    >
                        <Building className="text-ds-content-muted" size={48} aria-hidden="true" />
                    </span>
                )}
            </div>

            {isEditing && (
                <div className="flex w-full max-w-[16rem] flex-col items-center gap-ds-2">
                    {/* The preview above already says what this field is, so the
                        label is hidden — the accessible name stays. */}
                    <FileInput
                        id={inputId}
                        label="Company logo"
                        labelHidden
                        accept="image/*"
                        loading={logoUploading}
                        aria-describedby={helpId}
                        onChange={onLogoUpload}
                        buttonLabel={logoUploading
                            ? 'Uploading…'
                            : companyLogoUrl
                                ? 'Change logo'
                                : 'Upload logo'}
                    />
                    <FieldMessage id={helpId} tone="help" className="text-center">
                        {companyLogoUrl
                            ? 'A logo is set. Uploading a new image replaces it.'
                            : 'No logo uploaded yet.'}{' '}
                        Accepts image files (e.g. PNG, JPG, or SVG).
                    </FieldMessage>
                </div>
            )}
        </div>
    );
}
