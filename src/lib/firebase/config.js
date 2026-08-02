import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  getFirestore
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

const rawFirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const requiredFirebaseKeys = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];

/** Drops unset keys so a partial real config can layer over the placeholder. */
function pickDefined(config) {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => Boolean(value)));
}

const missingFirebaseKeys = requiredFirebaseKeys.filter((key) => !rawFirebaseConfig[key]);
const isE2ETestMode = import.meta.env.VITE_E2E_TEST_MODE === '1';

// E2E runs must be hermetic. CI injects the real `VITE_FIREBASE_*` secrets at the
// workflow level, so without this the Playwright dev server pointed a browser at
// the **real** Firestore project while `DataContext` supplied a mock (non-Firebase)
// user — every listener then failed `PERMISSION_DENIED`, which is neither the local
// behaviour nor anything a spec can assert against. Locally there is no `.env`, so
// the placeholder branch below applied and the same specs passed; that divergence
// is what broke `frontend-quality` after #123. Forcing the placeholder project
// whenever E2E mode is on makes CI and local identical and guarantees the suite can
// never read or write production data. Deliberately gated on `!PROD` as well so a
// real production build can never be talked into placeholder credentials.
const forcePlaceholderForE2E = isE2ETestMode && !import.meta.env.PROD;
const canUsePlaceholderConfig =
  (missingFirebaseKeys.length > 0 || forcePlaceholderForE2E) && !import.meta.env.PROD;

if (missingFirebaseKeys.length > 0 && import.meta.env.PROD) {
  throw new Error(
    `[firebase] Missing required Firebase env vars in production: ${missingFirebaseKeys.join(', ')}`,
  );
}

const PLACEHOLDER_FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyE2EPlaceholderKey1234567890123',
  authDomain: 'safehaul-e2e.firebaseapp.com',
  projectId: 'safehaul-e2e',
  storageBucket: 'safehaul-e2e.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:1234567890abcdef123456',
});

if (canUsePlaceholderConfig) {
  const modeLabel = isE2ETestMode ? 'E2E test mode' : 'non-production mode';
  const reason = forcePlaceholderForE2E
    ? 'E2E mode forces the placeholder project'
    : `Missing env vars (${missingFirebaseKeys.join(', ')})`;
  console.warn(`[firebase] ${reason}. Using placeholder config in ${modeLabel}.`);
}

const firebaseConfig = forcePlaceholderForE2E
  ? // Whole-object replacement, not per-key `||` fallbacks: in CI every real key is
    // present, so a per-key fallback would silently keep using the real project and
    // defeat the isolation this branch exists to provide.
    { ...PLACEHOLDER_FIREBASE_CONFIG }
  : canUsePlaceholderConfig
    ? { ...PLACEHOLDER_FIREBASE_CONFIG, ...pickDefined(rawFirebaseConfig) }
    : rawFirebaseConfig;

// Initialize Firebase with HMR safety
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);

// Use memory-only cache to prevent IndexedDB assertion failures.
let firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: memoryLocalCache(),
  });
} catch {
  // If already initialized (HMR), use existing instance
  firestore = getFirestore(app);
}

// Point E2E Firestore at a closed local port so it is unreachable *by
// construction*, in every environment.
//
// Placeholder credentials alone are not enough. On a CI runner with real
// internet, `firestore.googleapis.com` is reachable even for a project that does
// not exist, so the WebChannel retries the rejected request indefinitely with
// backoff: neither the snapshot callback nor the error callback ever fires, and
// any surface that waits for its listener to settle hangs forever. On a sandbox
// with blocked egress the connection fails instantly, the SDK goes offline and
// raises a cached empty snapshot, and the same surface settles immediately.
// That difference is exactly what made `company-settings-sms-numbers` pass
// locally and time out in CI.
//
// Port 9 is the reserved discard port and is never listening, so the connection
// is refused immediately and the SDK drops into offline mode the same way in
// both environments. This makes the E2E specs' stated premise — "Firestore is
// deliberately unreachable under VITE_E2E_TEST_MODE=1" — actually true, rather
// than an accident of the sandbox's network policy.
if (forcePlaceholderForE2E) {
  connectFirestoreEmulator(firestore, '127.0.0.1', 9);
}

export const db = firestore;
export const storage = getStorage(app);
export const functions = getFunctions(app);
