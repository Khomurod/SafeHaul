// src/features/auth/services/authService.js
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from '@lib/firebase';

// --- LOGIN ---
export async function loginUser(email, password) {
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        return result.user;
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
        case 'auth/invalid-email':
            return new Error('Please enter a valid email address.');
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