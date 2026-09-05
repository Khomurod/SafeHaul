#!/usr/bin/env node
/**
 * Tests for the backlog's direction of travel.
 *
 * `scripts/source-size-direction.mjs` answers "did the backlog move the wrong
 * way" — entries added, counts raised, a count that is not a count, a backlogged
 * file bigger than at the base, and the one moment there is no previous copy to
 * compare against at all. `scripts/source-size-baseline.mjs` answers the harder
 * question of what "the base" is, and `scripts/test-source-size-baseline.mjs`
 * covers that; the two were one file until it approached the limit this campaign
 * is enforcing.
 *
 * Almost every case here is pure — no repository, no network — because that is
 * what splitting the comparisons out bought. The two that are not drive the whole
 * chain through a throwaway repository, because a pure comparison cannot catch a
 * wrong ref or a mis-read blob, and both of this file's subjects have been wrong
 * that way before.
 *
 * Run by `npm run test:source-size`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BACKLOG_PATH, countLines } from './source-size.mjs';
import { checkBacklogDirection } from './source-size-baseline.mjs';
import { removeTree } from './lib/throwaway.mjs';
import {
  backlogShapeProblems, bootstrapProblems, compareBacklog, compareBacklogSizes,
} from './source-size-direction.mjs';

let failures = 0;
function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ========================================================================== */
console.log('\nH. The backlog cannot be edited into an allowlist');
/* ========================================================================== */

/*
 * The rules in `evaluate` are enforced against the backlog in the BRANCH UNDER
 * TEST, which that branch may edit — so on its own the checker would accept a new
 * 900-line file that arrived together with its own backlog entry. Found in review
 * on 2026-08-27. What is pinned is therefore the direction of change, against the
 * copy in git that the branch cannot rewrite.
 */

assert('H1. an entry that was not there before is refused',
  compareBacklog({ 'src/old.js': 900 }, { 'src/old.js': 900, 'src/new.js': 900 })
    .some((p) => /adds src\/new\.js/.test(p)),
  'adding a file and its own exemption in one change is the bypass this closes');

assert('H2. a recorded count that went UP is refused',
  compareBacklog({ 'src/big.js': 900 }, { 'src/big.js': 1200 })
    .some((p) => /raises src\/big\.js from 900 to 1200/.test(p)),
  'raising the ceiling to match a file that grew defeats the may-not-grow rule');

assert('H3. removing an entry is the campaign working, not a problem',
  compareBacklog({ 'src/a.js': 900, 'src/b.js': 700 }, { 'src/b.js': 700 }).length === 0);

assert('H4. and so is lowering one',
  compareBacklog({ 'src/a.js': 900 }, { 'src/a.js': 600 }).length === 0);

/*
 * A count that is not a count. Found in review on 2026-08-27 and reproduced: every
 * rule compares with `>`, a non-number coerces to NaN, and every comparison
 * against NaN is false — so a malformed entry exempted a 9000-line file from the
 * hard limit AND from the may-not-grow rule, silently.
 */
assert('H15. a recorded count that is not a number is refused',
  backlogShapeProblems({ 'src/big.js': 'unbounded' }).length === 1
  && backlogShapeProblems({ 'src/big.js': null }).length === 1
  && backlogShapeProblems({ 'src/big.js': 900.5 }).length === 1
  && backlogShapeProblems({ 'src/big.js': -1 }).length === 1,
  'NaN comparisons are false, so a malformed entry exempts rather than fails');

assert('H16. and a whole number of lines is fine',
  backlogShapeProblems({ 'src/big.js': 900, 'src/other.js': 0 }).length === 0);

assert('H17. nothing is compared until the shape is sound',
  compareBacklog({ 'src/big.js': 900 }, { 'src/big.js': 'unbounded' })
    .every((problem) => /not a line count/.test(problem)),
  'reporting "it did not grow" about a value that is not a size would be a lie');

{
  /*
   * The per-file ratchet, and the scenario that made it necessary: a backlogged
   * file that shrinks while its dated count stays put could be REGROWN to
   * anything at or below the snapshot. Review on 2026-08-27 named the sequence —
   * 1358 -> 1200 -> 1300 passes the recorded-count rule twice — which made
   * campaign progress reversible despite the may-never-grow invariant.
   */
  const backlog = { 'src/big.js': 1358 };
  const grew = compareBacklogSizes({ 'src/big.js': 1200 }, [
    { path: 'src/big.js', lines: 1300, category: 'runtime' },
  ], backlog);
  assert('H18. a backlogged file bigger than at the base is refused',
    grew.length === 1 && /up from 1200 at the base/.test(grew[0]),
    `${grew.join('; ') || 'nothing reported'} — 1300 is under the recorded 1358, so the `
    + 'recorded count alone lets this through');

  assert('H19. and shrinking further is not a problem',
    compareBacklogSizes({ 'src/big.js': 1200 }, [
      { path: 'src/big.js', lines: 1100, category: 'runtime' },
    ], backlog).length === 0);

  assert('H20. an unbacklogged file is not ratcheted — the hard limit governs it',
    compareBacklogSizes({ 'src/small.js': 100 }, [
      { path: 'src/small.js', lines: 300, category: 'runtime' },
    ], backlog).length === 0,
    'a 300-line file growing from 100 is ordinary work, not a campaign regression');

  assert('H21. a file absent at the base cannot have grown',
    compareBacklogSizes({}, [
      { path: 'src/big.js', lines: 9000, category: 'runtime' },
    ], backlog).length === 0,
    'that case is an ADDED backlog entry, which compareBacklog catches instead');

  assert('H22. an unreadable measurement is skipped rather than treated as growth',
    compareBacklogSizes({ 'src/big.js': 1200 }, [
      { path: 'src/big.js', lines: null, category: 'runtime' },
    ], backlog).length === 0);
}

{
  // The ratchet through git, on a real repository: the pure comparison above
  // cannot catch a wrong ref or a mis-read blob.
  const dir = mkdtempSync(join(tmpdir(), 'safehaul-size-ratchet-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  // No background `git gc --auto` writing into `.git` after cleanup starts.
  git('config', 'gc.auto', '0');
  git('config', 'maintenance.auto', 'false');
  git('config', 'user.email', 'tests@safehaul.invalid');
  git('config', 'user.name', 'SafeHaul tests');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(resolve(dir, '.github'), { recursive: true });
  const backlog = { 'big.js': 1358 };
  writeFileSync(resolve(dir, BACKLOG_PATH), `${JSON.stringify({ files: backlog }, null, 2)}\n`);
  writeFileSync(resolve(dir, 'big.js'), `${'x\n'.repeat(1200)}`);
  git('add', '-A'); git('commit', '-q', '-m', 'shrunk to 1200, record left at 1358');
  writeFileSync(resolve(dir, 'big.js'), `${'x\n'.repeat(1300)}`);
  git('add', '-A'); git('commit', '-q', '-m', 'regrown to 1300');

  const verdict = checkBacklogDirection({
    current: backlog,
    measured: [{ path: 'big.js', lines: 1300, category: 'runtime' }],
    countLines,
    path: BACKLOG_PATH,
    requireBaseline: true,
    env: {},
    cwd: dir,
  });
  assert('H23. and the whole chain refuses the regrowth through git',
    verdict.problems.some((problem) => /big\.js is 1300 lines, up from 1200/.test(problem)),
    `${verdict.describe} — ${verdict.problems.join('; ') || 'nothing reported'}`);
  removeTree(dir);
}

{
  /*
   * The bootstrap: the one comparison that has no previous backlog to make.
   *
   * Returning "no problems" there was a bypass reachable two ways, both
   * reproduced on 2026-08-27 — an operator naming a validated pre-campaign
   * commit, and, with no override at all, the push after a bootstrap that failed
   * an unrelated job, whose newest validated ancestor is therefore still
   * pre-campaign. `scripts/test-source-size-baseline.mjs` drives both through git;
   * these are the rule itself, which is a fact about the base rather than about
   * who chose it.
   */
  const at = 'aaaaaaaa000000000000000000000000000000000';

  assert('H36. an entry for a file that does not exist at the base is refused',
    bootstrapProblems({ 'old.js': 900 }, { 'old.js': 900, 'new.js': 9000 }, at)
      .some((problem) => /new\.js.*does not exist/.test(problem)),
    'recording a file the change itself adds is a new exemption, not a record of one');

  assert('H37. and so is one recording the size a file only grew to here',
    bootstrapProblems({ 'grew.js': 480 }, { 'grew.js': 520 }, at)
      .some((problem) => /records grew\.js at 520 lines, but it was 480/.test(problem)),
    'otherwise a file could cross the limit and be exempted in the same change');

  assert('H38. debt the base already carried is what an entry is for',
    bootstrapProblems({ 'old.js': 900 }, { 'old.js': 900 }, at).length === 0);

  assert('H39. and a count below the base size is a dated record, not a problem',
    bootstrapProblems({ 'old.js': 900 }, { 'old.js': 700 }, at).length === 0,
    'the ratchet governs how big the file may be; the count only records where it started');

  assert('H40. a count that is not a count is refused here too',
    bootstrapProblems({ 'big.js': 480 }, { 'big.js': 'unbounded' }, at)
      .every((problem) => /not a line count/.test(problem))
    && bootstrapProblems({ 'big.js': 480 }, { 'big.js': 'unbounded' }, at).length > 0,
    'NaN makes `lines > before` false, so the second rule would pass over it silently');

  assert('H45. an empty backlog reports nothing rather than throwing',
    bootstrapProblems({}, {}, at).length === 0 && bootstrapProblems({}, null, at).length === 0);
}

console.log(failures === 0
  ? '\nAll source-size direction checks passed.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
