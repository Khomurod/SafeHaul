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
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BACKLOG_PATH, countLines } from './source-size.mjs';
import { checkBacklogDirection, resolveBaselineRef } from './source-size-baseline.mjs';
import { resolveValidatedBaseline } from './source-size-validated.mjs';
import { removeTree } from './lib/throwaway.mjs';


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

{
  /*
   * The override clears a HIGHER bar than an inferred base, and every clause of
   * it is here because the absence of that clause was a measured bypass. The
   * first: it accepted anything that resolved, so `SOURCE_SIZE_BASE=HEAD` on a
   * manual run reported "compared against <head>" and passed, reopening the exact
   * laundering path the refusal exists to close. H29/H33/H34 cover the three that
   * came after. None of them is redundant with another.
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
  // No background `git gc --auto` writing into `.git` after cleanup starts.
  git('config', 'gc.auto', '0');
  git('config', 'maintenance.auto', 'false');
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
  removeTree(dir);
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
  // No background `git gc --auto` writing into `.git` after cleanup starts.
  git('config', 'gc.auto', '0');
  git('config', 'maintenance.auto', 'false');
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
  removeTree(dir);
}

{
  /*
   * A base that predates the backlog, from both directions.
   *
   * Review on 2026-08-27, reproduced against this repository: point
   * `SOURCE_SIZE_BASE` at a fully validated commit from BEFORE
   * `.github/source-size-backlog.json` existed and `git show` fails, which read as
   * "the campaign starts here" and reported nothing at all — so an invented
   * `{"src/invented.js": 9000}` with a matching file passed, and a dispatch on
   * main deploys. The next round showed the same door open with NO override: after
   * a bootstrap push that failed some unrelated job, the newest validated ancestor
   * is still pre-campaign, so the following push inherits the same free pass.
   *
   * Both are refused, and the legitimate route has to keep working — it is how the
   * campaign's own pull request and the push that merges it get measured. The
   * override is a category error and says so; everything else is judged entry by
   * entry against the base, which `bootstrapProblems` covers in
   * `scripts/test-source-size-direction.mjs`.
   */
  const dir = mkdtempSync(join(tmpdir(), 'safehaul-size-precampaign-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  // No background `git gc --auto` writing into `.git` after cleanup starts.
  git('config', 'gc.auto', '0');
  git('config', 'maintenance.auto', 'false');
  git('config', 'user.email', 'tests@safehaul.invalid');
  git('config', 'user.name', 'SafeHaul tests');
  git('config', 'commit.gpgsign', 'false');
  // Debt that pre-dates the campaign, which is the only kind an entry may record.
  writeFileSync(resolve(dir, 'big.js'), 'x\n'.repeat(900));
  git('add', '-A'); git('commit', '-q', '-m', 'pre-campaign, already over the limit');
  const preCampaign = git('rev-parse', 'HEAD');
  mkdirSync(resolve(dir, '.github'), { recursive: true });
  const writeBacklog = (files) => writeFileSync(
    resolve(dir, BACKLOG_PATH), `${JSON.stringify({ files }, null, 2)}\n`,
  );
  writeBacklog({ 'big.js': 900 });
  git('add', '-A'); git('commit', '-q', '-m', 'bootstrap the campaign — this push FAILED');
  writeFileSync(resolve(dir, 'invented.js'), 'x\n'.repeat(9000));
  writeBacklog({ 'big.js': 900, 'invented.js': 9000 });
  git('add', '-A'); git('commit', '-q', '-m', 'fix the unrelated job, and slip a file in');

  const invented = { 'big.js': 900, 'invented.js': 9000 };
  const measured = [
    { path: 'big.js', lines: 900, category: 'runtime' },
    { path: 'invented.js', lines: 9000, category: 'runtime' },
  ];
  const chosen = checkBacklogDirection({
    current: invented, measured, countLines, path: BACKLOG_PATH, requireBaseline: true, cwd: dir,
    env: { GITHUB_EVENT_NAME: 'workflow_dispatch', SOURCE_SIZE_BASE: preCampaign },
    overrideValidated: () => true,
  });
  assert('H27. an override reaching back past the backlog is refused',
    chosen.problems.some((problem) => /predates .*source-size-backlog\.json/.test(problem)),
    `${chosen.describe} — ${chosen.problems.join('; ') || 'nothing reported'}`);

  const failedBootstrap = checkBacklogDirection({
    current: invented, measured, countLines, path: BACKLOG_PATH, requireBaseline: true, cwd: dir,
    env: { GITHUB_EVENT_NAME: 'push' },
    lastValidatedBase: () => preCampaign,
  });
  assert('H31. and so is an INFERRED pre-campaign base after a failed bootstrap',
    failedBootstrap.problems.some((problem) => /invented\.js.*does not exist/.test(problem)),
    `${failedBootstrap.describe} — ${failedBootstrap.problems.join('; ') || 'nothing reported'}`);

  const honest = checkBacklogDirection({
    current: { 'big.js': 900 }, measured: [measured[0]], countLines,
    path: BACKLOG_PATH, requireBaseline: true, cwd: dir,
    env: { GITHUB_EVENT_NAME: 'push' },
    lastValidatedBase: () => preCampaign,
  });
  assert('H32. while the same route passes a bootstrap recording debt that was there',
    honest.problems.length === 0,
    `${honest.describe} — ${honest.problems.join('; ') || 'nothing reported'}`);

  git('checkout', '-q', '-b', 'campaign', preCampaign);
  mkdirSync(resolve(dir, '.github'), { recursive: true });
  writeBacklog({ 'big.js': 900 });
  git('add', '-A'); git('commit', '-q', '-m', 'the campaign, as a pull request');
  const introducing = checkBacklogDirection({
    current: { 'big.js': 900 }, measured: [measured[0]], countLines,
    path: BACKLOG_PATH, requireBaseline: true, cwd: dir,
    env: { GITHUB_PR_BASE_SHA: preCampaign },
  });
  assert('H28. and the pull request that introduces the backlog still passes',
    introducing.problems.length === 0 && /every entry checked against it/.test(introducing.describe),
    `${introducing.describe} — ${introducing.problems.join('; ') || 'nothing reported'}`);
  removeTree(dir);
}

{
  /*
   * And an override cannot reach past the base the run would have chosen itself.
   *
   * The automatic base is the NEWEST validated ancestor, so it is the strictest
   * comparison available: an older validated commit carries a looser recorded
   * count and a looser measured size, so a file regrown to that older ceiling
   * passes. Review then found two more shapes of the same thing, both reproduced —
   * a merge commit whose second-parent tip is an ancestor of NEITHER the head's
   * first-parent base nor of the head's exclusion of it, and a lookup that failed
   * rather than answered. The override exists to answer "nothing validated was
   * found", which is the one case H30 lets through.
   */
  const env = (base) => ({ GITHUB_EVENT_NAME: 'workflow_dispatch', SOURCE_SIZE_BASE: base });
  const newer = execFileSync('git', ['rev-parse', 'HEAD~2'], { encoding: 'utf8' }).trim();

  const behind = resolveBaselineRef({
    env: env('HEAD~3'), overrideValidated: () => true, lastValidatedBase: () => newer,
  });
  assert('H29. an override older than the automatic base is refused',
    behind.ref === null && /does not contain/.test(behind.error || ''), JSON.stringify(behind));

  const nothingFound = resolveBaselineRef({
    env: env('HEAD~3'), overrideValidated: () => true, lastValidatedBase: () => null,
  });
  assert('H30. and accepted when the automatic lookup found nothing to be behind',
    nothingFound.ref !== null && nothingFound.source === 'SOURCE_SIZE_BASE',
    JSON.stringify(nothingFound));

  const incomplete = resolveBaselineRef({
    env: env('HEAD~3'),
    overrideValidated: () => true,
    lastValidatedBase: () => null,
    automaticLookupComplete: () => false,
  });
  assert('H33. "could not ask" is not "there is none" — an incomplete lookup refuses',
    incomplete.ref === null && /did not complete/.test(incomplete.error || ''),
    'one 502 on the second request used to reopen the older-ceiling bypass silently');

  /*
   * The merge case, which needs real divergent history: a validated tip on the
   * second parent is an ancestor of the head and NOT of the first-parent base, so
   * asking "is the override older" answers no and lets it through.
   */
  const dir = mkdtempSync(join(tmpdir(), 'safehaul-size-merge-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  // No background `git gc --auto` writing into `.git` after cleanup starts.
  git('config', 'gc.auto', '0');
  git('config', 'maintenance.auto', 'false');
  git('config', 'user.email', 'tests@safehaul.invalid');
  git('config', 'user.name', 'SafeHaul tests');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(resolve(dir, 'a.txt'), '1\n'); git('add', '-A'); git('commit', '-q', '-m', 'root');
  git('checkout', '-q', '-b', 'side');
  writeFileSync(resolve(dir, 'b.txt'), 's\n'); git('add', '-A'); git('commit', '-q', '-m', 'side');
  const sideTip = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  writeFileSync(resolve(dir, 'a.txt'), '2\n'); git('add', '-A'); git('commit', '-q', '-m', 'main');
  const mainTip = git('rev-parse', 'HEAD');
  git('merge', '-q', '--no-ff', '-m', 'merge side', 'side');

  const sideways = resolveBaselineRef({
    env: env(sideTip), cwd: dir, overrideValidated: () => true, lastValidatedBase: () => mainTip,
  });
  assert('H34. an override incomparable with the automatic base is refused too',
    sideways.ref === null && /does not contain/.test(sideways.error || ''), JSON.stringify(sideways));

  const forward = resolveBaselineRef({
    env: env('HEAD'), cwd: dir, overrideValidated: () => true, lastValidatedBase: () => mainTip,
  });
  assert('H35. and the head-itself refusal still fires before any of this',
    forward.ref === null && /the head itself/.test(forward.error || ''), JSON.stringify(forward));
  removeTree(dir);
}

{
  /*
   * What the lookup REPORTS, as opposed to what `resolveBaselineRef` does with
   * it. H33 proves an incomplete answer refuses; these prove the answer is
   * produced honestly, which is the half that would have gone untested — returning
   * `automaticLookupComplete: () => true` unconditionally passes every case above.
   */
  const headSha = execFileSync('git', ['rev-parse', 'HEAD~3'], { encoding: 'utf8' }).trim();
  const override = { GITHUB_EVENT_NAME: 'workflow_dispatch', SOURCE_SIZE_BASE: 'HEAD~4' };
  const yes = async () => ({ validated: true, error: null });

  const broke = await resolveValidatedBaseline({
    env: override, headSha, lookupOne: yes,
    lookupAncestor: async () => ({ sha: null, checked: 3, error: 'GitHub answered 502' }),
  });
  assert('H41. a lookup that failed reports itself incomplete',
    broke.automaticLookupComplete() === false && /502/.test(broke.error || ''),
    JSON.stringify({ complete: broke.automaticLookupComplete(), error: broke.error }));

  const asked = await resolveValidatedBaseline({
    env: override, headSha, lookupOne: yes,
    lookupAncestor: async () => ({ sha: null, checked: 3, error: null }),
  });
  assert('H42. and one that found nothing reports itself complete',
    asked.automaticLookupComplete() === true && asked.lastValidatedBase() === null,
    'otherwise the override would have no way through at all');

  let askedAncestor = false;
  const push = await resolveValidatedBaseline({
    env: { GITHUB_EVENT_NAME: 'push' }, headSha, lookupOne: yes,
    lookupAncestor: async () => { askedAncestor = true; return { sha: 'abc', checked: 1, error: null }; },
  });
  assert('H43. an event with no override asks for the newest validated ancestor',
    askedAncestor && push.lastValidatedBase() === 'abc' && push.overrideValidated() === false);

  askedAncestor = false;
  const pr = await resolveValidatedBaseline({
    env: { GITHUB_EVENT_NAME: 'pull_request' }, headSha, lookupOne: yes,
    lookupAncestor: async () => { askedAncestor = true; return { sha: 'abc', checked: 1, error: null }; },
  });
  assert('H44. and a pull request asks nothing — its base is a definition',
    !askedAncestor && pr.lastValidatedBase() === null, 'requiring proof would refuse every PR opened while main is red');
}

console.log(failures === 0
  ? '\nAll source-size baseline checks passed.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
