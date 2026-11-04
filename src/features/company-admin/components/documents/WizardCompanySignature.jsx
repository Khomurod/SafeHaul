import React from 'react';
import { CompanySignatureUpload } from '@features/signing/components/CompanySignatureUpload';

/**
 * The template wizard's company signature: the image this document will carry.
 * It starts as the template's; a new one is uploaded for this document only and
 * the template keeps its own (`useTemplateSendFlow`'s `companySignature`). The
 * send is refused while one has no image.
 */
export function WizardCompanySignature({ companySignature }) {
    const { companyId, fields, replace } = companySignature;
    if (fields.length === 0) return null;

    return (
        <section aria-labelledby="send-wizard-company-signature" className="flex flex-col gap-ds-2">
            <h3
                id="send-wizard-company-signature"
                className="text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary"
            >
                Company signature
            </h3>
            <p className="text-ds-sm text-ds-content-secondary">
                This document starts with the template&apos;s image. A new image is used for this document only; the
                template keeps its own.
            </p>
            {fields.map((field, index) => (
                <CompanySignatureUpload
                    key={field.id}
                    companyId={companyId}
                    path={field.companySignaturePath}
                    onUploaded={(path) => replace(field.id, path)}
                    label={fields.length > 1 ? `Company signature image ${index + 1}` : 'Company signature image'}
                />
            ))}
        </section>
    );
}

export default WizardCompanySignature;
