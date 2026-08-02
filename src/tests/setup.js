import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Vitest always wires Firebase via `@lib/firebase` for components like CampaignDetails.
 *
 * GitHub Actions often injects `VITE_FIREBASE_*` from secrets for `npm run build`. If those
 * secrets are missing, wrong, or still set to `.example` placeholders, Firebase Auth throws
 * `auth/invalid-api-key` during module load. Unit tests should not depend on real keys.
 *
 * Set `VITE_USE_REAL_FIREBASE_IN_TESTS=1` (with valid `.env`) only if you intentionally run
 * integration-style tests against a real project.
 */
const VITE_FIREBASE_DEFAULTS = {
    VITE_FIREBASE_API_KEY: 'AIzaSyBvOkBwVXyvBkZbWtGxQxXmNJFmQzDdDdDd',
    VITE_FIREBASE_AUTH_DOMAIN: 'vitest-placeholder.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'vitest-placeholder',
    VITE_FIREBASE_STORAGE_BUCKET: 'vitest-placeholder.appspot.com',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
    VITE_FIREBASE_APP_ID: '1:123456789012:web:vitestPlaceholder01',
};

const useRealFirebase =
    import.meta.env.VITE_USE_REAL_FIREBASE_IN_TESTS === 'true' ||
    import.meta.env.VITE_USE_REAL_FIREBASE_IN_TESTS === '1';

if (import.meta.env.VITEST && !useRealFirebase) {
    for (const [key, fallback] of Object.entries(VITE_FIREBASE_DEFAULTS)) {
        vi.stubEnv(key, fallback);
    }
}

// Cleanup after each test
afterEach(() => {
    cleanup();
});

// Mock window.matchMedia
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => { },
            removeListener: () => { },
            addEventListener: () => { },
            removeEventListener: () => { },
            dispatchEvent: () => { },
        }),
    });
}
