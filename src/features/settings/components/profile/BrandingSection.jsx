import React, { useId } from 'react';
import { Icon, Building } from '@design-system/icons';
import { FieldMessage, FileInput } from '@/design-system/components';

/**
 * Company logo preview + upload affordance.
 *
 * Presentation only. Upload and persistence stay in the feature parent: the
 * native file input's change event is forwarded verbatim through `onLogoUpload`,
 * which owns `uploadCompanyLogo` (Storage) and `saveCompanySettings` (Firestore).
 * This component adds no Company, Firebase, or branding knowledge.
 *
 * The picker is the design system's `FileInput`, which owns the `loading` state
 * it needs. Same reasoning as `ProfileAvatarField`: the accessible name belongs
 * on the field rather than on a trigger, and the `role="status"` region and the
 * focus-restoring effect live in `FileInput`, beside the `loading` prop that
 * causes both. `aria-busy` and the button text announce nothing, so they cannot
 * replace the region.
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
        <div className="flex min-w-0 items-center gap-ds-4 md:gap-ds-5">
            <div className="flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface-subtle">
                {companyLogoUrl ? (
                    <img
                        src={companyLogoUrl}
                        alt="Company logo"
                        className="h-full w-full object-contain"
                    />
                ) : (
                    /*
                      The FRAME owns this glyph's size, the same answer 7a gave
                      `StatusMedallion`. The frame is 72px (C2: the logo stands
                      beside the company name), and 28px is 39% of it — inside
                      the published band (Tailwind UI 50%, Material 3 50-60%,
                      shadcn's avatar fallback 40%, this product's own medallion
                      37.5% at `md`). The contract's scale has 24px (`2xl`, 33%)
                      and 32px (`3xl`, 44%) either side of it, so the size stays
                      and lives on the container, where resizing the frame
                      carries it. Recorded in the roadmap's open "Tinted icon
                      tile" row as its second measured instance.
                    */
                    <span
                        role="img"
                        aria-label="No company logo set"
                        className="flex h-full w-full items-center justify-center [&>svg]:h-7 [&>svg]:w-7"
                    >
                        <Icon icon={Building} className="text-ds-content-muted" />
                    </span>
                )}
            </div>

            {isEditing && (
                <div className="flex min-w-0 flex-col items-start gap-ds-2">
                    {/* The preview beside it already says what this field is, so
                        the label is hidden — the accessible name stays. */}
                    <FileInput
                        id={inputId}
                        label="Company logo"
                        labelHidden
                        accept="image/*"
                        size="sm"
                        loading={logoUploading}
                        aria-describedby={helpId}
                        onChange={onLogoUpload}
                        buttonLabel={logoUploading
                            ? 'Uploading…'
                            : companyLogoUrl
                                ? 'Change logo'
                                : 'Upload logo'}
                    />
                    <FieldMessage id={helpId} tone="help" className="[text-wrap:pretty]">
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
