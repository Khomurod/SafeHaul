#!/usr/bin/env node
/**
 * The contract phase for the marketing-site lead form: delete the six Cloud
 * Functions that only it called, once — and only once — the Production frontend
 * has stopped calling them.
 *
 * Retiring a function from `functions/index.js` removes it from the deploy
 * plan and nothing else. The deploy scripts only ever run
 * `--only functions:<name>` for functions that still exist, so a retired one
 * stays exactly as deployed, publicly reachable, until something deletes it.
 * Six were retired with the form on 2026-08-29 (LD-R3) and were still
 * answering on 2026-09-06, because Production was serving a release from
 * 2026-08-10 whose landing page posted to `submitLandingLead` and whose Super
 * Admin screen called the other five. Deleting them earlier would have broken a
 * live form for visitors. Deleting them AFTER a promotion that carries LD-R3 is
 * safe, which is why `promote-production.yml` runs this right after the new
 * release is verified live and recorded.
 *
 * What it does, in order:
 *   1. Proves the promoted release contains LD-R3 (`git merge-base
 *      --is-ancestor`). Cannot prove → does not delete, and says so. A rollback
 *      to a pre-LD-R3 release therefore never removes what that release calls.
 *   2. Probes each of the six by URL. Cloud answers `404 Page not found` for a
 *      function that does not exist and anything else (400, 405, 403) for one
 *      that does — the same read-only probe the runbook uses.
 *   3. Deletes only the ones that still answer, region-qualified, `--force
 *      --non-interactive`.
 *   4. Re-probes: each of the six must now be 404, and `listLandingLeads` — the
 *      only path to the archive of captured leads, deliberately kept — must
 *      still answer. Either failing exits 1.
 *   5. Touches no data: `landing_leads` and `platform_settings/landing_page` are
 *      preserved by owner ruling, and deleting a function deletes no documents.
 *
 * Usage: node scripts/retire-landing-functions.mjs <promotedSha>
 * Env:   FIREBASE_PROJECT_ID (required when anything is to be deleted)
 *
 * The pure planning helpers are exported and tested by
 * `scripts/release-promotion-tests/retirement.mjs`; the CLI below is the only
 * part that touches git, the network or the Firebase CLI.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The six callables the removed marketing site used, and nothing else. */
export const RETIRED_LANDING_FUNCTIONS = Object.freeze([
    'submitLandingLead',
    'getLandingPageSettings',
    'updateLandingTelegramConfig',
    'setLandingTelegramEnabled',
    'sendLandingTelegramTest',
    'retryLandingLeadDelivery',
]);

/** Stays. Super Admin → Website Leads reads the archive through it. */
export const KEPT_LANDING_FUNCTION = 'listLandingLeads';

/** `LD-R3` — the merge that removed the form and retired the six (#56). */
export const LD_R3_SHA = 'f7c89d4';

export const REGION = 'us-central1';

/**
 * Which of the six still exist, from their probe statuses. Cloud returns 404
 * only for a name it does not know; a callable answers a bare GET with 400 and
 * an `onRequest` with 405, so "not 404" is the honest test for "deployed".
 */
export function planRetirement(statuses) {
    const gone = [];
    const toDelete = [];
    for (const name of RETIRED_LANDING_FUNCTIONS) {
        const status = statuses[name];
        if (status === undefined || status === null) {
            throw new Error(`no probe result for ${name}; refusing to plan around a gap`);
        }
        (status === 404 ? gone : toDelete).push(name);
    }
    return { gone, toDelete };
}

/**
 * After deletion: every retired name must be 404 and the keeper must not be.
 * Returns the problems, so the caller decides how to report them.
 */
export function verifyRetirement(statuses) {
    const problems = [];
    for (const name of RETIRED_LANDING_FUNCTIONS) {
        if (statuses[name] !== 404) problems.push(`${name} still answers (${statuses[name]})`);
    }
    if (statuses[KEPT_LANDING_FUNCTION] === 404) {
        problems.push(`${KEPT_LANDING_FUNCTION} is gone — it was meant to stay`);
    }
    return problems;
}

/**
 * The precondition, from git's answer. `null` means git could not answer
 * (shallow clone, unknown sha): that is "cannot prove", which is "do not delete".
 */
export function releaseCarriesRetirement(isAncestorExitCode) {
    if (isAncestorExitCode === 0) return true;
    if (isAncestorExitCode === 1) return false;
    return null;
}

function functionUrl(projectId, name) {
    return `https://${REGION}-${projectId}.cloudfunctions.net/${name}`;
}

async function probe(projectId, names) {
    const statuses = {};
    for (const name of names) {
        try {
            const response = await fetch(functionUrl(projectId, name), { method: 'GET', redirect: 'manual' });
            statuses[name] = response.status;
        } catch (error) {
            throw new Error(`probe of ${name} failed: ${error.message}`);
        }
    }
    return statuses;
}

async function main() {
    const [, , promotedSha] = process.argv;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!promotedSha) {
        console.error('Usage: retire-landing-functions.mjs <promotedSha>');
        return 1;
    }
    if (!projectId) {
        console.error('FIREBASE_PROJECT_ID is not set; refusing to guess which project to delete from.');
        return 1;
    }

    const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', LD_R3_SHA, promotedSha], { encoding: 'utf8' });
    const carries = releaseCarriesRetirement(ancestry.status);
    if (carries === null) {
        console.log(`Cannot prove ${promotedSha} carries LD-R3 (${(ancestry.stderr || '').trim() || `git exit ${ancestry.status}`}); nothing deleted.`);
        return 0;
    }
    if (!carries) {
        console.log(`${promotedSha} predates LD-R3 (${LD_R3_SHA}); the release still uses the landing callables. Nothing deleted.`);
        return 0;
    }

    const before = await probe(projectId, RETIRED_LANDING_FUNCTIONS);
    const { gone, toDelete } = planRetirement(before);
    if (gone.length) console.log(`Already gone: ${gone.join(', ')}`);

    if (toDelete.length) {
        console.log(`Deleting ${toDelete.length}: ${toDelete.join(', ')}`);
        const result = spawnSync('npx', [
            'firebase', 'functions:delete', ...toDelete,
            '--region', REGION, '--project', projectId, '--force', '--non-interactive',
        ], { stdio: 'inherit' });
        if (result.status !== 0) {
            console.error(`firebase functions:delete exited ${result.status}; the release is live and recorded, the contract phase is not finished.`);
            return 1;
        }
    } else {
        console.log('Nothing to delete.');
    }

    const after = await probe(projectId, [...RETIRED_LANDING_FUNCTIONS, KEPT_LANDING_FUNCTION]);
    const problems = verifyRetirement(after);
    if (problems.length) {
        console.error(`Verification failed:\n  - ${problems.join('\n  - ')}`);
        return 1;
    }
    console.log(`Verified: all six retired callables return 404; ${KEPT_LANDING_FUNCTION} still answers (${after[KEPT_LANDING_FUNCTION]}).`);
    return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().then((code) => process.exit(code), (error) => {
        console.error(error.message);
        process.exit(1);
    });
}
