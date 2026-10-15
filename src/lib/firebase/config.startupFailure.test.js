/**
 * A production page reads its Firebase config from Hosting before anything
 * else can run. When that read fails, the loader announces it, so the startup
 * guard can show a screen instead of a blank page, and still fails the import.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTUP_FAILED_EVENT } from '../runtime/startupFailure';

const initializeApp = vi.fn(() => ({ __app: true }));

vi.mock('firebase/app', () => ({
  initializeApp: (...args) => initializeApp(...args),
  getApps: () => [],
  getApp: () => ({ __app: true }),
}));
vi.mock('firebase/auth', () => ({
  initializeAuth: vi.fn(() => ({})),
  indexedDBLocalPersistence: {},
  browserLocalPersistence: {},
  browserSessionPersistence: {},
}));
vi.mock('firebase/firestore', () => ({
  connectFirestoreEmulator: vi.fn(),
  initializeFirestore: vi.fn(() => ({ __firestore: true })),
  memoryLocalCache: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({ __firestore: true })),
}));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(() => ({})) }));

// Low-entropy stand-ins: only their round trip matters.
const RUNTIME_CONFIG = {
  apiKey: 'not-a-real-api-key',
  authDomain: 'safehaul-test.firebaseapp.com',
  projectId: 'safehaul-test',
  storageBucket: 'safehaul-test.appspot.com',
  messagingSenderId: '999999999',
  appId: '1:999999999:web:testtesttest',
};

let announced;
const listen = (event) => announced.push(event.detail.error);

async function importConfig() {
  vi.resetModules();
  return import('./config.js');
}

beforeEach(() => {
  announced = [];
  window.addEventListener(STARTUP_FAILED_EVENT, listen);
  initializeApp.mockClear();
  vi.stubEnv('PROD', true);
});

afterEach(() => {
  window.removeEventListener(STARTUP_FAILED_EVENT, listen);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('firebase config — startup failure', () => {
  it.each([
    ['the request cannot be made', async () => { throw new TypeError('Failed to fetch'); }, /Could not load Firebase Hosting runtime configuration/],
    ['Hosting answers with an error', async () => ({ ok: false, status: 503 }), /returned HTTP 503/],
    ['the answer is not JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } }), /Unexpected token/],
    ['a required key is missing', async () => ({ ok: true, json: async () => ({ ...RUNTIME_CONFIG, appId: '' }) }), /missing required keys: appId/],
  ])('announces the failure and fails the import when %s', async (_label, fetchImpl, message) => {
    vi.stubGlobal('fetch', vi.fn(fetchImpl));

    await expect(importConfig()).rejects.toThrow(message);

    expect(announced).toHaveLength(1);
    expect(announced[0].message).toMatch(message);
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it('announces nothing when the config loads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => RUNTIME_CONFIG })));

    await importConfig();

    expect(announced).toEqual([]);
    expect(initializeApp).toHaveBeenCalledWith(RUNTIME_CONFIG);
  });
});
