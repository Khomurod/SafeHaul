#!/usr/bin/env node
/**
 * The contract phase: delete the Cloud Functions that no release calls any
 * more, once — and only once — the Production frontend has stopped calling
 * them.
 *
 * Retiring a function from `functions/index.js` removes it from the deploy
 * plan and nothing else. The deploy scripts only ever run
 * `--only functions:<name>` for functions that still exist, so a retired one
 * stays exactly as deployed, publicly reachable, until something deletes it.
 * Production can still be serving a release that calls a retired function — a
 * landing page posting to `submitLandingLead`, a Super Admin screen calling the
 * rest of LD-R3 — and deleting it then breaks a live form for visitors.
 * Deleting it AFTER a promotion that no longer calls it is safe, which is why
 * `promote-production.yml` runs this right after the new release is verified
 * live and recorded.
 *
 * Each entry of `RETIREMENTS` names its functions and `since`, the commit that
 * removed their last caller from the frontend. What it does, in order:
 *   1. For each entry, proves the promoted release contains `since` (`git
 *      merge-base --is-ancestor`). Cannot prove → does not delete that entry,
 *      and says so. A rollback to an older release therefore never removes
 *      what that release calls.
 *   2. Probes each name of the entries it proved by URL. Cloud answers
 *      `404 Page not found` for a function that does not exist and anything else
 *      (400, 405, 403, 401) for one that does — the same read-only probe the
 *      runbook uses.
 *   3. Deletes only the ones that still answer, region-qualified, `--force
 *      --non-interactive`.
 *   4. Re-probes: each must now be 404, and each entry's `keep` (for LD-R3,
 *      `listLandingLeads`, the only path to the archive of captured leads) must
 *      still answer. Either failing exits 1.
 *   5. Touches no data: deleting a function deletes no documents.
 *
 * Usage: node scripts/retire-functions.mjs <promotedSha>
 * Env:   FIREBASE_PROJECT_ID (required when anything is to be deleted)
 *
 * The pure planning helpers are exported and tested by
 * `scripts/release-promotion-tests/retirement.mjs`; the CLI below is the only
 * part that touches git, the network or the Firebase CLI.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RETIREMENTS = Object.freeze([
    Object.freeze({
        // `LD-R3` — the merge that removed the marketing-site form (#56).
        id: 'LD-R3',
        since: 'f7c89d411b82649c449108f43c94ba05d3f6e3f9',
        names: Object.freeze([
            'submitLandingLead',
            'getLandingPageSettings',
            'updateLandingTelegramConfig',
            'setLandingTelegramEnabled',
            'sendLandingTelegramTest',
            'retryLandingLeadDelivery',
        ]),
        // Stays. Super Admin → Website Leads reads the archive through it.
        keep: 'listLandingLeads',
    }),
    Object.freeze({
        // The Deep Diagnostic's `ping` step, removed with the owner panel's
        // maintenance buttons.
        id: 'deep-diagnostic',
        since: '7aaca385a3a86a173805b2bbbb4eac1bc234ffcb',
        names: Object.freeze(['runMigration']),
    }),
    Object.freeze({
        // The unfinished-applications page calls `purgeApplicationDraft` instead.
        id: 'draft-delete',
        since: '2d76227b27c1bb65ec6b9b48a5ff8dea7a1cdbf6',
        names: Object.freeze(['deleteApplicationDraft']),
    }),
    Object.freeze({
        // The PEV email's open pixel. The app host answered its path with the
        // app page, so no email ever reached the function.
        id: 'pev-open-pixel',
        since: '9f266376438c613f57118048389f12de6f0a0f1e',
        names: Object.freeze(['trackVerificationOpen']),
    }),
    Object.freeze({
        // Smart Segments: triggers on every application write that kept
        // `segments` lists nothing reads. No release calls a trigger, so any
        // promotion carrying their removal may delete them.
        id: 'segments',
        since: '5c9427e4949e068013ddcf6b70be840220abbc08',
        names: Object.freeze(['onApplicationCreatedSegments', 'onApplicationUpdateSegments']),
    }),
    Object.freeze({
        // Pause, resume and cancel of a bulk session are direct Firestore writes;
        // the Mission Control report that called it went in `bf07bf6`.
        id: 'bulk-session-status',
        since: 'bf07bf6fdea4db0b5e12e47b207a309365ed80d3',
        names: Object.freeze(['updateBulkSessionStatus']),
    }),
    Object.freeze({
        // SMS reactivation batches; the Campaigns view that sent them went in `46989c1`.
        id: 'reactivation-batch',
        since: '46989c1863e5a572d06e73c7344229fa116f13e2',
        names: Object.freeze(['executeReactivationBatch']),
    }),
    Object.freeze({
        // "Sync Backend Structure" (deployed only as a refusal) and the security
        // audit only the Deep Diagnostic ran, both removed from the owner panel.
        id: 'system-integrity',
        since: '7aaca385a3a86a173805b2bbbb4eac1bc234ffcb',
        names: Object.freeze(['syncSystemStructure', 'runSecurityAudit']),
    }),
    Object.freeze({
        // The carrier's own prepared list; the unfinished-applications workspace
        // reads `listApplicationDrafts` alone.
        id: 'prepared-list',
        since: '0702dc91eda342a199cbb88109e05db7cc7fd689',
        names: Object.freeze(['listCompanyPreparedApplications']),
    }),
    Object.freeze({
        // A trigger on new driver documents that merged and deleted duplicates by
        // phone. No code writes the field it waits for, but a signed-in user's own
        // `drivers/{uid}` write could reach it. No release calls a trigger, so any
        // promotion carrying its removal may delete it.
        id: 'driver-profile-merge',
        since: 'a2f5b5bd98c87c9c40b3e721c09ef668c54bb27e',
        names: Object.freeze(['onDriverProfileCreated']),
    }),
]);

export const REGION = 'us-central1';

/**
 * Which of `names` still exist, from their probe statuses. Cloud returns 404
 * only for a name it does not know; a callable answers a bare GET with 400, an
 * `onRequest` with 405, a Firestore trigger with 403 (1st generation: 401), so
 * "not 404" is the honest test for "deployed".
 */
export function planRetirement(statuses, names) {
    const gone = [];
    const toDelete = [];
    for (const name of names) {
        const status = statuses[name];
        if (status === undefined || status === null) {
            throw new Error(`no probe result for ${name}; refusing to plan around a gap`);
        }
        (status === 404 ? gone : toDelete).push(name);
    }
    return { gone, toDelete };
}

/**
 * After deletion: every retired name must be 404 and every keeper must not be.
 * Returns the problems, so the caller decides how to report them.
 */
export function verifyRetirement(statuses, names, keep = []) {
    const problems = [];
    for (const name of names) {
        if (statuses[name] !== 404) problems.push(`${name} still answers (${statuses[name]})`);
    }
    for (const name of keep) {
        if (statuses[name] === 404) problems.push(`${name} is gone — it was meant to stay`);
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
        console.error('Usage: retire-functions.mjs <promotedSha>');
        return 1;
    }
    if (!projectId) {
        console.error('FIREBASE_PROJECT_ID is not set; refusing to guess which project to delete from.');
        return 1;
    }

    const due = RETIREMENTS.filter(({ id, since }) => {
        const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', since, promotedSha], { encoding: 'utf8' });
        const carries = releaseCarriesRetirement(ancestry.status);
        if (carries === null) {
            console.log(`${id}: cannot prove ${promotedSha} carries ${since} (${(ancestry.stderr || '').trim() || `git exit ${ancestry.status}`}); nothing deleted.`);
        } else if (!carries) {
            console.log(`${id}: ${promotedSha} predates ${since}; the release still calls these functions. Nothing deleted.`);
        }
        return carries === true;
    });
    if (due.length === 0) return 0;

    const names = due.flatMap((retirement) => retirement.names);
    const keep = due.map((retirement) => retirement.keep).filter(Boolean);

    const { gone, toDelete } = planRetirement(await probe(projectId, names), names);
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

    const problems = verifyRetirement(await probe(projectId, [...names, ...keep]), names, keep);
    if (problems.length) {
        console.error(`Verification failed:\n  - ${problems.join('\n  - ')}`);
        return 1;
    }
    console.log(`Verified: ${names.length} retired function(s) return 404${keep.length ? `; ${keep.join(', ')} still answer(s)` : ''}.`);
    return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().then((code) => process.exit(code), (error) => {
        console.error(error.message);
        process.exit(1);
    });
}
