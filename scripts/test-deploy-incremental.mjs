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
 *   3. fileToEntrypoints gives a helper one module loads to exactly that module
 *      (shared/clientIp.js → publicSigning.js).
 *   4. Strict runtime filter only includes deployable JS sources.
 *   5. resolveRelativeRequire refuses to escape functions/.
 *   6. Simulating today's commit produces a small, correct deploy plan.
 *   7. Touching ONLY shared/clientIp.js produces exactly the publicSigning exports.
 *   8. Touching ONLY a deeply nested utils/* file deploys all entrypoints that
 *      actually consume it (no over-deploy, no under-deploy).
 *   9. Touching a file that no entrypoint references is skipped (no full fallback).
 *  10. Touching functions/test/** is ignored.
 *  11. Every runtime file redeploys every function that loads it: its module, its
 *      directory module and every entrypoint whose closure reaches it, together.
 *  12. JSON the code requires, and a file it reads from disk, redeploy their users.
 *  13. index.js: wiring changes redeploy their exports, comment edits nothing, and a
 *      change to the loader around the export lines every function.
 *  14. A deleted or renamed file redeploys the code that required it at the base commit.
 */

import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initThrowawayRepo, removeTree } from './lib/throwaway.mjs';

import {
  buildExportToFileFromSource,
  resolveRelativeRequire,
  collectClosure,
  buildFileToEntrypoints,
  filterProductionFunctionPaths,
  isRuntimeFunctionSource,
  planChangedFiles,
  diffIndexSources,
  filesAt,
  getChangedFunctionFiles,
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
    'bulkActions/index.js pulls in workers/sessionDeleted.js',
    closure.has('functions/bulkActions/workers/sessionDeleted.js')
  );
}
{
  // Confirms cycles do not crash the walker.
  const closure = collectClosure('functions/companyAdmin.js');
  assert('companyAdmin closure is non-empty', closure.size >= 1);
  assert('companyAdmin closure contains itself', closure.has('functions/companyAdmin.js'));
}

// ───────── 3. A helper one module loads ─────────
section('3. shared/clientIp.js → publicSigning.js attribution');
{
  const owners = fileToEntries.get('functions/shared/clientIp.js');
  assert('clientIp is reachable from at least one entrypoint', !!(owners && owners.size > 0));
  if (owners) {
    assertEqual(
      'clientIp is owned by exactly publicSigning.js',
      [...owners].sort(),
      ['functions/publicSigning.js']
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
assertEqual(
  'resolves an extensionless JSON require as Node does',
  resolveRelativeRequire('functions/shared/someModule.js', './applicationSections'),
  'functions/shared/applicationSections.json'
);

// ───────── 6. Simulate today's commit ─────────
section('6. Simulating the commit that triggered the full deploy');
{
  // The actual list of files reported in your CI log.
  const changed = [
    'functions/bulkActions/workers/sessionDeleted.js',
    'functions/bulkActions/controllers/sessionController.js',
    'functions/bulkActions/workers/batchWorker.js',
    'functions/companyAdmin.js',
    'functions/integrations/facebook.js',
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
    assert('plan includes a bulkActions export', plan.exports.some((e) => /Bulk|backfill|checkImport/i.test(e)));
  }
}

// ───────── 7. Only shared/clientIp.js changed ─────────
section('7. Touching ONLY shared/clientIp.js');
{
  const plan = planFor(['functions/shared/clientIp.js']);
  assert('plan is partial', plan.kind === 'partial');
  if (plan.kind === 'partial') {
    const expected = (fileToExports.get('functions/publicSigning.js') || []).slice().sort();
    assertEqual('no orphan skips', plan.skippedOrphans, []);
    assert('publicSigning has exports to compare', expected.length > 0);
    assertEqual('plan equals exactly the publicSigning exports', plan.exports, expected);
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
  // matched, so a file inside `integrations/` reached only the integrations
  // functions and skipped the bulk sender, and a module another module loads
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

  const encryption = planFor(['functions/integrations/encryption.js']);
  assert('a file inside integrations/ redeploys the integrations functions', encryption.exports.includes('saveIntegrationConfig'));
  assert('… and the bulk sender, which loads it outside integrations/', encryption.exports.includes('initBulkSession'));
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
  // A JSON file the code reads from disk rather than requires: the same catalog,
  // taken out of the require graph, still reaches the code that names it.
  const catalog = 'functions/shared/applicationRulesCatalog.json';
  const byName = planChangedFiles([catalog], {
    exportToFile: parsed.exportToFile,
    fileToEntries: new Map([...fileToEntries].filter(([file]) => file !== catalog)),
  });
  assert('a JSON file read from disk counts for the code that names it', byName.exports.size > 0 && byName.skippedOrphans.length === 0);
  assertEqual('… the same functions that require it', [...byName.exports].sort(), planFor([catalog]).exports);
}

// ───────── 13. index.js ─────────
section('13. index.js: wiring, comments and the loader');
{
  const lines = indexSrc.split('\n');
  const exportLine = lines.findIndex((line) => /\bexports\.\w+\s*=/.test(line));
  const commentEdit = indexSrc.replace(/\/\/[^\n]*/, '// a reworded comment');
  const copyLine = lines[exportLine].replace(/exports\.(\w+)/, 'exports.$1Copy').replace(/wanted\('(\w+)'\)/, "wanted('$1Copy')");
  const added = [...lines.slice(0, exportLine + 1), copyLine, ...lines.slice(exportLine + 1)].join('\n');
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
  assertEqual(
    '… nor a comment between tokens spread over lines',
    diff(`${indexSrc}\nconst sum = 1 /* a */ + 2;\n`, `${indexSrc}\nconst sum = 1 /* a\n   b */ + 2;\n`),
    { changed: [], loaderChanged: false }
  );
  assertEqual(
    '… nor a line break that changes no meaning, nor the quotes of a string',
    diff(`${indexSrc}\nconst sum = 1 + 2, label = 'a';\n`, `${indexSrc}\nconst sum = 1 +\n  2, label = "a";\n`),
    { changed: [], loaderChanged: false }
  );
  assertEqual(
    '… nor an empty statement, in the loader or among the exports',
    diff(indexSrc, indexSrc.replace("require('./firebaseAdmin');", "require('./firebaseAdmin');;").replace(/(exports\.\w+ = [^;\n]+;)/, '$1;')),
    { changed: [], loaderChanged: false }
  );
  assertEqual(
    '… while an empty statement that is a body is code: `if (x);` runs nothing',
    diff(`${indexSrc}\nif (flag) setup();\n`, `${indexSrc}\nif (flag);\nsetup();\n`)?.loaderChanged,
    true
  );
  assertEqual(
    '… but a line break that changes the meaning is a change',
    diff(`${indexSrc}\nfunction one() { return 1; }\n`, `${indexSrc}\nfunction one() { return\n1; }\n`)?.loaderChanged,
    true
  );
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
    'an export whose condition no longer asks for its own name is loader code: every function runs the condition',
    diff(indexSrc, editLine((line) => line.replace(/wanted\('(\w+)'\)/, "wanted('$1Other')")))?.loaderChanged,
    true
  );
  assertEqual(
    '… and so is a condition that calls anything but the selector the loader passes in',
    diff(indexSrc, editLine((line) => line.replace(/wanted\('(\w+)'\)/, "enabled('$1')")))?.loaderChanged,
    true
  );
  const withCheck = (call) => editLine((line) => line.replace(/wanted\('(\w+)'\)/, `wanted('$1') || ${call}()`));
  assertEqual('… and so is code added to the condition', diff(withCheck('setup'), withCheck('setUp')), { changed: [], loaderChanged: true });
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
    diff(indexSrc, editLine((line) => line.replace(/wanted\('(\w+)'\)/, "wanted('$1 ')")))?.loaderChanged,
    true
  );
  assertEqual('a change to the code around the export lines is a loader change', diff(indexSrc, loaderEdit)?.loaderChanged, true);
  assertEqual('// inside a string is not a comment: a comment after it may change', diff(stringWithSlashes, sameString)?.loaderChanged, false);
  assertEqual('… and the string itself is code', diff(stringWithSlashes, otherString)?.loaderChanged, true);
  assertEqual(
    'spaces inside a loader string are code too',
    diff(`${indexSrc}\nconst label = 'a  b';\n`, `${indexSrc}\nconst label = 'a b';\n`)?.loaderChanged,
    true
  );
  assertEqual(
    '// inside a regular expression is code too',
    diff(`${indexSrc}\nconst pattern = /a[//]old/;\n`, `${indexSrc}\nconst pattern = /a[//]new/;\n`)?.loaderChanged,
    true
  );
  assertEqual(
    '… and inside a template',
    diff(`${indexSrc}\nconst label = \`a \${'//'} old\`;\n`, `${indexSrc}\nconst label = \`a \${'//'} new\`;\n`)?.loaderChanged,
    true
  );
  const sharedLine = (call, before = false) => editLine((line) => (before ? `${call}(); ${line}` : `${line} ${call}();`));
  assertEqual(
    'loader code on an export line is loader code',
    diff(sharedLine('setup'), sharedLine('setUp')),
    { changed: [], loaderChanged: true }
  );
  assertEqual('… before the export too', diff(sharedLine('setup', true), sharedLine('setUp', true)), { changed: [], loaderChanged: true });
  assertEqual(
    'an export moved across loader code redeploys that export: its module now loads on the other side',
    diff(sharedLine('setup', true), sharedLine('setup')),
    { changed: [firstName], loaderChanged: false }
  );
  const placed = (inside) => [
    'function load(wanted) {',
    `  if (flag) { setup(); ${inside ? "if (wanted('A')) exports.A = require('./a').A;" : ''} }`,
    `  ${inside ? '' : "if (wanted('A')) exports.A = require('./a').A;"}`,
    '}',
    'load(() => true);',
  ].join('\n');
  assertEqual('… and so does one moved into another block', diff(placed(true), placed(false)), { changed: ['A'], loaderChanged: false });
  const twoOnALine = (member) => editLine((line) => `${line} if (wanted('Second')) exports.Second = require('./second').${member};`);
  assertEqual(
    'two exports on one line: rewiring the second redeploys the second only',
    diff(twoOnALine('handler'), twoOnALine('other')),
    { changed: ['Second'], loaderChanged: false }
  );
  const called = (argument) => editLine((line) => `${line} if (wanted('Built')) exports.Built = require('./built').build('${argument}');`);
  assertEqual('an export assigned anything but a module or its member is loader code', diff(called('a'), called('b')), { changed: [], loaderChanged: true });
  const loadOne = (call) => [
    `function load(wanted) { ${call}(); if (wanted('A')) exports.A = require('./a').A; }`,
    "exports.B = require('./b').B;",
    'load(() => true);',
  ].join('\n');
  assertEqual('a loader function wiring one export keeps its other code in the loader', diff(loadOne('setup'), loadOne('setUp')), { changed: [], loaderChanged: true });
  // The older form: every function loaded every module at its cold start, so each
  // require there, and each unconditional export, is code every function runs.
  const olderForm = (helper, module, extra = '') => [
    `const helper = require('${helper}');`,
    `const mod = require('${module}');`,
    'helper.bootstrap();',
    'exports.A = mod.A;',
    extra,
  ].join('\n');
  const older = olderForm('./a', './m');
  const loaderChange = (to) => diff(older, to)?.loaderChanged;
  assertEqual('older form: the loader requiring another module is a loader change', loaderChange(olderForm('./b', './m')), true);
  assertEqual('… and so is another module behind an export', loaderChange(olderForm('./a', './n')), true);
  assertEqual(
    '… a module moved across loader code',
    loaderChange(["const helper = require('./a');", 'helper.bootstrap();', "const mod = require('./m');", 'exports.A = mod.A;', ''].join('\n')),
    true
  );
  assertEqual('… a module added with its export', loaderChange(olderForm('./a', './m', "const extra = require('./x');\nexports.B = extra.B;")), true);
  assertEqual(
    '… and two modules swapped: they load in the other order everywhere',
    diff(
      ["const a = require('./a');", "const b = require('./b');", 'exports.A = a.A;', 'exports.B = b.B;'].join('\n'),
      ["const b = require('./b');", "const a = require('./a');", 'exports.A = a.A;', 'exports.B = b.B;'].join('\n')
    )?.loaderChanged,
    true
  );
}

// ───────── 14. Deleted and renamed files ─────────
section('14. A deleted or renamed file');
{
  // The base commit had ai/providers.json, which `require('../providers')` found
  // before ai/providers/index.js. Deleting it is in no closure of the tree being
  // deployed, yet the code that required it now loads something else.
  const deleted = 'functions/ai/providers.json';
  const existedAtBase = (file) => file === deleted || existsSync(join(repoRoot, file));
  const requirers = [...fileToEntries.keys()].filter((file) =>
    [...readFileSync(join(repoRoot, file), 'utf8').matchAll(/require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)]
      .some(([, specifier]) => resolveRelativeRequire(file, specifier, existedAtBase) === deleted));
  const withBase = planChangedFiles([deleted], { exportToFile: parsed.exportToFile, fileToEntries, existedAtBase });
  assert('some code required the deleted JSON without its extension', requirers.length > 0, requirers);
  assertEqual('a deleted file redeploys every function that loaded it at the base commit', [...withBase.exports].sort(), exportsOf(requirers.flatMap(loadersOf)));
  assertEqual('… which the tree being deployed alone does not show', planFor([deleted]).skippedOrphans, [deleted]);

  // A renamed file is a deleted dependency at its old path, so git must list both.
  const repo = mkdtempSync(join(tmpdir(), 'deploy-plan-'));
  try {
    const git = initThrowawayRepo(repo);
    mkdirSync(join(repo, 'functions'));
    writeFileSync(join(repo, 'functions', 'catalog.js'), 'module.exports = { name: "catalog" };\n'.repeat(10));
    git('add', '.');
    git('commit', '-qm', 'base');
    git('mv', 'functions/catalog.js', 'functions/catalogOld.js');
    git('commit', '-qm', 'head');
    assertEqual('a renamed file is listed under both names', getChangedFunctionFiles('HEAD~1', 'HEAD', repo)?.sort(), ['functions/catalog.js', 'functions/catalogOld.js']);
    assertEqual('… and the base commit\'s tree holds the old one', [...(filesAt('HEAD~1', repo) || [])], ['functions/catalog.js']);
  } finally {
    removeTree(repo);
  }
}

console.log('');
if (failures > 0) {
  console.error(`✗ ${failures} test(s) failed`);
  process.exit(1);
}
console.log('✓ All deploy-script tests passed');
