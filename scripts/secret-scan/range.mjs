/**
 * What this change is compared against, decided from the event alone.
 *
 * ## Why this exists rather than `gitleaks/gitleaks-action@v2`
 *
 * The action decides the scan range from the event payload, and its rules were
 * read out of its own source (`src/gitleaks.js`) rather than assumed:
 *
 * | event              | `--log-opts` the action passes            |
 * |--------------------|-------------------------------------------|
 * | `pull_request`     | `--no-merges --first-parent base^..head`   |
 * | `push`             | same, or `-1` when before == after         |
 * | `workflow_dispatch`| *nothing* — so gitleaks scans ALL history  |
 * | `schedule`         | *nothing* — same                            |
 *
 * Three separate defects, each measured on 2026-08-26 rather than reasoned
 * about:
 *
 * 1. **The dispatch case scans everything.** Run #159 on `8c3315d` scanned 256
 *    commits and reported 67 findings — eight distinct values, all from
 *    2025-12 to 2026-03, none of them from the commit under test. It failed
 *    `secret-scan`, which failed `release-validation`, which skipped both
 *    deploys. A manual verification of an already-merged commit cannot mean
 *    "scan every commit SafeHaul ever had"; that turns a fixed, known,
 *    separately-tracked history problem into a permanent release blocker.
 * 2. **`--first-parent` misses whole branches.** Measured in a synthetic repo: a
 *    secret committed on a side branch and merged into main is found by
 *    `base..head` and **not found** by `--no-merges --first-parent base^..head`.
 *    The mainline walk never visits the second parent's commits.
 * 3. **`--no-merges` misses conflict resolutions.** A merge commit can add
 *    content that is in neither parent. Measured: `base..head` finds 0 there
 *    (git shows no patch for a merge by default), `-m base..head` finds it.
 *    `--cc` was tried first and finds 0 — gitleaks does not parse combined-diff
 *    format, which is exactly why this was tested instead of assumed.
 *
 * ## Failing safe
 *
 * Every path that cannot determine a trustworthy base **throws `ScanPlanError`**,
 * and every caller exits non-zero with the reason. There is deliberately no
 * fallback to "scan everything": that is the behaviour this replaces, and it
 * reports six-month-old history as though the current release introduced it. A
 * scanner that cannot say what it compared against has not validated anything.
 *
 * Historical findings are not hidden — they are inventoried by
 * `.github/workflows/secret-history-audit.yml` and classified in
 * `docs/SECRET_HISTORY_AUDIT.md`, which is where legacy leaks belong: a
 * deliberate security procedure, not a gate every unrelated release trips over.
 *
 * This module is pure apart from the injected `git`, which is why every branch
 * below has a test.
 */

import { short } from './git.mjs';
import { RELEASE_VALIDATION_CHECK_NAME, SECRET_SCAN_CHECK_NAME } from './validated.mjs';

/** All-zero SHA: what a push event sends for "there was nothing here before". */
const ZERO_SHA = '0'.repeat(40);

/** Events whose baseline is the previous state of the branch being verified. */
export const REVERIFICATION_EVENTS = Object.freeze(['workflow_dispatch', 'schedule', 'repository_dispatch']);

/** A base that could not be determined. Always fatal, never a wider scan. */
export class ScanPlanError extends Error {}

/**
 * Decide what to compare against, deterministically, from the event alone.
 *
 * `git` is injected so `scripts/secret-scan/test-range.mjs` can drive every branch
 * against real throwaway repositories without a GitHub event in sight.
 *
 * @param {object} options
 * @param {string} options.eventName            GITHUB_EVENT_NAME
 * @param {object} options.payload              parsed GITHUB_EVENT_PATH contents
 * @param {string} options.headSha              commit actually checked out
 * @param {string} [options.baseOverride]       SECRET_SCAN_BASE, an owner escape hatch
 * @param {() => (string|null)} [options.lastValidatedBase]
 *        the newest ancestor whose own secret-scan passed, looked up before this is
 *        called; `null` when there is none, which every caller treats as a refusal
 * @param {{exists:(s:string)=>boolean, isAncestor:(a:string,b:string)=>boolean,
 *          mergeBase:(a:string,b:string)=>(string|null)}} options.git
 * @returns {{base: string, head: string, source: string, logOpts: string, describe: string}}
 */
export function resolveScanPlan({
    eventName,
    payload = {},
    headSha,
    baseOverride = '',
    lastValidatedBase = () => null,
    isValidatedRelease = () => false,
    git,
}) {
    if (!headSha || !/^[0-9a-f]{40}$/i.test(headSha)) {
        throw new ScanPlanError(`the head commit is not a full SHA: ${JSON.stringify(headSha)}`);
    }
    if (!git.exists(headSha)) {
        throw new ScanPlanError(
            `the head commit ${short(headSha)} is not in this clone. `
            + 'Check out with `fetch-depth: 0`.',
        );
    }

    /*
     * An explicit base wins, and clears exactly the same bar as an inferred one.
     *
     * Found in review on 2026-08-26 (P1): it used to clear only the structural
     * bar — a real SHA, an ancestor, not the head — and the refusal message
     * above *tells an operator to set it*. So the natural repair for "nothing is
     * validated" was to paste in the tip that had just failed, which is the one
     * commit whose broken scanner reported success while its own tests did not.
     * The increment behind it would be skipped again, and a dispatch deploys.
     *
     * The override is therefore a pointer to a release known to be good, not a
     * free choice of baseline. Where that leaves it useful: the automatic walk
     * looks back a bounded number of commits, and naming an older validated
     * release reaches past that. Where it is deliberately no longer useful:
     * making a branch with no validated release scannable by picking a base out
     * of the air.
     */
    if (baseOverride) {
        const base = requireUsableBase(git, baseOverride, headSha, 'SECRET_SCAN_BASE');
        if (!isValidatedRelease(base)) {
            throw new ScanPlanError(
                `SECRET_SCAN_BASE=${short(base)} does not carry a fully validated release: `
                + `"${SECRET_SCAN_CHECK_NAME}" and "${RELEASE_VALIDATION_CHECK_NAME}" must both have `
                + 'succeeded in one run on it. An override is a pointer to a release known to be '
                + 'good, not a way to choose a baseline that was never verified — that is exactly '
                + 'the commit whose failure this job exists to catch.',
            );
        }
        return plan(base, headSha, 'explicit-base-override');
    }

    if (eventName === 'pull_request' || eventName === 'pull_request_target') {
        const baseSha = payload?.pull_request?.base?.sha;
        if (!baseSha) {
            throw new ScanPlanError(
                'this pull_request event carries no `pull_request.base.sha`, so the change cannot '
                + 'be separated from the base branch. Refusing to scan an unknown range.',
            );
        }
        if (!git.exists(baseSha)) {
            throw new ScanPlanError(
                `the pull request's base commit ${short(baseSha)} is not in this clone. `
                + 'Check out with `fetch-depth: 0`.',
            );
        }
        // The merge base, not the base branch tip: the range then holds exactly
        // the commits this pull request proposes, and never the base branch's
        // own later history.
        const mergeBase = git.mergeBase(baseSha, headSha);
        if (!mergeBase) {
            throw new ScanPlanError(
                `no merge base between ${short(baseSha)} and ${short(headSha)} — the branches share `
                + 'no history, so "what this change adds" is undefined. Refusing to guess.',
            );
        }
        if (mergeBase === headSha) {
            throw new ScanPlanError(
                `the merge base of this pull request equals its head (${short(headSha)}), so the range `
                + 'would be empty and nothing would be compared. Refusing.',
            );
        }
        return plan(mergeBase, headSha, 'pull-request-merge-base');
    }

    if (eventName === 'push') {
        const before = payload?.before;
        /*
         * A push is compared against the last commit CI actually validated, not
         * against the push's own `before`.
         *
         * `before` is the obvious answer and it is wrong in one specific,
         * reachable way, found in review on 2026-08-26 and reproduced: when the
         * PREVIOUS push failed its scan, `before` is that failed tip. The next
         * ordinary push then compares against it, so the increment that failed
         * is behind the range; if the credential it added was also deleted in
         * that increment, the tree is clean too, and the later push passes and
         * DEPLOYS. Measured on a throwaway repository: push A (adds and deletes
         * a synthetic key) fails with 1 finding, push B passes with 0 — and the
         * same push B anchored at the last validated commit fails with 1.
         *
         * `before` is also unusable for a branch just created (all zeros) or
         * force-pushed (not an ancestor of the new head), and the old fallback
         * for those — the merge base with the default branch — collapsed to the
         * head itself after a force-push TO the default branch, scanning
         * nothing. Both cases now take the same answer as the first.
         *
         * In the healthy case this changes nothing: the previous tip passed its
         * own scan, so it IS the last validated commit and the range is
         * identical. It widens only where something was left unverified, which
         * is exactly where widening is the point. And it gives the pipeline an
         * invariant worth stating: since a deploy requires this job to pass,
         * nothing reaches Testing unless every commit since the last passing
         * scan was scanned.
         */
        const validated = lastValidatedBase();
        if (validated) {
            return plan(
                requireUsableBase(git, validated, headSha, 'the last validated commit'),
                headSha,
                'last-validated-commit',
            );
        }
        throw new ScanPlanError(
            `no ancestor of ${short(headSha)} carries a fully validated release `
            + `(before=${describeSha(before)}), so there is no baseline to compare against. A baseline `
            + `needs both "${SECRET_SCAN_CHECK_NAME}" and "${RELEASE_VALIDATION_CHECK_NAME}" to have `
            + 'succeeded in one run. Trusting `before` here is what lets the increment behind a FAILED '
            + 'scan through. Set SECRET_SCAN_BASE to a commit you know was scanned, or fix the failing '
            + 'run. Refusing to fall back to a full-history scan, or to an empty one.',
        );
    }

    if (REVERIFICATION_EVENTS.includes(eventName)) {
        /*
         * A manual or scheduled run re-verifies a commit that is already on the
         * branch, so its baseline is "the last thing CI actually validated".
         *
         * This used to be `head^1`, on the reasoning that every earlier commit
         * was scanned by the event that introduced it. Review on 2026-08-26
         * found the hole in that: it assumes the earlier scan *passed*. A push
         * whose scan FAILED, followed by a manual re-run, would scan only the
         * last commit — so a credential added in an earlier commit of that push
         * and deleted before its tip is in neither the range nor the tree, and
         * the manual run is green. `workflow_dispatch` deploys, so that is a
         * bypass of the gate rather than a gap in a report.
         *
         * The baseline is therefore the newest ancestor carrying a fully validated
         * release — which is exactly "the last validated commit" — and
         * when there is none, this refuses and asks for an explicit base. It
         * never widens to a full-history scan, and never narrows to an empty one.
         */
        const validated = lastValidatedBase();
        if (validated) {
            return plan(
                requireUsableBase(git, validated, headSha, 'the last validated commit'),
                headSha,
                'last-validated-commit',
            );
        }
        throw new ScanPlanError(
            `no ancestor of ${short(headSha)} carries a fully validated release, so there is no `
            + `baseline to compare against. A baseline needs both "${SECRET_SCAN_CHECK_NAME}" and `
            + `"${RELEASE_VALIDATION_CHECK_NAME}" to have succeeded in one run. This is what a re-run `
            + 'after a FAILED push looks like, and scanning only the newest commit would step over the '
            + 'failure. Set SECRET_SCAN_BASE to a commit you know was scanned, or fix the failing run.',
        );
    }

    throw new ScanPlanError(
        `unsupported event "${eventName}": this scanner will not guess a range it has no rule for. `
        + 'Add an explicit rule, or pass SECRET_SCAN_BASE.',
    );
}

function requireUsableBase(git, candidate, headSha, label) {
    if (!/^[0-9a-f]{7,40}$/i.test(candidate)) {
        throw new ScanPlanError(`${label} is not a commit SHA: ${JSON.stringify(candidate)}`);
    }
    /*
     * Resolve to the full SHA before anything COMPARES it.
     *
     * An abbreviated SHA of the head is a different string and the same commit,
     * and every check below except this one is a string comparison. Found in
     * review on 2026-08-26 and reproduced: `SECRET_SCAN_BASE=<head[0..8]>` was
     * accepted, `git merge-base --is-ancestor` said yes (a commit is its own
     * ancestor), and the resulting `short..full` range held 0 commits — so a
     * credential added and deleted inside the change was compared against
     * nothing and the job passed. Against the same repository with the correct
     * base it fails with 1 finding.
     */
    const resolved = git.resolve(candidate);
    if (!resolved) {
        throw new ScanPlanError(`${label}=${short(candidate)} is not a commit in this clone.`);
    }
    if (resolved === headSha) {
        throw new ScanPlanError(
            `${label}=${short(candidate)} resolves to the head itself (${short(headSha)}), so the `
            + 'range would be empty and nothing would be compared. Refusing.',
        );
    }
    if (!git.isAncestor(resolved, headSha)) {
        throw new ScanPlanError(
            `${label}=${short(candidate)} is not an ancestor of ${short(headSha)}, so `
            + `${short(candidate)}..${short(headSha)} would not describe this change.`,
        );
    }
    // The canonical SHA, never the string that was handed in: everything
    // downstream — the equality guard in `plan()`, the range, the report —
    // compares and prints it.
    return resolved;
}

/**
 * `-m` is the flag that makes merge commits visible.
 *
 * `git log -p` prints no patch for a merge, so a secret added while resolving a
 * conflict is invisible without it — measured, not assumed. `-m` diffs a merge
 * against each parent, which over-reports (a merge shows twice) and never
 * under-reports. For a security gate that direction is the only acceptable one.
 *
 * Neither `--first-parent` nor `--no-merges` appears here, deliberately: they are
 * what let a secret ride in on a second parent.
 */
function plan(base, head, source) {
    if (base === head) {
        throw new ScanPlanError(
            `the computed base equals the head (${short(head)}), so the range is empty and nothing `
            + `would be compared (source: ${source}). Refusing.`,
        );
    }
    return {
        base,
        head,
        source,
        logOpts: `-m ${base}..${head}`,
        describe: `${short(base)}..${short(head)} (${source})`,
    };
}

const describeSha = (sha) => (!sha ? 'absent' : (sha === ZERO_SHA ? 'all zeros' : short(sha)));
