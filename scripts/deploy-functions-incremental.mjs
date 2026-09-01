#!/usr/bin/env node
/**
 * Deploy only Cloud Functions affected by git changes (strict mode).
 *
 * Rules:
 * - Compares DEPLOY_GIT_BASE..DEPLOY_GIT_HEAD (or GITHUB_PUSH_BEFORE + GITHUB_SHA) under functions/.
 * - Parses functions/index.js to map each export name → primary module file (direct require from index).
 * - functions/index.js: diffs export→module mappings vs base commit; only exports whose wiring or backing
 *   file path changed are redeployed (whitespace-only edits deploy nothing).
 * - STRICT TARGETED policy: only deploy changed runtime JS under functions/**. Non-runtime files
 *   (examples, docs, tests, .env.example, etc.) never trigger full deploy.
 * - Ignores functions/test/** and non-JS files for deployment targeting.
 * - Directory entrypoints (require('./bulkActions') → bulkActions/index.js) and nested files map to deploy unit.
 * - Transitive `require()` graph: any other changed file is attributed to the union of entrypoints whose
 *   closure references it. Example: editing `functions/schemaConfig.js` (required only by
 *   `functions/systemIntegrity.js`) deploys only the `systemIntegrity` exports, not the whole codebase.
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
 *     exports into the deploy plan. If the git diff has no changed runtime .js files
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
    resolveNestedUnderDirectoryModules,
    buildFileToEntrypoints,
    diffExportsFromIndexChange,
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

  const fileToExports = new Map();
  for (const [exp, file] of exportToFile) {
    if (!fileToExports.has(file)) fileToExports.set(file, []);
    fileToExports.get(file).push(exp);
  }

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
      console.log('[incremental] No runtime JS changes under functions/** — skipping deploy.');
      return;
    }
    console.log(
      '[incremental] No runtime JS changes under functions/**; deploying DEPLOY_FUNCTIONS_ALWAYS_INCLUDE only (pins env/config to listed exports).'
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

  const nonIndexProductionChanges = productionChanges.filter((c) => c.replace(/\\/g, '/') !== 'functions/index.js');

  const indexChanged = productionChanges.some((c) => c.replace(/\\/g, '/') === 'functions/index.js');

  const toDeploy = new Set();

  if (indexChanged) {
    const fromIndex = diffExportsFromIndexChange(base);
    if (fromIndex === null) {
      console.error('[incremental] Cannot safely diff functions/index.js export wiring.');
      console.error('[incremental] Strict mode refuses automatic full deploy. Fix index.js parseability or set DEPLOY_FUNCTIONS_FORCE_FULL=1.');
      process.exit(1);
    }
    fromIndex.forEach((e) => toDeploy.add(e));
    if (fromIndex.size > 0) {
      console.log(`[incremental] index.js export mapping changed → ${fromIndex.size} function(s): ${[...fromIndex].sort().join(', ')}`);
    } else {
      console.log('[incremental] index.js changed (format/comments only or identical wiring) → no exports flagged from manifest diff');
    }
  }

  const skippedOrphans = [];
  for (const cf of nonIndexProductionChanges) {
    const n = cf.replace(/\\/g, '/');

    if (knownTopLevelFiles.has(n)) {
      const exps = fileToExports.get(n) || [];
      exps.forEach((e) => toDeploy.add(e));
      continue;
    }

    const mappedTopLevel = resolveNestedUnderDirectoryModules(n, knownTopLevelFiles);
    if (mappedTopLevel && knownTopLevelFiles.has(mappedTopLevel)) {
      const exps = fileToExports.get(mappedTopLevel) || [];
      exps.forEach((e) => toDeploy.add(e));
      continue;
    }

    // Third branch: transitive `require()` closure.
    // If this file is reachable from one or more entrypoint modules, deploy
    // only the exports owned by those entrypoints — not the whole codebase.
    const owners = fileToEntries.get(n);
    if (owners && owners.size > 0) {
      const ownersList = [...owners].sort();
      const expanded = new Set();
      for (const owner of owners) {
        (fileToExports.get(owner) || []).forEach((e) => expanded.add(e));
      }
      expanded.forEach((e) => toDeploy.add(e));
      console.log(
        `[incremental] Shared dep ${n} → ${owners.size} entrypoint(s) [${ownersList.join(', ')}] → ${expanded.size} export(s)`
      );
      continue;
    }

    console.warn(`[incremental] Changed runtime file not reachable from any entrypoint (skipping): ${n}`);
    skippedOrphans.push(n);
    continue;
  }

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
    resolveNestedUnderDirectoryModules,
    buildExportToFileFromSource,
    resolveRelativeRequire,
    collectClosure,
    buildFileToEntrypoints,
    isRuntimeFunctionSource,
    filterProductionFunctionPaths,
} from './deploy-functions-resolve.mjs';
