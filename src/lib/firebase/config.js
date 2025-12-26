import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

// Use environment variables if available, otherwise fall back to hardcoded values.
// This prevents crashes on Vercel if Env Vars aren't set up yet.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBD2Zd4qjZCdqf3B2Gd13xjooTicvc-tXY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "truckerapp-system.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "truckerapp-system",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "truckerapp-system.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "725898258453",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:725898258453:web:5a5f0490e7baf3e518061c"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

console.log("Firebase has been connected securely!");