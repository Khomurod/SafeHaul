/**
 * Shared harness for the firestore.rules security suites, extracted verbatim
 * from the original single-file `firestore.rules.security.test.js`. The rules
 * text, the emulator gate and the environment boot live here; each suite
 * keeps its own `testEnv` lifecycle and every test body verbatim.
 *
 * ONE deliberate change from the single-file original: each suite boots its
 * environment under `safehaul-rules-test-<suite>` instead of one shared
 * projectId. Vitest runs test FILES in parallel workers against the one
 * emulator, and `clearFirestore()` wipes a whole project — with a shared
 * projectId one suite's `beforeEach` would erase another suite's documents
 * mid-test. Per-suite projects isolate them; the rules themselves never
 * reference the projectId, so nothing under test changes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const projectId = 'safehaul-rules-test';
export const rules = readFileSync(resolve(process.cwd(), 'src/firestore.rules'), 'utf8');
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const hasFirestoreEmulator = firestoreEmulatorHost.includes(':');
export const describeFirestore = hasFirestoreEmulator ? describe : describe.skip;

/** The original `beforeAll` body, verbatim, plus the per-suite project suffix. */
export async function createRulesTestEnv(suiteSuffix) {
  const [host, portStr] = firestoreEmulatorHost.split(':');
  return initializeTestEnvironment({
    projectId: `${projectId}-${suiteSuffix}`,
    firestore: { rules, host, port: Number(portStr) },
  });
}
