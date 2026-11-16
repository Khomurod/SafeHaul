import React from 'react';
import { FieldMessage, FileInput } from '@/design-system/components';
import { COMPANY_SIGNATURE_ACCEPT } from '@features/signing/utils/companySignature';
import { useCompanySignatureUpload } from '@features/signing/hooks/useCompanySignatureUpload';
import { CompanySignatureImage } from './CompanySignatureImage';

/**
 * A company signature's image and the picker that uploads or replaces it, for
 * the editor's properties panel and the template wizard. The new image belongs
 * to the field it is given for — this document, or this template — and nothing
 * else: `onUploaded(path)` stores it there.
 */
export function CompanySignatureUpload({ companyId, path, onUploaded, hint, label = 'Company signature image' }) {
    const { uploading, error, upload } = useCompanySignatureUpload({ companyId, onUploaded });
    const hasImage = String(path || '').trim() !== '';

    return (
        <div className="flex flex-col gap-ds-2">
            <div className="flex h-24 items-center justify-center overflow-hidden rounded-ds-md border border-ds-border bg-ds-surface p-ds-2">
                {hasImage ? (
                    <CompanySignatureImage
                        path={path}
                        className="max-h-full max-w-full object-contain"
                        placeholder={<span className="text-ds-sm text-ds-content-secondary">Loading image…</span>}
                    />
                ) : (
                    <span className="text-ds-sm text-ds-content-secondary">No image yet.</span>
                )}
            </div>
            <FileInput
                label={label}
                accept={COMPANY_SIGNATURE_ACCEPT}
                description="PNG or JPEG, up to 2 MB. The signer sees it as it is and cannot change it."
                loading={uploading}
                buttonLabel={hasImage ? 'Replace image' : 'Upload image'}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) upload(file);
                }}
            />
            {error && <FieldMessage tone="error">{error}</FieldMessage>}
            {hint && <FieldMessage tone="help">{hint}</FieldMessage>}
        </div>
    );
}

export default CompanySignatureUpload;
