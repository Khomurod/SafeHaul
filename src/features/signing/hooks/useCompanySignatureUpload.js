/**
 * Choosing a company signature image: refuse what cannot be one (a PNG or JPEG
 * of up to 2 MB, `companySignature.js`), upload the rest
 * (`companySignatureUpload.js`) and hand back the stored path. One upload at a
 * time; what went wrong is said in plain words, and the image the field had is
 * kept until a new one is stored.
 *
 * The upload module, and with it the Storage SDK, loads on the first upload: the
 * template wizard lives in the Documents workspace, which otherwise never
 * touches a file.
 */
import { useCallback, useRef, useState } from 'react';
import { companySignatureImageError } from '@features/signing/utils/companySignature';

const loadUpload = () => import('@features/signing/utils/companySignatureUpload');

export function useCompanySignatureUpload({ companyId, onUploaded }) {
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const busyRef = useRef(false);

    const upload = useCallback(async (file) => {
        if (busyRef.current) return;
        const refusal = companySignatureImageError(file);
        if (refusal) {
            setError(refusal);
            return;
        }
        busyRef.current = true;
        setUploading(true);
        setError('');
        try {
            const { uploadCompanySignature } = await loadUpload();
            onUploaded(await uploadCompanySignature({ companyId, file }));
        } catch (err) {
            console.error('[company signature] Upload failed:', err);
            setError('The image could not be uploaded. Try again.');
        } finally {
            busyRef.current = false;
            setUploading(false);
        }
    }, [companyId, onUploaded]);

    return { uploading, error, upload };
}
