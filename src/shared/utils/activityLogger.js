import { addDoc, collection, serverTimestamp, doc, getDoc } from "firebase/firestore";
import { db, auth } from "@lib/firebase";

export async function logActivity(companyId, collectionName, docId, action, details, type = 'user') {
    try {
        if (!companyId || !docId) {
            console.error("Missing companyId or docId for activity log");
            return;
        }

        let authorName = "System";
        let authorId = "system";

        if (auth.currentUser) {
            authorId = auth.currentUser.uid;
            if (auth.currentUser.displayName) {
                authorName = auth.currentUser.displayName;
            } else {
                authorName = auth.currentUser.email;
            }
        }

        const validCollection = (collectionName === 'leads' || collectionName === 'companies' || collectionName === 'company_leads' || collectionName === 'my_leads') ? 'leads' : 'applications';

        const logsRef = collection(db, "companies", companyId, validCollection, docId, "activity_logs");

        await addDoc(logsRef, {
            action,
            details,
            type,
            performedBy: authorId,
            performedByName: authorName,
            timestamp: serverTimestamp()
        });

    } catch (error) {
        console.error("Failed to log activity:", error);
    }
}
