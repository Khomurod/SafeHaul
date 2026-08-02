import React, { useEffect, useId, useRef } from 'react';
import { Building } from 'lucide-react';
import { Button, FieldMessage } from '@/design-system/components';

/**
 * Company logo preview + upload affordance.
 *
 * Presentation only. Upload and persistence stay in the feature parent: the
 * native file input's change event is forwarded verbatim through `onLogoUpload`,
 * which owns `uploadCompanyLogo` (Storage) and `saveCompanySettings` (Firestore).
 * This component adds no Company, Firebase, or branding knowledge.
 *
 * Accessibility: the design system has no approved file-input primitive yet, so
 * this is a documented feature-level composition. A visually hidden but
 * labelled native input is triggered by the approved keyboard-accessible
 * Button (no nested interactive elements); an assertive-free `role="status"`
 * region announces uploading; focus returns to the trigger after an upload.
 */
export function BrandingSection({
    companyLogoUrl,
    isEditing,
    logoUploading,
    onLogoUpload,
}) {
    const inputRef = useRef(null);
    const buttonRef = useRef(null);
    const wasUploadingRef = useRef(false);

    const rawId = useId().replace(/:/g, '');
    const inputId = `company-logo-input-${rawId}`;
    const helpId = `company-logo-help-${rawId}`;
    const statusId = `company-logo-status-${rawId}`;

    // Return focus to the upload trigger once an in-flight upload settles, so
    // keyboard users are not dropped after the button briefly disables.
    useEffect(() => {
        if (wasUploadingRef.current && !logoUploading) {
            buttonRef.current?.focus();
        }
        wasUploadingRef.current = logoUploading;
    }, [logoUploading]);

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
                    <input
                        ref={inputRef}
                        id={inputId}
                        type="file"
                        accept="image/*"
                        className="ds-visually-hidden"
                        tabIndex={-1}
                        aria-label="Upload company logo"
                        aria-describedby={helpId}
                        onChange={onLogoUpload}
                        disabled={logoUploading}
                    />
                    <Button
                        ref={buttonRef}
                        type="button"
                        variant="secondary"
                        size="md"
                        loading={logoUploading}
                        aria-describedby={helpId}
                        onClick={() => inputRef.current?.click()}
                    >
                        {logoUploading
                            ? 'Uploading…'
                            : companyLogoUrl
                                ? 'Change logo'
                                : 'Upload logo'}
                    </Button>
                    <FieldMessage id={helpId} tone="help" className="text-center">
                        {companyLogoUrl
                            ? 'A logo is set. Uploading a new image replaces it.'
                            : 'No logo uploaded yet.'}{' '}
                        Accepts image files (e.g. PNG, JPG, or SVG).
                    </FieldMessage>
                    <p id={statusId} role="status" className="ds-visually-hidden">
                        {logoUploading ? 'Uploading company logo…' : ''}
                    </p>
                </div>
            )}
        </div>
    );
}
