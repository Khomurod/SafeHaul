/**
 * Proves E2E runs can never be pointed at a real Firebase project.
 *
 * CI exposes the real `VITE_FIREBASE_*` secrets as workflow-level env vars, which
 * Vite inlines into whatever it builds or serves — including the Playwright dev
 * server. Before this guard, the E2E browser therefore talked to the production
 * Firestore project while `DataContext` supplied a mock (non-Firebase) user, so
 * every listen failed `PERMISSION_DENIED`. Locally there is no `.env`, the
 * placeholder branch applied, and the same specs passed — the divergence that
 * broke `frontend-quality` after #123.
 *
 * These tests pin both directions: E2E mode ignores real credentials entirely,
 * and normal (non-E2E) operation still uses them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initializeApp = vi.fn(() => ({ __app: true }));

vi.mock('firebase/app', () => ({
  initializeApp: (...args) => initializeApp(...args),
  getApps: () => [],
  getApp: () => ({ __app: true }),
}));
vi.mock('firebase/auth', () => ({ getAuth: vi.fn(() => ({})) }));
const connectFirestoreEmulator = vi.fn();
vi.mock('firebase/firestore', () => ({
  connectFirestoreEmulator: (...args) => connectFirestoreEmulator(...args),
  initializeFirestore: vi.fn(() => ({ __firestore: true })),
  memoryLocalCache: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({ __firestore: true })),
}));
vi.mock('firebase/storage', () => ({ getStorage: vi.fn(() => ({})) }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(() => ({})) }));

// Deliberately low-entropy, obviously-not-a-key strings. The assertions only
// need these values to round-trip, and a realistic-looking `AIza...` literal
// here would be a standing false positive for the secret scanner.
const REAL_CONFIG = {
  VITE_FIREBASE_API_KEY: 'not-a-real-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'safehaul-real.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'safehaul-real',
  VITE_FIREBASE_STORAGE_BUCKET: 'safehaul-real.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '999999999',
  VITE_FIREBASE_APP_ID: '1:999999999:web:realrealrealreal',
};

function stubRealConfig() {
  Object.entries(REAL_CONFIG).forEach(([key, value]) => vi.stubEnv(key, value));
}

async function loadConfig() {
  vi.resetModules();
  initializeApp.mockClear();
  connectFirestoreEmulator.mockClear();
  await import('./config.js');
  return initializeApp.mock.calls[0][0];
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('firebase config — E2E isolation', () => {
  it('ignores real injected credentials when E2E test mode is on', async () => {
    stubRealConfig();
    vi.stubEnv('VITE_E2E_TEST_MODE', '1');

    const config = await loadConfig();

    expect(config.projectId).toBe('safehaul-e2e');
    // The important assertion: not one real value leaks through. A per-key
    // `real || placeholder` fallback would silently keep every one of them.
    Object.values(REAL_CONFIG).forEach((realValue) => {
      expect(Object.values(config)).not.toContain(realValue);
    });
  });

  it('points Firestore at a closed local port so it is unreachable by construction', async () => {
    stubRealConfig();
    vi.stubEnv('VITE_E2E_TEST_MODE', '1');

    await loadConfig();

    // Placeholder credentials alone are not enough: on a runner with real
    // internet the WebChannel reaches Google and retries the rejected request
    // forever, so a listener never settles and any surface waiting on it hangs.
    // Port 9 (discard) is never listening, so the connection is refused
    // immediately and the SDK goes offline identically in every environment.
    expect(connectFirestoreEmulator).toHaveBeenCalledWith(
      expect.anything(),
      '127.0.0.1',
      9,
    );
  });

  it('never redirects Firestore when E2E test mode is off', async () => {
    stubRealConfig();
    vi.stubEnv('VITE_E2E_TEST_MODE', '');

    await loadConfig();

    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
  });

  it('uses the real credentials when E2E test mode is off', async () => {
    stubRealConfig();
    vi.stubEnv('VITE_E2E_TEST_MODE', '');

    const config = await loadConfig();

    expect(config.projectId).toBe('safehaul-real');
    expect(config.apiKey).toBe(REAL_CONFIG.VITE_FIREBASE_API_KEY);
  });

  it('still falls back to the placeholder project when env vars are simply absent', async () => {
    Object.keys(REAL_CONFIG).forEach((key) => vi.stubEnv(key, ''));
    vi.stubEnv('VITE_E2E_TEST_MODE', '');

    const config = await loadConfig();

    expect(config.projectId).toBe('safehaul-e2e');
  });
});
