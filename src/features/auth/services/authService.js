// src/features/auth/services/authService.js
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updateProfile,
    sendPasswordResetEmail
} from "firebase/auth";
import { doc, setDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from '@lib/firebase';

// --- LOGIN ---
export async function loginUser(email, password) {
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        return result.user;
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

// --- PASSWORD RESET ---
export async function resetPassword(email) {
    try {
        await sendPasswordResetEmail(auth, email);
        return { success: true };
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