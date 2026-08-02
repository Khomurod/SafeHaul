/**
 * Apply cors.json to the Firebase default Storage bucket for this repo.
 * Guest uploads use signed URLs + PUT + x-goog-meta-firebasestoragedownloadtokens;
 * that header MUST appear in the bucket CORS responseHeader or preflight fails.
 *
 * Requires: Google Cloud SDK (`gcloud`) with `gsutil`, authenticated for the project.
 * Usage: node scripts/set-storage-cors.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const firebaserc = JSON.parse(readFileSync(join(root, '.firebaserc'), 'utf8'));
const projectId = firebaserc?.projects?.default;
if (!projectId) {
  console.error('Could not read projects.default from .firebaserc');
  process.exit(1);
}

const bucket = `${projectId}.firebasestorage.app`;
const corsPath = join(root, 'cors.json');

console.log(`Applying CORS from cors.json to gs://${bucket} ...`);

const r = spawnSync('gsutil', ['cors', 'set', corsPath, `gs://${bucket}`], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (r.error) {
  console.error(r.error.message);
  console.error('Install Google Cloud SDK and ensure gsutil is on PATH.');
  process.exit(1);
}

process.exit(r.status ?? 1);
