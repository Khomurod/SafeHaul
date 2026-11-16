/**
 * True only on a dev server started with `VITE_E2E_TEST_MODE=1`, as the browser
 * suites run it. A production build is refused even with the variable set.
 *
 * The bundler sees this as `false` only after it has split the build into
 * files, so a branch on it still ships what it alone uses from another file (a
 * lazy import, a shared module's export), and a flag made from it and handed to
 * another function or component is never seen as `false` at all. Such a branch
 * also tests `!import.meta.env.PROD` in its own file, which the bundler reads
 * before it splits.
 */
export const isE2ETestMode = !import.meta.env.PROD && import.meta.env.VITE_E2E_TEST_MODE === '1';

export function getE2EQueryParam(name, fallback = '') {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const params = new URLSearchParams(window.location.search);
  const value = params.get(name);
  return value ?? fallback;
}

/**
 * The carrier name shown when capturing marketing screenshots.
 *
 * Deliberately fictional. The screenshots that shipped on the landing page
 * before this existed were taken against a real tenant and contained real
 * driver names and phone numbers — personal data published on a public
 * marketing page. Capturing against a named fictional carrier with fixture
 * drivers removes that class of mistake rather than relying on someone
 * remembering to redact.
 */
export const DEMO_COMPANY_NAME = 'Ridgeline Carriers';

/**
 * True when the session should present itself as the marketing demo tenant.
 *
 * Gated on E2E mode, which is itself never enabled in a production build, and
 * additionally refused when `import.meta.env.PROD` is set. Two independent
 * gates, because a demo dataset appearing in the real product would be worse
 * than the screenshots problem it solves.
 */
export function isMarketingDemo() {
  if (import.meta.env.PROD) return false;
  if (!isE2ETestMode) return false;
  return getE2EQueryParam('demo', '') === 'marketing';
}
