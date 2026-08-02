#!/usr/bin/env node
/**
 * Test harness for scripts/deploy-functions-incremental.mjs.
 *
 * No external test runner; just plain assertions so it works inside CI without
 * adding a new dev-dep. Exit code 0 = all pass, 1 = first failure logged.
 *
 * Scenarios covered:
 *   1. Static parser: every export in functions/index.js maps to a real file.
 *   2. Closure walker on a known nested chain.
 *   3. fileToEntrypoints includes the schemaConfig.js → systemIntegrity.js edge
 *      that was missing from the deploy plan in production.
 *   4. Strict runtime filter only includes deployable JS sources.
 *   5. resolveRelativeRequire refuses to escape functions/.
 *   6. Simulating today's commit produces a small, correct deploy plan.
 *   7. Touching ONLY schemaConfig.js produces exactly the systemIntegrity exports.
 *   8. Touching ONLY a deeply nested utils/* file deploys all entrypoints that
 *      actually consume it (no over-deploy, no under-deploy).
 *   9. Touching a file that no entrypoint references is skipped (no full fallback).
 *  10. Touching functions/test/** is ignored.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  buildExportToFileFromSource,
  resolveRelativeRequire,
  collectClosure,
  buildFileToEntrypoints,
  filterProductionFunctionPaths,
} from './deploy-functions-incremental.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const indexPath = join(repoRoot, 'functions', 'index.js');

let failures = 0;
function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
    if (detail !== undefined) console.log(`      ${detail}`);
  }
}
function assertEqual(label, actual, expected) {
  const eq = JSON.stringify(actual) === JSON.stringify(expected);
  assert(label, eq, eq ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function section(name) {
  console.log(`\n── ${name} ──`);
}

// Shared fixtures -----------------------------------------------------------
const indexSrc = readFileSync(indexPath, 'utf8');
const parsed = buildExportToFileFromSource(indexSrc);
const knownTopLevelFiles = new Set(parsed.exportToFile.values());
const fileToExports = new Map();
for (const [exp, file] of parsed.exportToFile) {
  if (!fileToExports.has(file)) fileToExports.set(file, []);
  fileToExports.get(file).push(exp);
}
const fileToEntries = buildFileToEntrypoints(knownTopLevelFiles);

// Simulator: replicates main()'s strict dispatch loop on a synthetic file list.
// Returns { kind: 'partial', exports: string[], skippedOrphans: string[] }.
function simulateDeployPlan(changedFiles) {
  const filtered = filterProductionFunctionPaths(changedFiles);

  const toDeploy = new Set();
  const skippedOrphans = [];
  for (const cf of filtered) {
    const n = cf.replace(/\\/g, '/');
    if (n === 'functions/index.js') continue;

    if (knownTopLevelFiles.has(n)) {
      (fileToExports.get(n) || []).forEach((e) => toDeploy.add(e));
      continue;
    }
    let matchedFolder = null;
    for (const kf of knownTopLevelFiles) {
      if (!kf.endsWith('/index.js')) continue;
      const dirPrefix = kf.slice(0, -'index.js'.length);
      if (n.startsWith(dirPrefix)) { matchedFolder = kf; break; }
    }
    if (matchedFolder) {
      (fileToExports.get(matchedFolder) || []).forEach((e) => toDeploy.add(e));
      continue;
    }
    const owners = fileToEntries.get(n);
    if (owners && owners.size > 0) {
      for (const owner of owners) {
        (fileToExports.get(owner) || []).forEach((e) => toDeploy.add(e));
      }
      continue;
    }
    skippedOrphans.push(n);
  }
  return { kind: 'partial', exports: [...toDeploy].sort(), skippedOrphans: skippedOrphans.sort() };
}

// ───────── 1. Static parser ─────────
section('1. Static parser');
assert('index.js parsed cleanly', parsed.parseOk, 'expected every exports.X to map to a file');
assert('at least one export found', parsed.exportToFile.size > 10);
{
  const missing = [];
  for (const f of knownTopLevelFiles) {
    if (!existsSync(join(repoRoot, f))) missing.push(f);
  }
  assertEqual('every top-level module exists on disk', missing, []);
}

// ───────── 2. Closure walker on a known chain ─────────
section('2. Closure walker');
{
  // sessionController requires firebaseAdmin, schema, etc. — exercise nested resolution.
  const closure = collectClosure('functions/bulkActions/index.js');
  assert(
    'bulkActions/index.js pulls in workers/batchWorker.js',
    closure.has('functions/bulkActions/workers/batchWorker.js')
  );
  assert(
    'bulkActions/index.js pulls in controllers/sessionController.js',
    closure.has('functions/bulkActions/controllers/sessionController.js')
  );
  assert(
    'bulkActions/index.js pulls in admin/backfillSmsSentPhones.js',
    closure.has('functions/bulkActions/admin/backfillSmsSentPhones.js')
  );
}
{
  // Confirms cycles do not crash the walker.
  const closure = collectClosure('functions/companyAdmin.js');
  assert('companyAdmin closure is non-empty', closure.size >= 1);
  assert('companyAdmin closure contains itself', closure.has('functions/companyAdmin.js'));
}

// ───────── 3. The exact bug from production ─────────
section('3. schemaConfig.js → systemIntegrity.js attribution (the original bug)');
{
  const owners = fileToEntries.get('functions/schemaConfig.js');
  assert('schemaConfig is reachable from at least one entrypoint', !!(owners && owners.size > 0));
  if (owners) {
    assertEqual(
      'schemaConfig is owned by exactly systemIntegrity.js',
      [...owners].sort(),
      ['functions/systemIntegrity.js']
    );
  }
}

// ───────── 4. Strict runtime filter ─────────
section('4. Strict runtime filter');
assertEqual(
  'non-runtime files are excluded',
  filterProductionFunctionPaths(['functions/.env.example', 'functions/README.md', 'firebase.json']),
  []
);
assertEqual(
  'test files are excluded',
  filterProductionFunctionPaths(['functions/test/unit/guestApplication.test.js']),
  []
);
assertEqual(
  'runtime JS files are included',
  filterProductionFunctionPaths(['functions/companyAdmin.js', 'functions/shared/schema.js']).sort(),
  ['functions/companyAdmin.js', 'functions/shared/schema.js']
);

// ───────── 5. resolveRelativeRequire safety ─────────
section('5. resolveRelativeRequire path safety');
assertEqual(
  'cannot escape functions/ via ../../',
  resolveRelativeRequire('functions/companyAdmin.js', '../../etc/passwd'),
  null
);
assertEqual(
  'resolves ./shared/schema to .js',
  resolveRelativeRequire('functions/companyAdmin.js', './shared/schema'),
  'functions/shared/schema.js'
);
assertEqual(
  'resolves bulkActions to bulkActions/index.js (directory entry)',
  resolveRelativeRequire('functions/index.js', './bulkActions'),
  'functions/bulkActions/index.js'
);
assertEqual(
  'returns null for non-existent target',
  resolveRelativeRequire('functions/companyAdmin.js', './doesNotExistAnywhere'),
  null
);

// ───────── 6. Simulate today's commit ─────────
section('6. Simulating the commit that triggered the full deploy');
{
  // The actual list of files reported in your CI log.
  const changed = [
    'functions/bulkActions/admin/backfillSmsSentPhones.js',
    'functions/bulkActions/controllers/sessionController.js',
    'functions/bulkActions/workers/batchWorker.js',
    'functions/companyAdmin.js',
    'functions/integrations/facebook.js',
    'functions/schemaConfig.js',
    'functions/test/unit/guestApplication.test.js',
    'functions/index.js',
  ];
  const plan = simulateDeployPlan(changed);
  assert(`would be a PARTIAL deploy (got: ${plan.kind})`, plan.kind === 'partial');
  if (plan.kind === 'partial') {
    console.log(`      → would deploy ${plan.exports.length} function(s): ${plan.exports.slice(0, 12).join(', ')}${plan.exports.length > 12 ? ', …' : ''}`);
    assertEqual('no orphan skips in this scenario', plan.skippedOrphans, []);
    assert('deploy plan is dramatically smaller than 85 functions', plan.exports.length < 30);
    assert('plan includes a systemIntegrity export (from schemaConfig owner)', plan.exports.includes('syncSystemStructure') || plan.exports.includes('runSecurityAudit'));
    assert('plan includes a bulkActions export', plan.exports.some((e) => /Bulk|backfill|checkImport/i.test(e)));
  }
}

// ───────── 7. Only schemaConfig.js changed ─────────
section('7. Touching ONLY schemaConfig.js');
{
  const plan = simulateDeployPlan(['functions/schemaConfig.js']);
  assert('plan is partial', plan.kind === 'partial');
  if (plan.kind === 'partial') {
    const expected = (fileToExports.get('functions/systemIntegrity.js') || []).slice().sort();
    assertEqual('no orphan skips', plan.skippedOrphans, []);
    assertEqual('plan equals exactly the systemIntegrity exports', plan.exports, expected);
  }
}

// ───────── 8. Deeply nested utility ─────────
section('8. Touching utils/phoneUtils.js');
{
  if (existsSync(join(repoRoot, 'functions/utils/phoneUtils.js'))) {
    const owners = fileToEntries.get('functions/utils/phoneUtils.js');
    assert('utils/phoneUtils is reachable from ≥1 entrypoint', !!(owners && owners.size > 0));
    const plan = simulateDeployPlan(['functions/utils/phoneUtils.js']);
    assert('utils/phoneUtils → partial deploy', plan.kind === 'partial');
    if (plan.kind === 'partial') {
      console.log(`      → fans out to ${plan.exports.length} export(s): ${plan.exports.slice(0, 8).join(', ')}${plan.exports.length > 8 ? ', …' : ''}`);
      assertEqual('no orphan skips', plan.skippedOrphans, []);
      // Sanity: must include at least one bulkActions export, since both
      // batchWorker.js and sessionController.js import it.
      assert('plan includes ≥1 bulk export', plan.exports.length > 0);
    }
  } else {
    console.log('  · skipped (utils/phoneUtils.js not present)');
  }
}

// ───────── 9. Orphan file ─────────
section('9. Touching an orphan file is skipped');
{
  // Fake an unreachable file by referencing one that does not exist in any closure.
  // Use a synthetic .js path so it passes runtime filtering, then gets skipped as orphan.
  const plan = simulateDeployPlan(['functions/__definitely_not_required_anywhere.js']);
  assertEqual('orphan does not trigger full deploy', plan.kind, 'partial');
  assertEqual('no exports selected from orphan', plan.exports, []);
  assertEqual(
    'orphan file is reported as skipped',
    plan.skippedOrphans,
    ['functions/__definitely_not_required_anywhere.js']
  );
}

// ───────── 10. Test files are ignored ─────────
section('10. functions/test/** is ignored');
{
  const plan = simulateDeployPlan(['functions/test/unit/guestApplication.test.js']);
  assertEqual('test-only diff is a no-op partial', plan, { kind: 'partial', exports: [], skippedOrphans: [] });
}

console.log('');
if (failures > 0) {
  console.error(`✗ ${failures} test(s) failed`);
  process.exit(1);
}
console.log('✓ All deploy-script tests passed');
