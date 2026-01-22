import { storage } from './config.js';
import { 
    ref, 
    getDownloadURL,
    uploadBytes
} from "firebase/storage";

export async function getFileUrl(storagePath) {
    if (!storagePath) {
        console.warn("No storage path provided.");
        return null;
    }
    try {
        const fileRef = ref(storage, storagePath);
        const url = await getDownloadURL(fileRef);
        return url;
    } catch (error) {
        console.error("Error getting file URL for path:", storagePath, error);
        if (error.code === 'storage/object-not-found') {
            console.warn("File not found at path:", storagePath);
        }
        return null;
    }
}

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
