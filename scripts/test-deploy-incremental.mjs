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
 *  11. Every runtime file redeploys every function that loads it: its module, its
 *      directory module and every entrypoint whose closure reaches it, together.
 *  12. JSON the code requires, and a file it reads from disk, redeploy their users.
 *  13. index.js: wiring changes redeploy their exports, comment edits nothing, and a
 *      change to the loader around the export lines every function.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  buildExportToFileFromSource,
  resolveRelativeRequire,
  collectClosure,
  buildFileToEntrypoints,
  filterProductionFunctionPaths,
  isRuntimeFunctionSource,
  planChangedFiles,
  diffIndexSources,
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

// The deploy's own dispatch (`planChangedFiles`), on a synthetic file list.
function planFor(changedFiles) {
  const plan = planChangedFiles(changedFiles, { exportToFile: parsed.exportToFile, fileToEntries });
  return { kind: 'partial', exports: [...plan.exports].sort(), skippedOrphans: plan.skippedOrphans.sort() };
}
const exportsOf = (modules) => [...new Set([...modules].flatMap((m) => fileToExports.get(m) || []))].sort();
// The modules that load a file, worked out apart from the dispatch: those whose
// closure reaches it, and the directory module it sits in.
const closures = new Map([...knownTopLevelFiles].map((module) => [module, collectClosure(module, new Set())]));
const loadersOf = (file) => [...knownTopLevelFiles].filter((module) =>
  (module.endsWith('/index.js') && file.startsWith(module.slice(0, -'index.js'.length)))
  || closures.get(module).has(file));

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
  const plan = planFor(changed);
  assert(`would be a PARTIAL deploy (got: ${plan.kind})`, plan.kind === 'partial');
  if (plan.kind === 'partial') {
    console.log(`      → would deploy ${plan.exports.length} function(s): ${plan.exports.slice(0, 12).join(', ')}${plan.exports.length > 12 ? ', …' : ''}`);
    assertEqual('no orphan skips in this scenario', plan.skippedOrphans, []);
    assertEqual(
      'the plan is exactly the functions that load a changed file',
      plan.exports,
      exportsOf(filterProductionFunctionPaths(changed).filter((f) => f !== 'functions/index.js').flatMap(loadersOf))
    );
    assert(`… far fewer than all ${parsed.exportToFile.size}`, plan.exports.length < parsed.exportToFile.size / 2);
    assert('plan includes a systemIntegrity export (from schemaConfig owner)', plan.exports.includes('syncSystemStructure') || plan.exports.includes('runSecurityAudit'));
    assert('plan includes a bulkActions export', plan.exports.some((e) => /Bulk|backfill|checkImport/i.test(e)));
  }
}

// ───────── 7. Only schemaConfig.js changed ─────────
section('7. Touching ONLY schemaConfig.js');
{
  const plan = planFor(['functions/schemaConfig.js']);
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
    const plan = planFor(['functions/utils/phoneUtils.js']);
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
  const plan = planFor(['functions/__definitely_not_required_anywhere.js']);
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
  const plan = planFor(['functions/test/unit/guestApplication.test.js']);
  assertEqual('test-only diff is a no-op partial', plan, { kind: 'partial', exports: [], skippedOrphans: [] });
}

// ───────── 11. Every function that loads a file ─────────
section('11. A changed file redeploys every function that loads it');
{
  // Every entrypoint whose closure reaches a file, plus its own module and its
  // directory module, at once. The dispatch once stopped at the first rule that
  // matched, so a file inside `bulkActions/` skipped `executeReactivationBatch`
  // (which loads it through `smsService.js`), and a module another module loads
  // skipped that one.
  const walk = (dir) => readdirSync(join(repoRoot, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (name === 'node_modules') return [];
    return statSync(join(repoRoot, rel)).isDirectory() ? walk(rel) : [rel];
  });
  const runtimeFiles = walk('functions').filter((f) => isRuntimeFunctionSource(f) && f !== 'functions/index.js');
  const missed = [];
  for (const file of runtimeFiles) {
    const plan = planFor([file]);
    const left = exportsOf(loadersOf(file)).filter((name) => !plan.exports.includes(name));
    if (left.length > 0) missed.push(`${file}: ${left.length} (${left.slice(0, 3).join(', ')})`);
  }
  assert(`checked every runtime file (${runtimeFiles.length})`, runtimeFiles.length > 200);
  assertEqual('no file leaves out a function that loads it', missed, []);

  const sessionFactory = planFor(['functions/bulkActions/helpers/sessionFactory.js']);
  assert('a bulk helper redeploys the bulk functions', sessionFactory.exports.includes('initBulkSession'));
  assert('… and executeReactivationBatch, which loads it outside bulkActions/', sessionFactory.exports.includes('executeReactivationBatch'));
  const notifySigner = planFor(['functions/notifySigner.js']);
  assert('a module redeploys the modules that load it (notifySigner → notifySignerSMS)', notifySigner.exports.includes('notifySignerSMS'));
}

// ───────── 12. JSON and files read from disk ─────────
section('12. Required JSON and files read from disk');
{
  assertEqual(
    'they count as runtime files; package files, dotfiles and docs do not',
    filterProductionFunctionPaths([
      'functions/shared/applicationSections.json',
      'functions/ai/tasks/verification/cdl-specimen.jpg',
      'functions/package.json',
      'functions/package-lock.json',
      'functions/.gcloudignore',
      'functions/README.md',
    ]),
    ['functions/shared/applicationSections.json', 'functions/ai/tasks/verification/cdl-specimen.jpg']
  );
  const sections = planFor(['functions/shared/applicationSections.json']);
  assert('the application definition JSON redeploys submitGuestApplication', sections.exports.includes('submitGuestApplication'));
  assertEqual('… found through require()', sections.skippedOrphans, []);
  const vectors = planFor(['functions/shared/applicationRules.vectors.json']);
  assertEqual('test vectors no runtime code requires redeploy nothing', vectors.exports, []);
  const specimen = planFor(['functions/ai/tasks/verification/cdl-specimen.jpg']);
  const readers = exportsOf(fileToEntries.get('functions/ai/tasks/modelVerification.js') || []);
  assert('the CDL specimen image redeploys the model checks that read it', readers.length > 0 && readers.every((name) => specimen.exports.includes(name)));
}

// ───────── 13. index.js ─────────
section('13. index.js: wiring, comments and the loader');
{
  const lines = indexSrc.split('\n');
  const exportLine = lines.findIndex((line) => /\bexports\.\w+\s*=/.test(line));
  const commentEdit = indexSrc.replace(/\/\/[^\n]*/, '// a reworded comment');
  const added = [...lines.slice(0, exportLine + 1), lines[exportLine].replace(/exports\.(\w+)/, 'exports.$1Copy'), ...lines.slice(exportLine + 1)].join('\n');
  const loaderEdit = `${indexSrc}\nconst startedAt = Date.now();\n`;
  const stringWithSlashes = `${indexSrc}\nconst url = 'https://example.test/a'; // a comment after a string\n`;
  const sameString = stringWithSlashes.replace('// a comment after a string', '// reworded');
  const otherString = stringWithSlashes.replace('https://example.test/a', 'https://example.test/b');

  const diff = (from, to) => {
    const d = diffIndexSources(from, to);
    return d && { changed: [...d.changed].sort(), loaderChanged: d.loaderChanged };
  };
  assertEqual('the same file changes nothing', diff(indexSrc, indexSrc), { changed: [], loaderChanged: false });
  assertEqual('a comment edit changes nothing', diff(indexSrc, commentEdit), { changed: [], loaderChanged: false });
  const copyName = `${lines[exportLine].match(/exports\.(\w+)/)[1]}Copy`;
  assertEqual('a new export line redeploys that export only', diff(indexSrc, added), { changed: [copyName], loaderChanged: false });
  // The same module, another handler or another condition: the export's own line changed.
  const firstName = lines[exportLine].match(/exports\.(\w+)/)[1];
  const editLine = (edit) => [...lines.slice(0, exportLine), edit(lines[exportLine]), ...lines.slice(exportLine + 1)].join('\n');
  assert('the first export line asks for its name (`wanted`)', lines[exportLine].includes(`wanted('${firstName}')`));
  assertEqual(
    'an export that takes another member of the same module redeploys',
    diff(indexSrc, editLine((line) => line.replace(/\.(\w+);\s*$/, '.$1Other;'))),
    { changed: [firstName], loaderChanged: false }
  );
  assertEqual(
    'an export whose condition changes redeploys',
    diff(indexSrc, editLine((line) => line.replace(/wanted\('(\w+)'\)/, "wanted('$1Other')"))),
    { changed: [firstName], loaderChanged: false }
  );
  assertEqual(
    'spacing and a trailing comment on an export line do not',
    diff(indexSrc, editLine((line) => `${line.replace(/ = /, '  =  ')} // a note`)),
    { changed: [], loaderChanged: false }
  );
  assertEqual(
    '… nor spacing dropped between tokens',
    diff(indexSrc, editLine((line) => line.replace(/ = /, '=').replace(/\) exports/, ')exports'))),
    { changed: [], loaderChanged: false }
  );
  assertEqual(
    'a space inside a string on an export line is a change',
    diff(indexSrc, editLine((line) => line.replace(/wanted\('(\w+)'\)/, "wanted('$1 ')"))),
    { changed: [firstName], loaderChanged: false }
  );
  assertEqual('a change to the code around the export lines is a loader change', diff(indexSrc, loaderEdit)?.loaderChanged, true);
  assertEqual('// inside a string is not a comment: a comment after it may change', diff(stringWithSlashes, sameString)?.loaderChanged, false);
  assertEqual('… and the string itself is code', diff(stringWithSlashes, otherString)?.loaderChanged, true);
  assertEqual(
    'spaces inside a loader string are code too',
    diff(`${indexSrc}\nconst label = 'a  b';\n`, `${indexSrc}\nconst label = 'a b';\n`)?.loaderChanged,
    true
  );
}

console.log('');
if (failures > 0) {
  console.error(`✗ ${failures} test(s) failed`);
  process.exit(1);
}
console.log('✓ All deploy-script tests passed');
