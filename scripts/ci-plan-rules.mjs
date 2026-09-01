/**
 * The CI planner's lane rules and attestation logic, extracted verbatim from
 * `ci-plan.mjs` — see that file's header for the model. Everything here is
 * the pure half: the frozen lane/job tables, path→lane classification, lane
 * selection, and attestation naming/validation/reading. The event glue (git
 * diff ranges, the GitHub API client, `main()` and the GITHUB_OUTPUT wiring)
 * stays in the entry, which re-exports this surface so every existing
 * importer (`test-source-size-ci.mjs`, `verify-release-validation.mjs`, the
 * `ci-plan/` test modules) keeps its import path.
 */

/**
 * The independently-skippable units of validation, and the workflow job ids that
 * implement each one.
 *
 * This object is the single source of truth shared by the planner, the
 * fail-closed gate and the attestation steps in `main.yml`.
 * `scripts/test-ci-plan.mjs` asserts that every job id named here exists in the
 * workflow and that every lane has an attestation step, so a lane cannot be
 * added on one side only.
 *
 * Deliberately NOT lanes:
 *   - `secret-scan`, because it scans commit history rather than the tree, and
 *     two commits with the same tree can have entirely different history;
 *   - `callable-contract`, which runs the release-system self-tests and costs
 *     ~17s, so skipping it would buy nothing;
 *   - `typecheck`, the one remaining non-blocking baseline. It is a ratchet over
 *     pre-existing `checkJs` findings in modules outside the design system, not a
 *     gate someone switched off.
 *
 * `e2e-a11y` used to be listed here too. It is gone: its axe specs run inside the
 * blocking `frontend_e2e` lane as of 2026-08-25, so they are attested with it and
 * need no lane of their own. The job's own comment had said to fold them in "once
 * confirmed green in CI" — they were green on every run for weeks.
 */
export const LANES = Object.freeze({
    frontend_build: Object.freeze({ jobs: Object.freeze(['frontend-build']) }),
    frontend_unit: Object.freeze({ jobs: Object.freeze(['frontend-quality']) }),
    frontend_e2e: Object.freeze({ jobs: Object.freeze(['frontend-e2e']) }),
    storybook: Object.freeze({ jobs: Object.freeze(['storybook-build']) }),
    functions: Object.freeze({ jobs: Object.freeze(['test-functions']) }),
    rules: Object.freeze({ jobs: Object.freeze(['rules-emulator']) }),
});

export const LANE_NAMES = Object.freeze(Object.keys(LANES));

/** Jobs that run on every event and are never skippable. */
export const ALWAYS_REQUIRED_JOBS = Object.freeze(['secret-scan', 'callable-contract']);

const ALL_LANES = () => Object.fromEntries(LANE_NAMES.map((lane) => [lane, true]));
const NO_LANES = () => Object.fromEntries(LANE_NAMES.map((lane) => [lane, false]));

const FRONTEND_LANES = ['frontend_build', 'frontend_unit', 'frontend_e2e', 'storybook'];

/**
 * Exact paths whose contents can change the behaviour of anything in the repo.
 * A dependency bump, a build-target change or a lint-rule change is not
 * localisable, so these force the full suite.
 */
const CROSS_CUTTING_FILES = Object.freeze([
    'package.json',
    'package-lock.json',
    'functions/package.json',
    'functions/package-lock.json',
    'vite.config.js',
    'vitest.config.js',
    'playwright.config.cjs',
    'jsconfig.json',
    'eslint.config.js',
    '.eslintrc.json',
    'postcss.config.js',
    'tailwind.config.js',
    'index.html',
    'firebase.json',
    '.firebaserc',
    'firestore.indexes.json',
    'cors.json',
]);

/**
 * Directory prefixes that force the full suite.
 *
 * `.github/` and `scripts/` are here because they contain the release machinery
 * itself — including this planner and the gate that checks it. A change to CI
 * must be validated by the complete suite, or the optimisation could hide its
 * own regression.
 *
 * `src/features/applications/` is here because it holds the shared application
 * and PDF architecture (`services/applicationPdfService.js`), which the Cloud
 * Functions side mirrors. Changes there default conservatively.
 */
const CROSS_CUTTING_PREFIXES = Object.freeze([
    '.github/',
    'scripts/',
    'src/features/applications/',
    'public/',
]);

/** Paths that ship nothing executable. */
const DOC_PREFIXES = Object.freeze(['docs/', '.claude/']);
const DOC_FILES = Object.freeze(['LICENSE', '.gitignore', '.gitattributes']);

/**
 * Which lanes one changed path makes relevant.
 *
 * Returns `null` to mean "cross-cutting — run everything". Returns an empty
 * array to mean "affects no lane". Anything this function does not recognise is
 * cross-cutting, so adding a new top-level directory errs towards a full run
 * until someone classifies it here.
 *
 * @param {string} path repository-relative path, forward slashes
 * @returns {string[]|null}
 */
export function lanesForPath(path) {
    if (typeof path !== 'string' || path.length === 0) return null;

    // Anything named for PDF handling is shared application architecture.
    if (/pdf/i.test(path)) return null;

    if (CROSS_CUTTING_FILES.includes(path)) return null;
    if (CROSS_CUTTING_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;

    if (DOC_FILES.includes(path)) return [];
    if (DOC_PREFIXES.some((prefix) => path.startsWith(prefix))) return [];
    if (path.endsWith('.md')) return [];

    // Cloud Functions source. Their package files are cross-cutting and were
    // already matched above.
    if (path.startsWith('functions/')) return ['functions'];

    // End-to-end specs and their helpers only change what the browser lane runs.
    if (path.startsWith('e2e/')) return ['frontend_e2e'];

    // The public site has no build step, but it IS tested:
    // `src/tests/hostingConfig.test.js` reads `web/robots.txt` and
    // `web/privacy.html` and holds the deployed Hosting config to a contract, in
    // the `frontend_unit` lane.
    //
    // This used to return `[]` for the marketing site that lived here, on the
    // reasoning that static content is deployed rather than tested. It cost a
    // broken homepage: a static-only commit selected no lanes, CI went green, and
    // `main` shipped a page claiming MVR checks the product does not run. That
    // site is gone and `web/` replaced it — the directory changed, the lesson
    // did not, so the mapping moved with it.
    if (path.startsWith('web/')) return ['frontend_unit'];

    if (path.startsWith('src/')) {
        // Feature code is frontend-only. Everything else under `src/` — the app
        // shell, shared components, hooks, services, the design system, the
        // test setup, and `src/firestore.rules` / `src/storage.rules` — is
        // shared or security-relevant, so it is cross-cutting.
        if (path.startsWith('src/features/')) return FRONTEND_LANES;
        return null;
    }

    return null;
}

/**
 * Chooses the lanes for a change set.
 *
 * @param {object} options
 * @param {string[]|null|undefined} options.changedFiles null/undefined when the
 *   diff could not be determined, which forces the full suite.
 * @returns {{lanes: Record<string, boolean>, full: boolean, reason: string}}
 */
export function selectLanes({ changedFiles }) {
    if (!Array.isArray(changedFiles)) {
        return {
            lanes: ALL_LANES(),
            full: true,
            reason: 'the change set could not be determined, so the full suite runs',
        };
    }

    const files = changedFiles.filter((file) => typeof file === 'string' && file.length > 0);

    if (files.length === 0) {
        return {
            lanes: ALL_LANES(),
            full: true,
            reason: 'no changed files were reported, so the full suite runs',
        };
    }

    const lanes = NO_LANES();
    for (const file of files) {
        const relevant = lanesForPath(file);
        if (relevant === null) {
            return {
                lanes: ALL_LANES(),
                full: true,
                reason: `${file} is cross-cutting, so the full suite runs`,
            };
        }
        for (const lane of relevant) lanes[lane] = true;
    }

    const selected = LANE_NAMES.filter((lane) => lanes[lane]);
    return {
        lanes,
        full: false,
        reason: selected.length === 0
            ? 'no changed file affects anything this pipeline tests'
            : `changes affect: ${selected.join(', ')}`,
    };
}

/** Artifact name that attests one lane against one source tree. */
export function attestationName(treeSha, lane) {
    return `validated-${treeSha}-${lane}`;
}

/* -------------------------------------------------------------------------- */
/* Provenance                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Is this artifact a usable attestation?
 *
 * An attestation is only worth anything if this repository's own workflow
 * created it, in a run that finished successfully. In particular
 * `head_repository_id` must match: a pull request from a fork runs with a
 * read-only token and cannot upload artifacts at all, but checking it means the
 * gate does not depend on that remaining true.
 *
 * @param {object} artifact repo-level artifact record
 * @param {object} run its workflow run
 * @param {object} context
 * @param {string} context.name the exact artifact name being looked for
 * @param {number} context.repositoryId this repository's numeric id
 * @returns {{ok: true}|{ok: false, why: string}}
 */
export function isUsableAttestation(artifact, run, { name, repositoryId }) {
    if (!artifact || artifact.name !== name) return { ok: false, why: 'name mismatch' };
    if (artifact.expired) return { ok: false, why: 'artifact expired' };

    const owner = artifact.workflow_run || {};
    if (Number(owner.repository_id) !== Number(repositoryId)) {
        return { ok: false, why: 'created for a different repository' };
    }
    if (Number(owner.head_repository_id) !== Number(repositoryId)) {
        return { ok: false, why: 'created from a fork' };
    }

    if (!run) return { ok: false, why: 'its workflow run could not be read' };
    if (run.status !== 'completed') return { ok: false, why: `run is ${run.status}` };
    if (run.conclusion !== 'success') return { ok: false, why: `run concluded ${run.conclusion}` };
    if (run.event !== 'pull_request') return { ok: false, why: `run event was ${run.event}` };

    return { ok: true };
}

/**
 * Looks up which lanes are already attested for a tree.
 *
 * Every failure path here returns "not attested", which makes the lane run.
 *
 * @param {object} options
 * @param {string} options.treeSha
 * @param {string[]} options.lanes lanes worth asking about
 * @param {(path: string) => Promise<any>} options.api GitHub REST GET
 * @param {number} options.repositoryId
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<Record<string, boolean>>}
 */
export async function readAttestations({ treeSha, lanes, api, repositoryId, log = () => {} }) {
    const attested = Object.fromEntries(LANE_NAMES.map((lane) => [lane, false]));

    for (const lane of lanes) {
        const name = attestationName(treeSha, lane);
        try {
            const listed = await api(
                `/actions/artifacts?per_page=100&name=${encodeURIComponent(name)}`,
            );
            // The `name` filter is applied again locally: if a future API drops
            // support for it and returns everything, this must not widen.
            const candidates = (listed?.artifacts || []).filter((a) => a?.name === name);

            let accepted = false;
            for (const artifact of candidates) {
                let run = null;
                try {
                    run = await api(`/actions/runs/${artifact.workflow_run?.id}`);
                } catch (error) {
                    log(`${lane}: could not read run for its attestation — ${error.message}`);
                }
                const verdict = isUsableAttestation(artifact, run, { name, repositoryId });
                if (verdict.ok) {
                    accepted = true;
                    log(`${lane}: validated on this tree by run ${artifact.workflow_run?.id}`);
                    break;
                }
                log(`${lane}: rejected an attestation — ${verdict.why}`);
            }
            attested[lane] = accepted;
        } catch (error) {
            log(`${lane}: attestation lookup failed, will re-run — ${error.message}`);
            attested[lane] = false;
        }
    }

    return attested;
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */
