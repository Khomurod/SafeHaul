export const isE2ETestMode = import.meta.env.VITE_E2E_TEST_MODE === '1';

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
