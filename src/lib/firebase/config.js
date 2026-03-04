import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  memoryLocalCache,
  getFirestore
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

// ... Configuration remains the same ...
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase with HMR safety
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// --- APP CHECK: Bot Mitigation (reCAPTCHA Enterprise) ---
// Only initialized in PRODUCTION. On localhost, App Check is skipped entirely
// to avoid 403 errors from unregistered debug tokens.
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

if (recaptchaSiteKey && !isLocalhost) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true
  });
  // App Check initialized
} else if (isLocalhost) {
  // App Check skipped on localhost (production only)
} else {
  console.warn("⚠️ App Check NOT initialized: VITE_RECAPTCHA_ENTERPRISE_SITE_KEY not set");
}

export const auth = getAuth(app);

// Use memory-only cache to prevent IndexedDB assertion failures.
// P4 FIX: Removed IndexedDB deletion ("Nuclear Option") and experimentalForceLongPolling.
// Memory cache is sufficient — data freshness is guaranteed via real-time listeners.
let firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: memoryLocalCache(),
  });
} catch (e) {
  // If already initialized (HMR), use existing instance
  firestore = getFirestore(app);
}

export const db = firestore;
export const storage = getStorage(app);
export const functions = getFunctions(app);

