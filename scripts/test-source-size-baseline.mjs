#!/usr/bin/env node
/**
 * Tests for the backlog's anti-tamper baseline.
 *
 * `scripts/source-size.mjs` enforces three rules against
 * `.github/source-size-backlog.json`, and review on 2026-08-27 pointed out that
 * all three read the backlog **in the branch under test** — which that branch may
 * edit. So the checker would have accepted a new 900-line file that arrived
 * together with its own backlog entry, or a listed file grown with its recorded
 * count raised to match. That is precisely the mutable allowlist the campaign
 * rules prohibit.
 *
 * `scripts/source-size-baseline.mjs` closes it by comparing against the copy in
 * git that the branch cannot rewrite, and this file is the reason to believe that
 * works: both forbidden directions, both permitted ones, the ref precedence, the
 * refusal when a run was told to prove it and cannot, and the whole thing driven
 * once through a real throwaway repository — because the pure comparison cannot
 * catch a wrong ref, and the first version of `resolveBaselineRef` had one.
 *
 * Run by `npm run test:source-size`, alongside `scripts/test-source-size.mjs`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BACKLOG_PATH } from './source-size.mjs';
import { checkBacklogDirection, resolveBaselineRef } from './source-size-baseline.mjs';
import {
  backlogShapeProblems, compareBacklog, compareBacklogSizes,
} from './source-size-direction.mjs';
import { countLines } from './source-size.mjs';

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

{
  /*
   * The override clears the same bar as an inferred base, and every clause of it
   * was a bypass before 2026-08-27: it accepted anything that resolved, so
   * `SOURCE_SIZE_BASE=HEAD` on a manual run reported "compared against <head>"
   * and passed — reopening the exact laundering path the refusal exists to close.
   * Measured through the CLI, not reasoned about.
   */
  const env = (base) => ({ GITHUB_EVENT_NAME: 'workflow_dispatch', SOURCE_SIZE_BASE: base });
  const validated = () => true;

  const head = resolveBaselineRef({ env: env('HEAD'), overrideValidated: validated });
  assert('H5. an override naming the head itself is refused',
    head.ref === null && /the head itself/.test(head.error || ''), JSON.stringify(head));

  const unknown = resolveBaselineRef({ env: env('not-a-ref-at-all'), overrideValidated: validated });
  assert('H6. and one that does not resolve is an error, not a fallback',
    unknown.ref === null && unknown.source === 'SOURCE_SIZE_BASE', JSON.stringify(unknown));

  const unvalidated = resolveBaselineRef({ env: env('HEAD~1') });
  assert('H6b. and a real ancestor that carries no validated release is refused',
    unvalidated.ref === null && /does not carry a fully validated release/.test(unvalidated.error || ''),
    JSON.stringify(unvalidated));

  const ok = resolveBaselineRef({ env: env('HEAD~1'), overrideValidated: validated });
  assert('H6c. a validated ancestor is accepted, so the refusal has a way through',
    ok.ref !== null && ok.source === 'SOURCE_SIZE_BASE', JSON.stringify(ok));
}

{
  const noRef = () => ({ ref: null, source: 'HEAD~1', error: 'no parent commit' });
  assert('H7. a run that cannot find a baseline and was told to prove it refuses',
    checkBacklogDirection({ current: {}, path: BACKLOG_PATH, requireBaseline: true, resolveRef: noRef })
      .problems.length === 1,
    'CI passes --require-baseline, so there is no skip path where tampering matters');
  assert('H8. and one that was not told to prove it says the comparison was skipped',
    checkBacklogDirection({ current: {}, path: BACKLOG_PATH, requireBaseline: false, resolveRef: noRef })
      .problems.length === 0
    && /skipped/.test(checkBacklogDirection({ current: {}, path: BACKLOG_PATH, resolveRef: noRef }).describe),
    'a fresh or shallow clone must still be able to run the checker locally');
}

{
  /*
   * The git plumbing, against a real repository rather than a stub: the pure
   * comparison above cannot catch a wrong ref, and the first version of
   * `resolveBaselineRef` asked for `HEAD^{commit}` — which peels HEAD to a commit
   * rather than naming its parent, so every push compared the backlog against
   * itself and could never fail.
   */
  const dir = mkdtempSync(join(tmpdir(), 'safehaul-size-baseline-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'tests@safehaul.invalid');
  git('config', 'user.name', 'SafeHaul tests');
  git('config', 'commit.gpgsign', 'false');
  const writeBacklog = (files) => {
    mkdirSync(resolve(dir, '.github'), { recursive: true });
    writeFileSync(resolve(dir, BACKLOG_PATH), `${JSON.stringify({ files }, null, 2)}\n`);
  };
  writeBacklog({ 'src/big.js': 900 });
  git('add', '-A'); git('commit', '-q', '-m', 'record the backlog');
  writeBacklog({ 'src/big.js': 900, 'src/sneaked.js': 900 });
  git('add', '-A'); git('commit', '-q', '-m', 'grow it');

  const grown = checkBacklogDirection({
    current: { 'src/big.js': 900, 'src/sneaked.js': 900 },
    path: BACKLOG_PATH, requireBaseline: true, env: {}, cwd: dir,
  });
  assert('H9. a real commit that grew the backlog is caught through git',
    grown.problems.some((p) => /adds src\/sneaked\.js/.test(p)),
    `${grown.describe} — ${grown.problems.join('; ') || 'nothing reported'}`);
  assert('H10. and the baseline it used was the PARENT, not the head itself',
    /HEAD~1/.test(grown.describe) && !grown.describe.includes(git('rev-parse', 'HEAD').trim().slice(0, 8)),
    grown.describe);

  const shrunk = checkBacklogDirection({
    current: { 'src/big.js': 900 }, path: BACKLOG_PATH, requireBaseline: true, env: {}, cwd: dir,
  });
  assert('H11. and the same machinery passes a backlog that only shrank',
    shrunk.problems.length === 0, shrunk.problems.join('; '));
  rmSync(dir, { recursive: true, force: true });
}

{
  /*
   * Which baseline a branch with no pull-request context gets.
   *
   * `HEAD~1` was the only fallback at first, and on a feature branch that
   * compares a commit against the one before it INSIDE the same change — so a
   * branch whose first commit legitimately records the backlog was accused of
   * adding entries its base does not have. Reproduced on the branch that
   * introduced this file. The fork point is the right answer there, and `HEAD~1`
   * is right only once the fork point IS the head, which is what being on the
   * default branch means.
   */
  const dir = mkdtempSync(join(tmpdir(), 'safehaul-size-forkpoint-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'tests@safehaul.invalid');
  git('config', 'user.name', 'SafeHaul tests');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(resolve(dir, 'a.txt'), 'a\n');
  git('add', '-A'); git('commit', '-q', '-m', 'first');
  writeFileSync(resolve(dir, 'a.txt'), 'b\n');
  git('add', '-A'); git('commit', '-q', '-m', 'second');
  const forkPoint = git('rev-parse', 'HEAD');
  // A local `origin/main`, which is what a checkout has and a bare init does not.
  git('update-ref', 'refs/remotes/origin/main', forkPoint);
  git('checkout', '-q', '-b', 'feature');
  writeFileSync(resolve(dir, 'a.txt'), 'c\n');
  git('add', '-A'); git('commit', '-q', '-m', 'on the branch');
  writeFileSync(resolve(dir, 'a.txt'), 'd\n');
  git('add', '-A'); git('commit', '-q', '-m', 'and again');

  const onBranch = resolveBaselineRef({ env: {}, cwd: dir });
  assert('H12. a feature branch compares against where it left the default branch',
    onBranch.ref === forkPoint && /merge-base/.test(onBranch.source),
    `${onBranch.source} -> ${onBranch.ref} (fork point is ${forkPoint})`);
  assert('H13. and NOT against its own previous commit, which is inside the change',
    onBranch.ref !== git('rev-parse', 'HEAD~1'),
    'HEAD~1 on a branch accuses the branch of its own legitimate work');

  git('checkout', '-q', 'main');
  const onMain = resolveBaselineRef({ env: {}, cwd: dir });
  assert('H14. on the default branch the fork point is the head, so HEAD~1 is used',
    onMain.source === 'HEAD~1' && onMain.ref === git('rev-parse', 'HEAD~1'),
    `${onMain.source} -> ${onMain.ref}`);

  /*
   * ...but only with NO event at all, which is a developer at a terminal. Every
   * real event compares against the newest ancestor carrying a validated release,
   * and refuses when there is none.
   *
   * Two measured reasons, both from 2026-08-27. `HEAD~1` after a multi-commit
   * push is inside that push, so a dispatch of `main` compared 1300 against 1300
   * and passed a regrowth the push refused — and a dispatch of `main` DEPLOYS.
   * And a push's own `before` is the previous push's tip, so when THAT push
   * failed this check, the next one measures from the failure and ships what was
   * refused. `scripts/resolve-deploy-base.mjs` moved off `before` for the same
   * reason after a function silently failed to deploy for two merges.
   */
  for (const eventName of ['push', 'workflow_dispatch', 'schedule', 'repository_dispatch']) {
    const fired = resolveBaselineRef({ env: { GITHUB_EVENT_NAME: eventName }, cwd: dir });
    assert(`H24. a ${eventName} with nothing validated behind it refuses`,
      fired.ref === null && /no ancestor of this commit carries a fully validated release/
        .test(fired.error || ''),
      `${fired.source} -> ${fired.ref} (${fired.error})`);
  }

  {
    const validatedSha = git('rev-parse', 'HEAD~1');
    const found = resolveBaselineRef({
      env: { GITHUB_EVENT_NAME: 'push' }, cwd: dir, lastValidatedBase: () => validatedSha,
    });
    assert('H25. and uses the validated ancestor when there is one',
      found.ref === validatedSha && found.source === 'the last validated commit',
      `${found.source} -> ${found.ref}`);

    const bogus = resolveBaselineRef({
      env: { GITHUB_EVENT_NAME: 'push' }, cwd: dir, lastValidatedBase: () => git('rev-parse', 'HEAD'),
    });
    assert('H26. a "validated" answer that is the head itself is still refused',
      bogus.ref === null && /the head itself/.test(bogus.error || ''),
      'the lookup is trusted for WHICH commit, never for whether it can be compared');
  }
  rmSync(dir, { recursive: true, force: true });
}

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
  rmSync(dir, { recursive: true, force: true });
}

{
  /*
   * An override cannot claim the campaign has not started yet.
   *
   * Found in review on 2026-08-27 and reproduced against this repository: point
   * `SOURCE_SIZE_BASE` at a fully validated commit from BEFORE
   * `.github/source-size-backlog.json` existed — the main commit this branch is
   * based on qualifies — and `git show` fails, which the branch read as "the
   * campaign starts here" and returned no problems at all. The current backlog is
   * then trusted wholesale, so an invented `{"src/invented.js": 9000}` with a
   * matching 9000-line file passed, and `workflow_dispatch` on main deploys.
   *
   * The pre-campaign pass itself has to survive, though: it is how the campaign's
   * own pull request and the push that merges it get measured. So the refusal is
   * scoped to the base an operator chose, and H28 is the half that proves the
   * legitimate route still works.
   */
  const dir = mkdtempSync(join(tmpdir(), 'safehaul-size-precampaign-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'tests@safehaul.invalid');
  git('config', 'user.name', 'SafeHaul tests');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(resolve(dir, 'a.txt'), 'before the campaign\n');
  git('add', '-A'); git('commit', '-q', '-m', 'pre-campaign');
  const preCampaign = git('rev-parse', 'HEAD');
  mkdirSync(resolve(dir, '.github'), { recursive: true });
  writeFileSync(resolve(dir, BACKLOG_PATH), `${JSON.stringify({ files: { 'big.js': 900 } }, null, 2)}\n`);
  git('add', '-A'); git('commit', '-q', '-m', 'start the campaign');
  writeFileSync(resolve(dir, 'a.txt'), 'later\n');
  git('add', '-A'); git('commit', '-q', '-m', 'and carry on');

  const invented = { 'big.js': 900, 'src/invented.js': 9000 };
  const chosen = checkBacklogDirection({
    current: invented, path: BACKLOG_PATH, requireBaseline: true, cwd: dir,
    env: { GITHUB_EVENT_NAME: 'workflow_dispatch', SOURCE_SIZE_BASE: preCampaign },
    overrideValidated: () => true,
  });
  assert('H27. an override reaching back past the backlog is refused',
    chosen.problems.some((problem) => /predates .*source-size-backlog\.json/.test(problem)),
    `${chosen.describe} — ${chosen.problems.join('; ') || 'nothing reported'}`);

  git('checkout', '-q', '-b', 'campaign', preCampaign);
  mkdirSync(resolve(dir, '.github'), { recursive: true });
  writeFileSync(resolve(dir, BACKLOG_PATH), `${JSON.stringify({ files: { 'big.js': 900 } }, null, 2)}\n`);
  git('add', '-A'); git('commit', '-q', '-m', 'the campaign, as a pull request');
  const introducing = checkBacklogDirection({
    current: { 'big.js': 900 }, path: BACKLOG_PATH, requireBaseline: true, cwd: dir,
    env: { GITHUB_PR_BASE_SHA: preCampaign },
  });
  assert('H28. but the pull request that introduces the backlog still passes',
    introducing.problems.length === 0 && /campaign starts here/.test(introducing.describe),
    `${introducing.describe} — ${introducing.problems.join('; ') || 'nothing reported'}`);
  rmSync(dir, { recursive: true, force: true });
}

{
  /*
   * And it cannot reach behind the base the run would have chosen for itself.
   *
   * The automatic base is the NEWEST validated ancestor, so it is the strictest
   * comparison available. An older validated commit carries a looser recorded
   * count and a looser measured size, so a file regrown to that older ceiling
   * passes — the same laundering shape as `SOURCE_SIZE_BASE=HEAD`, one step out.
   * The override exists to answer "nothing validated was found", which is exactly
   * when H30 lets it through.
   */
  const env = (base) => ({ GITHUB_EVENT_NAME: 'workflow_dispatch', SOURCE_SIZE_BASE: base });
  const head = execFileSync('git', ['rev-parse', 'HEAD~2'], { encoding: 'utf8' }).trim();

  const behind = resolveBaselineRef({
    env: env('HEAD~3'), overrideValidated: () => true, lastValidatedBase: () => head,
  });
  assert('H29. an override older than the automatic base is refused',
    behind.ref === null && /is older than/.test(behind.error || ''), JSON.stringify(behind));

  const nothingFound = resolveBaselineRef({
    env: env('HEAD~3'), overrideValidated: () => true, lastValidatedBase: () => null,
  });
  assert('H30. and accepted when the automatic lookup found nothing to be behind',
    nothingFound.ref !== null && nothingFound.source === 'SOURCE_SIZE_BASE',
    JSON.stringify(nothingFound));
}

console.log(failures === 0
  ? '\nAll source-size baseline checks passed.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
