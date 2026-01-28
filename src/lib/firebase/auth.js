import { auth } from './config.js';
import { 
    signInWithEmailAndPassword, 
    signOut,
    getIdTokenResult
} from "firebase/auth";

export async function getUserClaims(user, forceRefresh = false) {
    if (!user) return null;
    try {
        const idTokenResult = await getIdTokenResult(user, forceRefresh);
        return idTokenResult.claims;
    } catch (error) {
        console.error("Error getting user claims:", error);
        return null;
    }
}

export async function handleLogin(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        console.log("User logged in:", userCredential.user.uid);
        return userCredential;
    } catch (error) {
        console.error("Login Error:", error.code, error.message);
        switch (error.code) {
            case 'auth/user-not-found':
            case 'auth/invalid-email':
                throw new Error('No account found with that email address.');
            case 'auth/wrong-password':
            case 'auth/invalid-credential':
                throw new Error('Incorrect password. Please try again.');
            case 'auth/too-many-requests':
                throw new Error('Access temporarily disabled due to too many failed login attempts. Please reset your password or try again later.');
            default:
                throw new Error('An unknown error occurred. Please try again.');
        }
    }
}

export function handleLogout() {
    signOut(auth).catch((error) => {
        console.error("Error signing out:", error);
    });
}
