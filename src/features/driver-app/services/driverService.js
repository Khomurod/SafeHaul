import {
    doc,
    updateDoc,
    setDoc,
    getDoc,
    getDocs,
    collection,
    query,
    where,
    documentId,
    serverTimestamp,
    collectionGroup
} from "firebase/firestore";
import { db, storage } from '@lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// --- Offer Logic ---
export async function respondToOffer(companyId, applicationId, response, signatureData = null) {
    if (!companyId || !applicationId) throw new Error("Missing ID");

    // Determine path based on whether it's a company app or a general lead
    const docRef = (companyId === 'general-leads')
        ? doc(db, "leads", applicationId)
        : doc(db, "companies", companyId, "applications", applicationId);

    const updatePayload = {
        status: response,
        [`offerDetails.response`]: response,
        [`offerDetails.respondedAt`]: new Date().toISOString(),
        offerResponseDate: serverTimestamp()
    };

    if (signatureData) {
        updatePayload[`offerDetails.signature`] = signatureData;
    }

    await updateDoc(docRef, updatePayload);
    return true;
}

// --- Dashboard Data Fetching ---
export async function fetchDriverProfile(uid) {
    try {
        const docRef = doc(db, "drivers", uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data();
        }
        return null;
    } catch (error) {
        console.error("Error fetching profile:", error);
        return null;
    }
}

export async function fetchMyApplications(email, userId) {
    // We need at least one identifier
    if (!email && !userId) return [];

    const results = [];
    const processedIds = new Set(); // To prevent duplicates

    // --- Helper to add docs to results safely ---
    const addDocs = (snapshot, isGeneral = false) => {
        snapshot.docs.forEach(doc => {
            // Avoid duplicates if we query by both Email and UID
            if (processedIds.has(doc.id)) return;
            processedIds.add(doc.id);

            const data = doc.data();
            const companyId = isGeneral ? 'general-leads' : (doc.ref.parent.parent ? doc.ref.parent.parent.id : 'unknown');

            results.push({
                id: `${doc.id}_${companyId}`, // Unique React Key
                originalId: doc.id,           // Real Firestore ID
                companyId: companyId,
                companyName: isGeneral ? 'SafeHaul General Pool' : (data.companyName || 'Unknown Company'),
                isGeneral: isGeneral,
                ...data
            });
        });
    };

    // --- 1. Fetch Company Applications ---
    // We try querying by Driver ID first (more reliable), then by Email (for legacy)
    try {
        // Strategy A: By Driver ID (New System)
        if (userId) {
            const idQuery = query(
                collectionGroup(db, 'applications'),
                where('driverId', '==', userId)
            );
            const idSnap = await getDocs(idQuery);
            addDocs(idSnap, false);
        }

        // Strategy B: By Email (Legacy / Fallback)
        if (email) {
            const emailQuery = query(
                collectionGroup(db, 'applications'),
                where('email', '==', email)
            );
            const emailSnap = await getDocs(emailQuery);
            addDocs(emailSnap, false);
        }
    } catch (error) {
        console.error("Error fetching company applications:", error);
        // We continue to leads even if this fails
    }

    // --- 2. Fetch General Leads (Root Collection) ---
    try {
        if (userId) {
            // Check for direct lead doc by ID
            const leadDocRef = doc(db, 'leads', userId);
            const leadDocSnap = await getDoc(leadDocRef);
            if (leadDocSnap.exists()) {
                // Manually construct snapshot-like object
                const fakeSnapshot = { docs: [leadDocSnap] };
                addDocs(fakeSnapshot, true);
            }
        }

        // Also check by email in leads collection (if multiple leads exist)
        if (email) {
            const leadsQuery = query(
                collection(db, 'leads'),
                where('email', '==', email)
            );
            const leadsSnap = await getDocs(leadsQuery);
            addDocs(leadsSnap, true);
        }
    } catch (error) {
        console.warn("Error fetching leads:", error);
    }

    // --- 3. Sort In-Memory (Robust) ---
    // This fixes the issue where documents without 'submittedAt' were disappearing
    return results.sort((a, b) => {
        const getMillis = (item) => {
            if (item.submittedAt?.seconds) return item.submittedAt.seconds;
            if (item.createdAt?.seconds) return item.createdAt.seconds;
            return 0;
        };
        return getMillis(b) - getMillis(a); // Newest first
    });
}

export async function fetchRecommendedJobs(driverType) {
    if (!driverType) return [];
    try {
        const companiesRef = collection(db, "companies");
        const q = query(companiesRef, where(`hiringPreferences.${driverType}`, "==", true));
        const snapshot = await getDocs(q);

        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
        console.error("Error finding jobs:", e);
        return [];
    }
}

export async function getSavedJobs(driverId) {
    if (!driverId) return [];
    try {
        const savedRef = collection(db, "drivers", driverId, "saved_jobs");
        const snapshot = await getDocs(savedRef);
        const savedIds = snapshot.docs.map(doc => doc.id);

        if (savedIds.length === 0) return [];

        const chunks = [];
        for (let i = 0; i < savedIds.length; i += 10) {
            chunks.push(savedIds.slice(i, i + 10));
        }

        let allSavedCompanies = [];
        for (const chunk of chunks) {
            const q = query(collection(db, "companies"), where(documentId(), "in", chunk));
            const snap = await getDocs(q);
            const companies = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            allSavedCompanies = [...allSavedCompanies, ...companies];
        }
        return allSavedCompanies;

    } catch (e) {
        console.error("Error fetching saved jobs:", e);
        return [];
    }
}

// --- Application Logic ---
export async function uploadApplicationFile(companyId, userId, fieldName, file) {
    if (!file) return null;
    const basePath = companyId
        ? `companies/${companyId}/applications/${userId}`
        : `global_leads/${userId}`;

    const storagePath = `${basePath}/${fieldName}/${Date.now()}_${file.name}`;
    const fileRef = ref(storage, storagePath);

    await uploadBytes(fileRef, file);
    const downloadURL = await getDownloadURL(fileRef);

    return {
        name: file.name,
        url: downloadURL,
        storagePath: storagePath
    };
}

export async function submitDriverApplication(currentUser, formData, activeCompanyId, job) {
    const timestamp = serverTimestamp();

    // Prepare Payload
    const finalData = {
        ...formData,
        signature: formData.signature,
        signatureType: formData.signatureType || 'drawn',
        userId: currentUser.uid,
        driverId: currentUser.uid,
        status: 'New Application',
        submittedAt: timestamp,
        createdAt: timestamp,
        sourceType: activeCompanyId ? 'Company App' : 'Global Pool',
        companyId: activeCompanyId || 'general-leads',
        // --- NEW: Job specific data ---
        jobId: job?.id || null,
        jobTitle: job?.title || null
    };

    // Determine Destination
    let docRef;
    if (activeCompanyId) {
        docRef = doc(db, "companies", activeCompanyId, "applications", currentUser.uid);
    } else {
        docRef = doc(db, "leads", currentUser.uid);
    }

    await setDoc(docRef, finalData);
    return true;
}