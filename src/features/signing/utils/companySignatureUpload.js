/**
 * Uploads a company signature image the way the editor uploads a document's
 * PDF (`envelopePersistence.js`): straight to Storage, where the team may write
 * images under the company's `originals`. Each upload gets its own random name,
 * so replacing a document's image never overwrites one a template or another
 * document still shows. Returns the stored path.
 */
import { storage } from '@lib/firebase/storage';
import { ref, uploadBytes } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid';
import { companySignatureStoragePath } from '@features/signing/utils/companySignature';

export async function uploadCompanySignature({ companyId, file }) {
    const path = companySignatureStoragePath(companyId, file, uuidv4());
    await uploadBytes(ref(storage, path), file, { contentType: file.type });
    return path;
}
