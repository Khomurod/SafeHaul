// src/features/auth/services/authService.js
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    updateProfile
} from "firebase/auth";
import { doc, setDoc, addDoc, collection, serverTimestamp, query, where, getDocs, deleteDoc } from "firebase/firestore";
import { auth, db } from '@lib/firebase';
import { normalizePhone } from '@shared/utils/helpers'; // Import normalization

// --- LOGIN ---
export async function loginUser(email, password) {
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        return result.user;
    } catch (error) {
        throw mapAuthError(error);
    }
}

// --- DRIVER REGISTRATION ---
export async function registerDriver({ email, password, firstName, lastName, phone }) {
    try {
        // 1. Create Auth User
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        const fullName = `${firstName} ${lastName}`;

        // 2. Update Auth Profile
        await updateProfile(user, { displayName: fullName });
        const timestamp = serverTimestamp();

        // 3. Create Public User Profile
        await setDoc(doc(db, "users", user.uid), {
            name: fullName,
            email: email,
            role: 'driver', // Explicit marker
            createdAt: timestamp
        });

        // 4. Create Master Driver Profile (The detailed record)
        // FIX: Generate normalized phone for consistent matching
        const cleanPhone = normalizePhone(phone);

        // --- SHADOW PROFILE MERGE LOGIC ---
        // Check if a profile already exists with this phone number (Shadow Profile)
        let existingData = {};
        if (cleanPhone) {
            try {
                const driversRef = collection(db, "drivers");
                // Look for drivers with this phone who are NOT bulk uploads (or merge bulk too)
                // We mainly want to catch leads that were converted to shadow profiles
                const q = query(driversRef, where("personalInfo.normalizedPhone", "==", cleanPhone));
                const snap = await getDocs(q);

                if (!snap.empty) {
                    const oldDoc = snap.docs[0];
                    existingData = oldDoc.data();
                    console.log(`[Auth] Found existing shadow profile (${oldDoc.id}). Merging...`);

                    // Delete the old shadow profile to avoid duplicates
                    await deleteDoc(doc(db, "drivers", oldDoc.id));
                }
            } catch (err) {
                console.warn("[Auth] Shadow profile check failed:", err);
            }
        }

        // Prepare the new profile data, prioritizing new input but keeping old history
        const newProfileData = {
            ...existingData, // Keep history/notes from shadow profile
            personalInfo: {
                ...existingData.personalInfo,
                firstName,
                lastName,
                email,
                phone: phone || '',
                normalizedPhone: cleanPhone, // <--- ADDED
                firstName_lower: firstName.toLowerCase(), // For search indexing
                lastName_lower: lastName.toLowerCase()
            },
            driverProfile: {
                ...existingData.driverProfile,
                status: 'active',
                isBulkUpload: false, // They are now a real user
                source: existingData.driverProfile?.source || 'web_signup'
            },
            // Ensure timestamps are updated
            createdAt: existingData.createdAt || timestamp, 
            updatedAt: timestamp,
            claimedAt: timestamp // Mark when they claimed the account
        };

        await setDoc(doc(db, "drivers", user.uid), newProfileData);
        return user;
    } catch (error) {
        throw mapAuthError(error);
    }
}

// --- COMPANY REGISTRATION ---
export async function registerCompany({ email, password, fullName, companyName, phone }) {
    try {
        // 1. Create Auth User
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 2. Update Auth Profile
        await updateProfile(user, { displayName: fullName });
        const timestamp = serverTimestamp();

        // 3. Create Public User Profile
        await setDoc(doc(db, "users", user.uid), {
            name: fullName,
            email: email,
            createdAt: timestamp
        });

        // 4. Create Company Document
        const companyRef = await addDoc(collection(db, "companies"), {
            companyName: companyName,
            createdAt: timestamp,
            ownerId: user.uid,
            contact: {
                email: email,
                phone: phone || ''
            },
            planType: 'free', // Default to free plan
            appSlug: companyName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.floor(Math.random() * 1000)
        });

        // 5. Create Membership (triggers Cloud Function for 'company_admin' claim)
        await addDoc(collection(db, "memberships"), {
            userId: user.uid,
            companyId: companyRef.id,
            role: 'company_admin',
            createdAt: timestamp
        });

        return user;
    } catch (error) {
        throw mapAuthError(error);
    }
}

// --- HELPER: Error Mapping ---
function mapAuthError(error) {
    console.error("Auth Error:", error.code, error.message);
    switch (error.code) {
        case 'auth/email-already-in-use':
            return new Error('This email is already registered. Please log in.');
        case 'auth/invalid-email':
            return new Error('Please enter a valid email address.');
        case 'auth/weak-password':
            return new Error('Password should be at least 6 characters.');
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            return new Error('Invalid email or password.');
        case 'auth/too-many-requests':
            return new Error('Too many failed attempts. Please try again later.');
        default:
            return new Error('An unexpected error occurred. Please try again.');
    }
}