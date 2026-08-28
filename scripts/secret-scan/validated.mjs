/**
 * "Was that commit's release fully validated?" — asked of GitHub, because git
 * cannot answer it.
 *
 * A commit's history says nothing about whether CI ever passed on it, and the
 * whole baseline strategy in `range.mjs` rests on this question: every event but
 * a pull request compares against the newest ancestor carrying a validated
 * release. Getting this wrong fails closed (nothing looks validated, so the scan
 * refuses), which is the right direction but an unhelpful message, so the two
 * ways it can fail — "nothing qualifies" and "could not ask" — are reported
 * apart.
 */

import { run } from './git.mjs';

/**
 * The check name this scanner looks for when asking "was that commit validated?".
 *
 * It must equal the job's name in `main.yml`; `check:ci-plan` §L asserts that,
 * because a rename here would silently mean "nothing was ever validated" — which
 * fails closed, but for a reason nobody would guess.
 */
export const SECRET_SCAN_CHECK_NAME = 'secret-scan';

/**
 * The other check a baseline has to carry, and the reason is the scanner itself.
 *
 * "Its `secret-scan` passed" is not enough, found in review on 2026-08-26 (P1):
 * a commit could BREAK this scanner so that `secret-scan` passes wrongly, while
 * `callable-contract` — which runs `npm run test:secret-scan` — fails and blocks
 * that release. The broken commit would still look validated, and the next push,
 * with the scanner fixed, would anchor there and never look at the increment the
 * broken scanner waved through.
 *
 * `Verify the release is fully validated` is the answer already in the
 * repository: it refuses unless every `ALWAYS_REQUIRED_JOBS` entry concluded
 * success, and those are `secret-scan` and `callable-contract`. So a commit
 * carrying it was scanned by a scanner that passed its own tests. It is the same
 * check `functions/releaseManagement/eligibility.js` requires by name before a
 * production promotion, which is the company it belongs in.
 */
export const RELEASE_VALIDATION_CHECK_NAME = 'Verify the release is fully validated';

/** How far back to look for a validated ancestor before giving up. */
export const VALIDATED_ANCESTOR_WALK = 50;

/**
 * The newest ancestor of `headSha` that carries a fully validated release.
 *
 * "Validated" means one workflow run in which BOTH `secret-scan` and
 * `Verify the release is fully validated` concluded success — the second because
 * a scanner that passed while its own tests failed has validated nothing (see
 * RELEASE_VALIDATION_CHECK_NAME).
 *
 * It is asked of GitHub
 * because git cannot answer it: a commit's history says nothing about whether CI
 * ever passed on it. Walking first-parent is deliberate and conservative — for a
 * merge it lands on the previous branch tip rather than on the merged branch's
 * head, which makes the range wider, never narrower.
 *
 * `sha` is `null` when nothing qualifies, and the callers treat that as a refusal
 * rather than a licence to scan less. A lookup that could not run is also `null`,
 * for the same reason — an unanswerable question is not a "yes" — but it carries
 * `error`, so the refusal can say which of the two it was.
 *
 * What this inherits, stated plainly: trusting a commit because its own scan
 * passed means trusting the scanner that ran then. An ancestor scanned by the
 * old action's `--no-merges --first-parent` range could have passed while
 * missing a secret that arrived through a second parent. That secret is still
 * caught here if it is in the tree at `head`; if it was added and removed in
 * history, it belongs to `secret-history-audit`, which sweeps everything. The
 * alternative — trusting a commit merely because it EXISTS — is the P1 this
 * function replaced, and it is strictly worse.
 *
 * @returns {Promise<{sha: string|null, checked: number, error: string|null}>}
 */
export async function findLastValidatedAncestor({
    headSha, cwd, repository, token, fetchImpl = fetch, walk = VALIDATED_ANCESTOR_WALK,
}) {
    if (!repository || !token) {
        return { sha: null, checked: 0, error: 'no GITHUB_REPOSITORY/GITHUB_TOKEN to ask with' };
    }
    const listed = run('git', ['rev-list', '--first-parent', '--max-count', String(walk + 1), headSha], cwd);
    if (!listed.ok) {
        return { sha: null, checked: 0, error: `git rev-list failed: ${listed.stderr.trim()}` };
    }
    const ancestors = listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean).slice(1);

    let checked = 0;
    for (const candidate of ancestors) {
        checked += 1;
        let response;
        try {
            response = await fetchImpl(checkRunsUrl(repository, candidate), checkRunsHeaders(token));
        } catch (error) {
            // An unanswerable question is not a "yes". Reported rather than
            // swallowed, because "no validated ancestor" and "could not ask" fail
            // the same way and need very different fixes.
            return { sha: null, checked, error: `request failed: ${error?.message || error}` };
        }
        if (!response?.ok) {
            return { sha: null, checked, error: `GitHub answered ${response?.status}` };
        }
        let body;
        try {
            body = await response.json();
        } catch (error) {
            return { sha: null, checked, error: `unreadable response: ${error?.message || error}` };
        }
        if (carriesValidatedRelease(body)) {
            return { sha: candidate, checked, error: null };
        }
    }
    return { sha: null, checked, error: null };
}

/**
 * Does one commit carry a fully validated release?
 *
 * Both checks, and both from the SAME check suite — one workflow run. Taking
 * them from different runs would accept "some run scanned it" plus "some other
 * run validated it", which is not the same claim as "one run scanned it with a
 * scanner that had passed its own tests". Grouping by suite costs a Map and
 * removes the ambiguity.
 *
 * @param {{check_runs?: Array<object>}} body a check-runs API response
 */
export function carriesValidatedRelease(body) {
    const runs = Array.isArray(body?.check_runs) ? body.check_runs : [];
    const succeededBySuite = new Map();
    for (const entry of runs) {
        const suite = entry?.check_suite?.id;
        if (suite === undefined || suite === null) continue;
        if (entry?.status !== 'completed' || entry?.conclusion !== 'success') continue;
        if (!succeededBySuite.has(suite)) succeededBySuite.set(suite, new Set());
        succeededBySuite.get(suite).add(entry.name);
    }
    return [...succeededBySuite.values()].some(
        (names) => names.has(SECRET_SCAN_CHECK_NAME) && names.has(RELEASE_VALIDATION_CHECK_NAME),
    );
}

/**
 * The same question asked about ONE named commit, for `SECRET_SCAN_BASE`.
 *
 * An override has to clear the bar an inferred base clears, or it is a way to
 * choose an unverified baseline by hand — see `resolveScanPlan`. A lookup that
 * could not run answers `false` and says why, because an unanswerable question
 * is not a "yes".
 *
 * @returns {Promise<{validated: boolean, error: string|null}>}
 */
export async function isValidatedRelease({ sha, repository, token, fetchImpl = fetch }) {
    if (!repository || !token) {
        return { validated: false, error: 'no GITHUB_REPOSITORY/GITHUB_TOKEN to ask with' };
    }
    let response;
    try {
        response = await fetchImpl(checkRunsUrl(repository, sha), checkRunsHeaders(token));
    } catch (error) {
        return { validated: false, error: `request failed: ${error?.message || error}` };
    }
    if (!response?.ok) return { validated: false, error: `GitHub answered ${response?.status}` };
    let body;
    try {
        body = await response.json();
    } catch (error) {
        return { validated: false, error: `unreadable response: ${error?.message || error}` };
    }
    return { validated: carriesValidatedRelease(body), error: null };
}

const checkRunsUrl = (repository, sha) => `https://api.github.com/repos/${repository}`
    + `/commits/${sha}/check-runs?status=completed&per_page=100`;

const checkRunsHeaders = (token) => ({
    headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    },
});
