/**
 * K, L — the guards that have to stay guards.
 *
 * K pins the steps that were once advisory and are now blocking, so none can
 * quietly go back to `continue-on-error`. L pins the secret scanner's wiring: no
 * third-party scanning action, full history checked out, no `if:` that can
 * condition it away, and an audit that reports without being able to block a
 * release.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { ALWAYS_REQUIRED_JOBS } from '../ci-plan.mjs';
import { evaluateValidation } from '../verify-release-validation.mjs';
import { allJobs, assert, here, plan, workflow } from './test-support.mjs';

console.log('\nK. Guards that stay guards');
/* ==========================================================================
 * Every check in this group exists because the repository had a lane that
 * reported instead of enforcing, and nobody could tell.
 *
 * The visual lane ran with `continue-on-error: true` on the stated grounds that
 * pixel baselines are not portable across machines. The CI record said otherwise:
 * `20 failed / 132 passed` on every run, the twenty being every application
 * screen, because the application fetched its typeface from a third party that
 * the runner could not reach. The lane had never once been green, it uploaded a
 * 52MB diff artifact nobody opened, and its warning annotation fired every time.
 *
 * The accessibility lane ran with `continue-on-error: true` under a comment
 * saying to fold it into the blocking lane "once confirmed green in CI". It had
 * been green — 11/11 — for weeks.
 *
 * A lane that cannot fail teaches everyone to ignore it, which is worse than no
 * lane at all. These assert that neither can quietly go back.
 * ========================================================================== */
{
    const workflowRaw = readFileSync(resolvePath(here, '../.github/workflows/main.yml'), 'utf8');
    /*
     * Comment lines go first. This pipeline documents at length what it used to do
     * wrong, so the very strings these assertions forbid appear in prose right
     * above the steps that no longer contain them — and a guard that fires on its
     * own explanation is a guard someone deletes.
     */
    const workflowText = workflowRaw
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');

    /** The `- name: … / …` step block a given step name introduces. */
    const stepBlock = (name) => {
        const start = workflowText.indexOf(`- name: ${name}`);
        if (start < 0) return null;
        const rest = workflowText.slice(start + 1);
        const next = rest.indexOf('\n      - name:');
        return next < 0 ? rest : rest.slice(0, next);
    };

    const visualStep = stepBlock('Visual regression (pixel baselines)');
    assert('K1. the visual-regression step exists', visualStep !== null,
        'renaming it would make the continue-on-error assertion below vacuous');
    assert('K1. the visual-regression step is blocking',
        visualStep !== null && !/continue-on-error:\s*true/.test(visualStep),
        'a pixel-baseline lane that cannot fail is a report, not a guard');

    assert('K2. no workflow step excludes the accessibility specs',
        !/--grep-invert[^\n]*@a11y/.test(workflowText),
        'the axe specs belong in the blocking lane, not behind a grep-invert');
    assert('K2b. no workflow step runs the accessibility specs with continue-on-error',
        !/@a11y[\s\S]{0,200}?continue-on-error:\s*true/.test(workflowText),
        'an accessibility gate nobody has to pass is a report, not a gate');

    /*
     * The application must not fetch its typeface at runtime. That is what broke
     * the visual lane for the whole of its existence, and it degrades the product
     * for anyone whose network cannot reach the CDN.
     */
    const appCss = readFileSync(resolvePath(here, '../src/index.css'), 'utf8');
    const catalogCss = readFileSync(resolvePath(here, '../.storybook/preview.css'), 'utf8');
    const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [label, css] of [['src/index.css', appCss], ['.storybook/preview.css', catalogCss]]) {
        assert(`K3. ${label} loads no remote stylesheet or font`,
            !/@import\s+url\(\s*['"]?https?:/.test(withoutComments(css)),
            'the typeface is served from src/design-system/fonts; a remote @import is what '
            + 'made every application baseline fail on the runner');
    }

    const fontDir = resolvePath(here, '../src/design-system/fonts');
    assert('K3b. the typeface is in the repository',
        existsSync(resolvePath(fontDir, 'InterVariable.woff2'))
        && existsSync(resolvePath(fontDir, 'InterVariable-Italic.woff2'))
        && existsSync(resolvePath(fontDir, 'LICENSE.txt')),
        'both faces plus the SIL OFL licence that permits redistributing them');
}

console.log('\nL. The secret scanner is scoped, pinned, and still mandatory');
{
    /*
     * Recorded 2026-08-26, after run #159.
     *
     * `gitleaks/gitleaks-action@v2` chose the scan range from the event and, on
     * `workflow_dispatch`, passed no range at all — so a manual verification of
     * an already-merged commit scanned all 256 commits, reported eight known
     * legacy values from 2025-12..2026-03, failed `secret-scan`, failed
     * `release-validation` and skipped both deploys.
     *
     * These assertions exist because that was invisible from inside this
     * repository: the range lived in someone else's JavaScript. They pin the
     * three properties that must not quietly come back — the range is ours, the
     * scanner is pinned, and the full sweep cannot gate a release.
     */
    const secretScanJob = workflow.slice(
        workflow.indexOf('  secret-scan:'),
        workflow.indexOf('  callable-contract:'),
    );
    assert('L1. secret-scan uses no third-party scanning action',
        !/^\s*(-\s*)?uses:\s*gitleaks\//m.test(secretScanJob),
        'the action decided the range from the event; on workflow_dispatch that meant all history');
    assert('L2. secret-scan runs this repository\'s own scanner',
        /run:\s*node scripts\/secret-scan\.mjs/.test(secretScanJob),
        'the range must be selected by scripts/secret-scan.mjs, which is tested');
    assert('L3. secret-scan still checks out full history',
        /fetch-depth:\s*0/.test(secretScanJob),
        'a merge needs both parents\' ancestry present to resolve base..head');
    assert('L4. secret-scan carries no `if:`, so it cannot be conditioned away',
        !/^\s{4}if:/m.test(secretScanJob),
        'it is in ALWAYS_REQUIRED_JOBS; an `if:` that evaluates false would read as "nothing failed"');
    assert('L5. secret-scan is still required on every release',
        ALWAYS_REQUIRED_JOBS.includes('secret-scan'),
        'release-validation demands success from it, never a skip');
    assert('L6. release-validation still refuses when secret-scan fails',
        evaluateValidation({
            planResult: 'success',
            jobResults: { ...allJobs('success'), 'secret-scan': 'failure' },
            lanePlan: plan(() => ({ selected: true, attested: false })),
        }).ok === false,
        'a scanner failure must never be interpretable as a pass');
    assert('L7. release-validation also refuses when secret-scan is merely skipped',
        evaluateValidation({
            planResult: 'success',
            jobResults: { ...allJobs('success'), 'secret-scan': 'skipped' },
            lanePlan: plan(() => ({ selected: true, attested: false })),
        }).ok === false,
        'the deploy jobs sit behind this verdict, so a missing scan is a refusal');

    /*
     * L8-L10 and L15-L26 moved to `scripts/secret-scan/test-pinning.mjs` on
     * 2026-08-27, when the scanner outgrew one file.
     *
     * They read the scanner's own SOURCE — the pinned version and digest, both
     * scan modes, the flags, and `.gitleaks.toml` line for line — and this file
     * read it as a path, `./secret-scan.mjs`. Splitting the scanner would have
     * left those regexes passing over a 212-line entry that no longer contains
     * what they check, which is the worst way for a security assertion to fail.
     * `test-pinning.mjs` reads the transitive closure of the entry's imports
     * instead, so it cannot go stale the next time a module moves.
     *
     * What stays here is the WIRING: that the job exists, runs this repository's
     * scanner, checks out full history, cannot be conditioned away, is still
     * required, still fails the release when it fails or is skipped, and that the
     * separate full-history audit cannot reach `release-validation`.
     */
    /*
     * The full-history sweep still exists — it just cannot block a deploy. If it
     * ever gains a push or pull_request trigger, or turns up in
     * release-validation's `needs`, the 2026-08-26 failure is back.
     */
    const auditPath = resolvePath(here, '../.github/workflows/secret-history-audit.yml');
    assert('L11. the deliberate full-history audit exists',
        existsSync(auditPath),
        'legacy findings must stay visible somewhere, or removing them from the gate hides them');
    if (existsSync(auditPath)) {
        const audit = readFileSync(auditPath, 'utf8');
        const triggers = audit.slice(audit.indexOf('\non:'), audit.indexOf('\njobs:'));
        assert('L12. the audit runs on a schedule and on demand only',
            /schedule:/.test(triggers) && /workflow_dispatch:/.test(triggers)
            && !/^\s*push:/m.test(triggers) && !/^\s*pull_request:/m.test(triggers),
            'a full-history sweep on push or pull_request is the failure this change removed');
        assert('L13. the audit scans all refs',
            /--all/.test(audit) || /'--all'/.test(readFileSync(resolvePath(here, './secret-history-audit.mjs'), 'utf8')),
            'a secret parked on an unmerged branch is still in the repository');
    }
    const validationJob = workflow.slice(workflow.indexOf('  release-validation:'));
    assert('L14. release-validation does not depend on the history audit',
        !/secret-history-audit/.test(validationJob),
        'the audit reports; it must never be able to block a release');
}
