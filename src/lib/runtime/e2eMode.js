export const isE2ETestMode = import.meta.env.VITE_E2E_TEST_MODE === '1';

export function getE2EQueryParam(name, fallback = '') {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const params = new URLSearchParams(window.location.search);
  const value = params.get(name);
  return value ?? fallback;
}
