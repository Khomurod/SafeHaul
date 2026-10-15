/**
 * Firebase Storage, kept out of `config.js` and the `@lib/firebase` barrel so a
 * page that never touches a file does not download the Storage SDK (11 kB of
 * the first download's gzip). Only the features that upload or read files import
 * this module, so the SDK arrives with them.
 */
import {
    getStorage,
    ref,
    getDownloadURL,
    uploadBytes
} from "firebase/storage";
import { app } from './config.js';

export const storage = getStorage(app);

export async function uploadCompanyLogo(companyId, file) {
    if (!companyId || !file) {
        throw new Error("Company ID and file are required for upload.");
    }
    
    const fileExtension = file.name.split('.').pop();
    const storagePath = `company_assets/${companyId}/logo.${fileExtension}`;
    const fileRef = ref(storage, storagePath);

    try {
        const snapshot = await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        return downloadURL;
    } catch (error) {
        console.error("Error uploading company logo:", error);
        throw new Error("File upload failed. Please try again.");
    }
}
