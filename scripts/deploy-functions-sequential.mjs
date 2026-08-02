#!/usr/bin/env node
/**
 * Deploy Cloud Functions one at a time. Default firebase-tools deploy runs many updates in parallel (~40).
 *
 * Export names are parsed from functions/index.js (must match `exports.name =`).
 *
 * Env:
 *   FIREBASE_PROJECT_ID (required)
 *   DEPLOY_FUNCTIONS_SLEEP_SEC — optional pause between deploys (default 0)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { setTimeout as delay } from 'timers/promises';

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, '..');
const indexPath = join(repoRoot, 'functions', 'index.js');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID is required.');
  process.exit(1);
}

const sleepSec = Number(process.env.DEPLOY_FUNCTIONS_SLEEP_SEC || '0') || 0;

const src = readFileSync(indexPath, 'utf8');
const names = new Set();
for (const m of src.matchAll(/exports\.(\w+)\s*=/g)) {
  names.add(m[1]);
}

const sorted = [...names].sort((a, b) => a.localeCompare(b));
console.log(`Sequential deploy: ${sorted.length} function(s) → project ${projectId}`);

function deployOne(name) {
  const r = spawnSync(
    'npx',
    ['firebase', 'deploy', '--only', `functions:${name}`, '--project', projectId, '--non-interactive'],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    }
  );
  if (r.status !== 0) {
    console.error(`Deploy failed for functions:${name} (exit ${r.status ?? 'signal'})`);
    process.exit(r.status ?? 1);
  }
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
}

async function main() {
  for (let i = 0; i < sorted.length; i++) {
    const name = sorted[i];
    console.log(`\n[${i + 1}/${sorted.length}] firebase deploy --only functions:${name}`);
    deployOne(name);
    if (sleepSec > 0 && i < sorted.length - 1) {
      await delay(sleepSec * 1000);
    }
  }
  console.log('\nAll function deploys finished.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
