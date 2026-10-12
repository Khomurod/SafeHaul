#!/usr/bin/env node
/**
 * Decides, for one CI run, which expensive test lanes actually have to execute.
 *
 * Two independent reasons let a lane be skipped, and both are proven rather than
 * assumed:
 *
 *   1. IRRELEVANCE. Nothing in the change set can affect that lane. A change
 *      confined to `functions/` cannot alter what a browser renders; a change
 *      confined to `docs/` cannot alter anything that runs.
 *
 *   2. PROVENANCE. The lane already passed against *this exact source tree*,
 *      during the pull request that produced it. The proof is a git tree hash: a
 *      content id covering every byte of every tracked file. Two commits sharing
 *      a tree hash have identical working trees, so a content-determined test
 *      cannot distinguish them.
 *
 * Provenance is why a merge to `main` does not repeat the pull request's whole
 * suite. GitHub validates a pull request against `refs/pull/N/merge` — the test
 * merge of the branch into its base — and when that merge lands unchanged, the
 * commit on `main` carries the identical tree. Verified against the three merges
 * preceding this change: the test-merge tree and the merged tree matched exactly
 * in all three.
 *
 * Everything here fails towards MORE work, never less:
 *
 *   - a path this file does not recognise is treated as cross-cutting, so an
 *     unclassified file runs the full suite rather than none of it;
 *   - an unreadable diff (force push, unknown event, shallow clone, orphan
 *     commit) runs the full suite;
 *   - an attestation that cannot be read, or came from anywhere other than a
 *     successful run of this repository's own workflow, does not count;
 *   - a pull request validates its own code. The one proof it accepts is its
 *     own previous push's, for a lane none of the files changed since can
 *     affect: a follow-up that only edits documentation does not run the suite
 *     again. Anything it cannot rebuild exactly carries nothing over.
 *
 * The result is advisory scheduling only. `scripts/verify-release-validation.mjs`
 * independently re-checks that every lane was either executed or provably
 * covered, and that job is what the production promotion gate requires.
 *
 * Usage:
 *   node scripts/ci-plan.mjs            # writes key=value pairs to $GITHUB_OUTPUT
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    LANE_NAMES,
    selectLanes,
    carriedOverLanes,
    readAttestations,
} from './ci-plan-rules.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const ZERO_SHA = '0'.repeat(40);

/**
 * The two commits whose difference is "the change being introduced".
 *
 * Returns `null` for base when it cannot be established, which forces the full
 * suite rather than guessing.
 */
export function diffRange({ eventName, event = {}, log = () => {} }) {
    if (eventName === 'pull_request') {
        const base = event.pull_request?.base?.sha;
        if (!base) {
            log('no base sha on the pull request payload');
            return null;
        }
        return { base, threeDot: true };
    }
    if (eventName === 'push') {
        const before = event.before;
        if (!before || before === ZERO_SHA) {
            log('this push has no usable "before" commit');
            return null;
        }
        return { base: before, threeDot: false };
    }
    log(`event "${eventName}" carries no change set`);
    return null;
}

/**
 * The tree this pull request's previous push was tested on.
 *
 * GitHub tests `refs/pull/N/merge`, the merge of the head into the base, and
 * `git merge-tree --write-tree <base> <before>` rebuilds that tree exactly
 * (on the merge of 3c5e80d into b686b89 both give 901bc1d). When the base has
 * moved since, the rebuilt tree is one no run tested, so no attestation matches
 * and nothing carries over. `null` means there is no previous push, or no clean
 * merge.
 */
export function previousPushTree({ event, log = () => {}, run = git }) {
    if (event?.action !== 'synchronize') return null;
    const before = event.before;
    const base = event.pull_request?.base?.sha;
    if (!before || before === ZERO_SHA || !base) {
        log('no previous push to carry results over from');
        return null;
    }
    try {
        const tree = run('merge-tree', '--write-tree', base, before).split('\n')[0];
        return /^[0-9a-f]{40}$/.test(tree) ? tree : null;
    } catch (error) {
        log(`could not rebuild the previous push's tree: ${String(error.message).split('\n')[0]}`);
        return null;
    }
}

function changedBetweenTrees(fromTree, toTree, log, run) {
    if (fromTree === toTree) return [];
    try {
        return run('diff', '--name-only', fromTree, toTree).split('\n').filter(Boolean);
    } catch (error) {
        log(`could not diff the previous push's tree: ${error.message}`);
        return null;
    }
}

/**
 * The lanes this pull request may skip because its previous push proved them:
 * selected here, untouched by every file changed since, and attested on the
 * previous push's tree by a successful run of this repository's workflow.
 */
export async function carryOverFromPreviousPush({
    event, selection, treeSha, api, repositoryId, log = () => {}, run = git,
}) {
    const previousTree = previousPushTree({ event, log, run });
    if (!previousTree) return { previousTree: null, carried: [] };
    const candidates = carriedOverLanes({
        selection,
        changedSince: changedBetweenTrees(previousTree, treeSha, log, run),
    });
    if (candidates.length === 0) return { previousTree, carried: [] };
    const proof = await readAttestations({ treeSha: previousTree, lanes: candidates, api, repositoryId, log });
    return { previousTree, carried: candidates.filter((lane) => proof[lane]) };
}

function changedFilesFor(range, log) {
    if (!range) return null;
    try {
        const spec = range.threeDot ? `${range.base}...HEAD` : `${range.base}..HEAD`;
        return git('diff', '--name-only', spec).split('\n').filter(Boolean);
    } catch (error) {
        log(`could not diff ${range.base}: ${error.message}`);
        return null;
    }
}

const createGithubApi = ({ token, repository }) => async (path) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (!response.ok) {
        throw new Error(`GET ${path} -> ${response.status}`);
    }
    return response.json();
};

async function main() {
    const {
        GITHUB_EVENT_NAME: eventName = '',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
        GITHUB_TOKEN: token,
        GITHUB_REPOSITORY: repository,
        GITHUB_REPOSITORY_ID: repositoryId,
    } = process.env;

    const notes = [];
    const log = (message) => {
        notes.push(message);
        console.log(`  ${message}`);
    };

    let event = {};
    if (eventPath) {
        try {
            const { readFileSync } = await import('node:fs');
            event = JSON.parse(readFileSync(eventPath, 'utf8'));
        } catch (error) {
            log(`could not read the event payload: ${error.message}`);
        }
    }

    const treeSha = git('rev-parse', 'HEAD^{tree}');
    console.log(`Source tree: ${treeSha}`);

    const selection = selectLanes({
        changedFiles: changedFilesFor(diffRange({ eventName, event, log }), log),
    });
    console.log(`Selection: ${selection.reason}`);

    // Provenance for this exact tree is a post-merge optimisation. A pull
    // request validates its own code, and accepts only its previous push's
    // proof, for lanes nothing since can affect.
    const isPullRequest = eventName === 'pull_request';
    let attested = Object.fromEntries(LANE_NAMES.map((lane) => [lane, false]));
    const carried = new Set();
    const credentials = Boolean(token && repository && repositoryId);
    const api = credentials ? createGithubApi({ token, repository }) : null;

    if (!isPullRequest && credentials) {
        attested = await readAttestations({
            treeSha,
            lanes: LANE_NAMES.filter((lane) => selection.lanes[lane]),
            api,
            repositoryId,
            log,
        });
    } else if (!isPullRequest) {
        log('no credentials to read attestations, so every selected lane runs');
    }

    let previousTree = null;
    if (isPullRequest && credentials) {
        const carryOver = await carryOverFromPreviousPush({ event, selection, treeSha, api, repositoryId, log });
        previousTree = carryOver.previousTree;
        for (const lane of carryOver.carried) {
            attested[lane] = true;
            carried.add(lane);
        }
    }

    // The lane decisions leave here as ONE json output, not as two-per-lane.
    //
    // Reassembling them in `main.yml` from a dozen separate outputs would fail
    // OPEN: a single missing output becomes `"selected": false`, the lane reads as
    // "not relevant to this change", and the gate accepts it with no proof it ever
    // passed. As one value it is either present and complete, or absent — and the
    // gate refuses a lane plan it cannot parse.
    const lanePlan = {};
    const rows = [];
    for (const lane of LANE_NAMES) {
        const selected = Boolean(selection.lanes[lane]);
        const proven = selected && Boolean(attested[lane]);
        lanePlan[lane] = { selected, attested: proven };
        rows.push(`| \`${lane}\` | ${selected && !proven ? '**runs**' : 'skipped'} | ${
            selected && !proven ? 'relevant, not yet validated'
                : proven && carried.has(lane) ? `passed on the previous push's tree \`${previousTree}\`; nothing since affects it`
                    : proven ? 'already validated on this exact source tree'
                        : 'not affected by this change'
        } |`);
    }

    const outputs = {
        tree_sha: treeSha,
        full_suite: String(selection.full),
        selection_reason: selection.reason,
        lane_plan: JSON.stringify(lanePlan),
    };
    // The `if:` conditions in `main.yml` cannot parse json, so each lane also gets
    // a plain boolean for scheduling. These are advisory: if one goes missing the
    // lane simply does not run, and `lane_plan` still says it was required, so the
    // gate refuses. Scheduling can fail; the verdict cannot.
    for (const lane of LANE_NAMES) {
        outputs[`run_${lane}`] = String(lanePlan[lane].selected && !lanePlan[lane].attested);
    }

    if (outputFile) {
        // Newlines would split one value across two output lines and corrupt every
        // key after it. Nothing here should contain one, which is exactly why it is
        // worth enforcing rather than assuming.
        const flatten = (value) => String(value).replace(/[\r\n]+/g, ' ');
        appendFileSync(
            outputFile,
            `${Object.entries(outputs).map(([k, v]) => `${k}=${flatten(v)}`).join('\n')}\n`,
            'utf8',
        );
    }

    if (summaryFile) {
        appendFileSync(summaryFile, [
            '### CI plan',
            '',
            `Source tree \`${treeSha}\` — ${selection.reason}.`,
            '',
            '| Lane | This run | Why |',
            '| --- | --- | --- |',
            ...rows,
            '',
            ...(notes.length ? ['<details><summary>Planner notes</summary>', '', ...notes.map((n) => `- ${n}`), '', '</details>', ''] : []),
        ].join('\n'), 'utf8');
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        // A planner crash must not silently green-light skipping. Exiting
        // non-zero fails the plan job, and the gate refuses any run whose plan
        // job did not succeed.
        console.error(error);
        process.exit(1);
    });
}

// The pure planning surface lives in `ci-plan-rules.mjs`; re-exported here so
// every existing importer keeps its import path.
export {
    LANES,
    LANE_NAMES,
    ALWAYS_REQUIRED_JOBS,
    lanesForPath,
    selectLanes,
    carriedOverLanes,
    attestationName,
    isUsableAttestation,
    readAttestations,
} from './ci-plan-rules.mjs';
