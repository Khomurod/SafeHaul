import React from 'react';
import { useCompanySignatureUrl } from '@features/signing/hooks/useCompanySignatureUrl';

/**
 * A company signature image in the editor, from its stored path, through a
 * short-lived link (`useCompanySignatureUrl`). Until the link arrives, or when
 * there is none, it shows `placeholder`.
 */
export function CompanySignatureImage({ path, className = '', placeholder = null }) {
    const url = useCompanySignatureUrl(path);
    if (!url) return placeholder;
    return <img src={url} alt="Company signature" className={className} draggable={false} />;
}

export default CompanySignatureImage;
