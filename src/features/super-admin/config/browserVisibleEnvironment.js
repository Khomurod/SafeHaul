/**
 * The browser half of the Environment & Integrations inventory.
 *
 * ## Why this exists at all
 *
 * `VITE_*` variables are inlined into the bundle by Vite at build time. The
 * Cloud Functions runtime has no access to them, so the server genuinely cannot
 * report their value *or* whether they are set. Asking the backend would produce
 * a confident, wrong answer. Reading them here produces the real deployed value,
 * because this module is running inside the very bundle that carries it.
 *
 * ## Why every key is written out by hand
 *
 * Vite replaces each static `import.meta.env` property reference **textually**
 * at build time. A dynamic lookup by computed key is not a reliable substitute
 * in a production build, and a loop over key names would compile to nothing.
 * Static references are the only form guaranteed to resolve, so every key is
 * listed explicitly below. Adding a browser variable to the app without adding
 * it here is caught by `browserVisibleEnvironment.test.js`.
 *
 * ## This adds no exposure
 *
 * Every value below is already inlined into the shipped JavaScript by the build.
 * Referencing it here does not publish anything that was not already public;
 * `VITE_`-prefixed variables are browser variables by definition, which is
 * exactly why the app's own `.env.example` forbids putting private keys behind
 * that prefix.
 */

/**
 * Build-time values, resolved statically. Never rendered until a Super Admin
 * explicitly reveals the row it belongs to.
 */
const BROWSER_VISIBLE_VALUES = Object.freeze({
    VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
    VITE_FACEBOOK_APP_ID: import.meta.env.VITE_FACEBOOK_APP_ID,
    VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
    VITE_SENTRY_TRACES_SAMPLE_RATE: import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
    VITE_SOCRATA_APP_TOKEN: import.meta.env.VITE_SOCRATA_APP_TOKEN,
    VITE_DRIVER_APP_URL: import.meta.env.VITE_DRIVER_APP_URL,
    VITE_USE_DASHBOARD_SUMMARY: import.meta.env.VITE_USE_DASHBOARD_SUMMARY,
    VITE_RELEASE_SHA: import.meta.env.VITE_RELEASE_SHA,
    VITE_E2E_TEST_MODE: import.meta.env.VITE_E2E_TEST_MODE,
    VITE_USE_REAL_FIREBASE_IN_TESTS: import.meta.env.VITE_USE_REAL_FIREBASE_IN_TESTS,
    VITE_SUPER_ADMIN_EMAIL: import.meta.env.VITE_SUPER_ADMIN_EMAIL,
});

/** Keys this module can resolve. Used by the inventory-completeness test. */
export const BROWSER_VISIBLE_KEYS = Object.freeze(Object.keys(BROWSER_VISIBLE_VALUES));

/**
 * Presence only — never the value.
 *
 * This is what refines a build-time row's status from `unknown` to
 * `configured` / `missing`. A boolean is not a secret and can safely travel
 * through render, unlike the value it describes.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isBrowserValueConfigured(key) {
    const value = BROWSER_VISIBLE_VALUES[key];
    return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;
}

/**
 * Resolves the deployed value of one build-time variable.
 *
 * Called only from the reveal path, after the callable has authorised the
 * operator and recorded the audit event.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function readBrowserVisibleValue(key) {
    if (!Object.prototype.hasOwnProperty.call(BROWSER_VISIBLE_VALUES, key)) return null;
    const value = BROWSER_VISIBLE_VALUES[key];
    if (value === undefined || value === null || value === '') return null;
    return String(value);
}
