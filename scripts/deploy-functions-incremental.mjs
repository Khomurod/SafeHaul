#!/usr/bin/env node
/**
 * Deploy only Cloud Functions affected by git changes (strict mode).
 *
 * Rules:
 * - Compares DEPLOY_GIT_BASE..DEPLOY_GIT_HEAD (or GITHUB_PUSH_BEFORE + GITHUB_SHA) under functions/.
 * - Parses functions/index.js to map each export name → primary module file (direct require from index).
 * - A changed file redeploys every function that loads it (`planChangedFiles`): its own module's
 *   exports, those of the directory module it sits in (require('./bulkActions') → bulkActions/index.js),
 *   and those of every entrypoint whose transitive `require()` closure reaches it, JSON included.
 *   Example: editing `functions/shared/clientIp.js` (required only by `functions/publicSigning.js`)
 *   deploys only the `publicSigning` exports; editing `integrations/encryption.js` deploys the
 *   integrations exports and every function outside `integrations/` that loads it (the bulk sender,
 *   the signer SMS, the email senders).
 *   A file the code reads from disk (an image, a JSON file it does not require) counts for the code
 *   that names it in a string. A file also counts for the code whose require() found it at the base
 *   commit: a deleted or renamed file is in no closure of the tree being deployed.
 * - functions/index.js is compared with the base commit as a syntax tree (deploy-functions-index.mjs):
 *   only exports whose own statement or backing module changed are redeployed (comment and formatting
 *   edits deploy nothing). A change to the code around the export statements (the FUNCTION_TARGET loader
 *   every function starts on) redeploys every export.
 * - STRICT TARGETED policy: only files that ship with the functions count. Tests, dotfiles, docs and
 *   functions/package.json and its lockfile never trigger a deploy.
 * - If a changed runtime file does not appear in ANY entrypoint's closure, we log and skip it
 *   (never auto-full-deploy). Use DEPLOY_FUNCTIONS_FORCE_FULL=1 for manual full deploy.
 * - Otherwise: single `firebase deploy --only functions:a,functions:b,...`
 *
 * Env:
 *   FIREBASE_PROJECT_ID (required for real deploys; not needed for dry-run)
 *   DEPLOY_GIT_BASE / DEPLOY_GIT_HEAD — optional explicit SHAs
 *   GITHUB_PUSH_BEFORE / GITHUB_SHA — set by CI on push
 *   DEPLOY_FUNCTIONS_FORCE_FULL=1 — explicit full deploy (sequential script)
 *   DEPLOY_FUNCTIONS_DRY_RUN=1 — print the deploy plan and exit (no firebase invocation)
 *   DEPLOY_FUNCTIONS_ALWAYS_INCLUDE=parseCdlWithGroq,otherFn — always merge these
 *     exports into the deploy plan. If the git diff has no changed runtime files
 *     under functions/ (e.g. only workflow or docs changed) but this env is set, we still deploy these
 *     functions so CI-written secrets (functions/.env) reach runtime.
 *   --dry-run CLI flag — same as DEPLOY_FUNCTIONS_DRY_RUN=1
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { spawnSync } from 'child_process';
import {
    root,
    repoRoot,
    parseAlwaysInclude,
    buildExportToFile,
    buildFileToEntrypoints,
    planChangedFiles,
    diffExportsFromIndexChange,
    filesAt,
    getChangedFunctionFiles,
    filterProductionFunctionPaths,
    resolveGitRange,
} from './deploy-functions-resolve.mjs';

const dryRun =
  process.env.DEPLOY_FUNCTIONS_DRY_RUN === '1' || process.argv.includes('--dry-run');
const projectId = process.env.FIREBASE_PROJECT_ID;

function main() {
  if (!projectId && !dryRun) {
    console.error('FIREBASE_PROJECT_ID is required (or set DEPLOY_FUNCTIONS_DRY_RUN=1).');
    process.exit(1);
  }
  if (process.env.DEPLOY_FUNCTIONS_FORCE_FULL === '1') {
    console.log('[incremental] DEPLOY_FUNCTIONS_FORCE_FULL=1 → deploy all (sequential)');
    runSequentialAll();
    return;
  }

  const { exportToFile, parseOk } = buildExportToFile();
  if (!parseOk) {
    console.error('[incremental] Could not map every export in functions/index.js to a module.');
    console.error('[incremental] Strict mode refuses automatic full deploy. Fix index.js mapping or set DEPLOY_FUNCTIONS_FORCE_FULL=1.');
    process.exit(1);
  }

  const knownTopLevelFiles = new Set(exportToFile.values());

  // Transitive require() graph. Built once per run; cheap thanks to the source cache.
  const fileToEntries = buildFileToEntrypoints(knownTopLevelFiles);
  console.log(`[incremental] Built dependency graph: ${fileToEntries.size} files across ${knownTopLevelFiles.size} entrypoint module(s).`);

  const { base, head } = resolveGitRange();
  if (!base || !head) {
    console.error('[incremental] Could not resolve git range.');
    console.error('[incremental] Strict mode refuses automatic full deploy. Set DEPLOY_GIT_BASE/DEPLOY_GIT_HEAD or DEPLOY_FUNCTIONS_FORCE_FULL=1.');
    process.exit(1);
  }

  console.log(`[incremental] Comparing ${base.slice(0, 7)}..${head.slice(0, 7)}`);

  const changedFiles = getChangedFunctionFiles(base, head);
  if (changedFiles === null) {
    console.error('[incremental] git diff failed.');
    console.error('[incremental] Strict mode refuses automatic full deploy. Set DEPLOY_FUNCTIONS_FORCE_FULL=1 if needed.');
    process.exit(1);
  }

  const productionChanges = filterProductionFunctionPaths(changedFiles);

  const alwaysInclude = parseAlwaysInclude();
  const unknownAlwaysInclude = alwaysInclude.filter((name) => !exportToFile.has(name));
  if (unknownAlwaysInclude.length > 0) {
    console.error(
      `[incremental] Unknown function export(s) in DEPLOY_FUNCTIONS_ALWAYS_INCLUDE: ${unknownAlwaysInclude.join(', ')}`
    );
    process.exit(1);
  }

  if (productionChanges.length === 0) {
    if (alwaysInclude.length === 0) {
      console.log('[incremental] No runtime changes under functions/** — skipping deploy.');
      return;
    }
    console.log(
      '[incremental] No runtime changes under functions/**; deploying DEPLOY_FUNCTIONS_ALWAYS_INCLUDE only (pins env/config to listed exports).'
    );
    const finalNames = [...alwaysInclude].sort((a, b) => a.localeCompare(b));
    console.log(`[incremental] Deploying ${finalNames.length} function(s): ${finalNames.join(', ')}`);
    if (dryRun) {
      console.log('[incremental] DRY RUN — skipping firebase invocation.');
      return;
    }
    const only = finalNames.map((n) => `functions:${n}`).join(',');
    const r = spawnSync(
      'npx',
      ['firebase', 'deploy', '--only', only, '--project', projectId, '--non-interactive'],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        env: process.env,
        shell: process.platform === 'win32',
      }
    );
    if (r.status !== 0) {
      process.exit(r.status ?? 1);
    }
    return;
  }

  console.log('[incremental] Changed files:', changedFiles.join(', '));

  const indexChanged = productionChanges.includes('functions/index.js');

  const toDeploy = new Set();

  if (indexChanged) {
    const fromIndex = diffExportsFromIndexChange(base);
    if (fromIndex === null) {
      console.error('[incremental] Cannot safely diff functions/index.js export wiring.');
      console.error('[incremental] Strict mode refuses automatic full deploy. Fix index.js parseability or set DEPLOY_FUNCTIONS_FORCE_FULL=1.');
      process.exit(1);
    }
    if (fromIndex.loaderChanged) {
      exportToFile.forEach((_, name) => toDeploy.add(name));
      console.log(`[incremental] index.js code around the export lines changed; every function starts on it → all ${exportToFile.size} function(s)`);
    } else if (fromIndex.changed.size > 0) {
      fromIndex.changed.forEach((e) => toDeploy.add(e));
      console.log(`[incremental] index.js export mapping changed → ${fromIndex.changed.size} function(s): ${[...fromIndex.changed].sort().join(', ')}`);
    } else {
      console.log('[incremental] index.js changed (format/comments only or identical wiring) → no exports flagged from manifest diff');
    }
  }

  const baseFiles = filesAt(base);
  if (baseFiles === null) {
    console.error(`[incremental] Cannot list functions/ at ${base.slice(0, 7)}.`);
    console.error('[incremental] Strict mode refuses automatic full deploy. Set DEPLOY_FUNCTIONS_FORCE_FULL=1 if needed.');
    process.exit(1);
  }
  const { exports: fromFiles, skippedOrphans, notes } = planChangedFiles(productionChanges, {
    exportToFile,
    fileToEntries,
    existedAtBase: (file) => baseFiles.has(file),
  });
  fromFiles.forEach((e) => toDeploy.add(e));
  notes.forEach((note) => console.log(`[incremental] ${note}`));
  skippedOrphans.forEach((file) => console.warn(`[incremental] Changed runtime file not reachable from any entrypoint (skipping): ${file}`));

  for (const name of alwaysInclude) {
    toDeploy.add(name);
  }
  const finalNames = [...toDeploy].sort((a, b) => a.localeCompare(b));
  if (finalNames.length === 0) {
    if (skippedOrphans.length > 0) {
      console.warn(`[incremental] Skipped ${skippedOrphans.length} orphan runtime file(s).`);
    }
    console.log('[incremental] No matching exports — skipping.');
    return;
  }

  if (alwaysInclude.length > 0) {
    console.log(`[incremental] Force-including ${alwaysInclude.length} function(s): ${alwaysInclude.join(', ')}`);
  }
  console.log(`[incremental] Deploying ${finalNames.length} function(s): ${finalNames.join(', ')}`);

  if (dryRun) {
    console.log('[incremental] DRY RUN — skipping firebase invocation.');
    return;
  }

  const only = finalNames.map((n) => `functions:${n}`).join(',');
  const r = spawnSync(
    'npx',
    ['firebase', 'deploy', '--only', only, '--project', projectId, '--non-interactive'],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    }
  );

  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

function runSequentialAll() {
  if (dryRun) {
    console.log('[incremental] DRY RUN — would deploy ALL functions sequentially.');
    process.exit(0);
  }
  const seq = join(root, 'deploy-functions-sequential.mjs');
  if (!existsSync(seq)) {
    console.error('Missing scripts/deploy-functions-sequential.mjs');
    process.exit(1);
  }
  const r = spawnSync(process.execPath, [seq], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(r.status ?? 1);
}

// CLI guard: only run main() when this file is executed directly, not when imported by tests.
const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectInvocation) {
  main();
}


// Named exports for tests. Production behavior is unaffected. They live in
// `deploy-functions-resolve.mjs`; re-exported here so the test's import path
// is unchanged.
export {
    modulePathToFile,
    buildExportToFileFromSource,
    resolveRelativeRequire,
    collectClosure,
    buildFileToEntrypoints,
    isRuntimeFunctionSource,
    filterProductionFunctionPaths,
    planChangedFiles,
    diffIndexSources,
    filesAt,
    getChangedFunctionFiles,
} from './deploy-functions-resolve.mjs';
