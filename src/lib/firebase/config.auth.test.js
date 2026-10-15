/**
 * Auth starts without the popup and redirect resolver: SafeHaul signs in with
 * email and password only, and the resolver was 6.6 kB of every page's first
 * download. The persistence list must stay `getAuth`'s own, in its order, or a
 * signed-in user would find their session in a different store after a release.
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initializeAuth: vi.fn(() => ({ __auth: true })),
  indexedDB: { __persistence: 'indexedDB' },
  local: { __persistence: 'local' },
  session: { __persistence: 'session' },
}));

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ __app: true })),
  getApps: () => [],
  getApp: () => ({ __app: true }),
}));
vi.mock('firebase/auth', () => ({
  initializeAuth: mocks.initializeAuth,
  indexedDBLocalPersistence: mocks.indexedDB,
  browserLocalPersistence: mocks.local,
  browserSessionPersistence: mocks.session,
}));
vi.mock('firebase/firestore', () => ({
  connectFirestoreEmulator: vi.fn(),
  initializeFirestore: vi.fn(() => ({ __firestore: true })),
  memoryLocalCache: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({ __firestore: true })),
}));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(() => ({})) }));

describe('firebase config — Auth', () => {
  it("initialises Auth with getAuth's persistence list and no popup resolver", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { auth } = await import('./config.js');

    expect(mocks.initializeAuth).toHaveBeenCalledTimes(1);
    const [app, deps] = mocks.initializeAuth.mock.calls[0];
    expect(app).toEqual({ __app: true });
    expect(deps).toEqual({ persistence: [mocks.indexedDB, mocks.local, mocks.session] });
    expect(deps).not.toHaveProperty('popupRedirectResolver');
    expect(auth).toEqual({ __auth: true });
  });
});
