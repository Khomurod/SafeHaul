/**
 * Scenarios 19–22 — the contract phase that deletes retired Cloud Functions
 * after a production promotion (`scripts/retire-functions.mjs`).
 *
 * These are its failure modes, which matter more than the happy path: deleting
 * on a release that still needs the functions, deleting one that must stay or
 * one the source still exports, planning around a probe that never answered,
 * or the workflow quietly losing the step. Each is asserted against the pure
 * helpers, the source and the workflow text.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
    RETIREMENTS,
    planRetirement,
    verifyRetirement,
    releaseCarriesRetirement,
} from '../retire-functions.mjs';
import { assert } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const landing = RETIREMENTS.find((retirement) => retirement.id === 'LD-R3');
const LANDING = landing.names;
const KEEPER = landing.keep;
const all404 = Object.fromEntries(LANDING.map((name) => [name, 404]));

export async function runRetirementScenarios() {
// 19 — the plan deletes exactly what still answers, and nothing that is gone.
{
    const statuses = { ...all404, submitLandingLead: 405, getLandingPageSettings: 400 };
    const plan = planRetirement(statuses, LANDING);
    assert('19. only the callables that still answer are planned for deletion',
        plan.toDelete.length === 2
            && plan.toDelete.includes('submitLandingLead')
            && plan.toDelete.includes('getLandingPageSettings'),
        `toDelete: ${plan.toDelete.join(', ')}`);
    assert('19b. the ones already gone are reported as gone, not deleted again',
        plan.gone.length === 4 && !plan.gone.includes('submitLandingLead'),
        `gone: ${plan.gone.join(', ')}`);

    let refused = false;
    try {
        planRetirement({ ...all404, retryLandingLeadDelivery: undefined }, LANDING);
    } catch {
        refused = true;
    }
    assert('19c. a probe with no answer is refused rather than treated as gone',
        refused, 'an unanswered probe was silently planned around');

    const retired = RETIREMENTS.flatMap((retirement) => retirement.names);
    const kept = RETIREMENTS.map((retirement) => retirement.keep).filter(Boolean);
    assert('19d. no kept function is in any retirement set, and LD-R3 retires its six',
        kept.every((name) => !retired.includes(name)) && LANDING.length === 6 && KEEPER === 'listLandingLeads',
        `retired: ${retired.join(', ')}; kept: ${kept.join(', ')}`);

    assert('19e. each retirement is gated on a full commit, and names each function once',
        RETIREMENTS.every((retirement) => /^[0-9a-f]{40}$/.test(retirement.since) && retirement.names.length > 0)
            && new Set(retired).size === retired.length,
        'a short sha can become ambiguous, which makes every ancestry check "cannot prove"');

    // A name the source still exports is a live function: deleting it after a
    // promotion would take down something the release calls. Read the way the
    // deploy reads it (`deploy-functions-resolve.mjs`): each export is a line
    // inside `index.js`'s loader, not at the start of one.
    const index = readFileSync(resolvePath(here, '../../functions/index.js'), 'utf8');
    const exported = new Set([...index.matchAll(/exports\.([A-Za-z0-9_]+)\s*=/g)].map((match) => match[1]));
    const stillLive = [...retired, ...kept].filter((name) => exported.has(name) !== kept.includes(name));
    assert('19f. no retired function is still exported, and every kept one is',
        exported.size > 100 && stillLive.length === 0,
        `exports read: ${exported.size}; wrong: ${stillLive.join(', ')}`);
}

// 20 — verification demands every retired name gone AND every keeper present.
{
    assert('20. a clean result verifies',
        verifyRetirement({ ...all404, [KEEPER]: 400 }, LANDING, [KEEPER]).length === 0,
        'a fully retired set with the keeper answering was reported as a problem');

    const survivor = verifyRetirement({ ...all404, sendLandingTelegramTest: 400, [KEEPER]: 400 }, LANDING, [KEEPER]);
    assert('20b. a retired callable that still answers is a problem',
        survivor.length === 1 && /sendLandingTelegramTest/.test(survivor[0]),
        survivor.join('; '));

    const lostKeeper = verifyRetirement({ ...all404, [KEEPER]: 404 }, LANDING, [KEEPER]);
    assert('20c. losing listLandingLeads is a problem — it was meant to stay',
        lostKeeper.length === 1 && /listLandingLeads/.test(lostKeeper[0]),
        lostKeeper.join('; '));
}

// 21 — the precondition: cannot prove means do not delete.
{
    assert('21. git exit 0 means the release carries the retirement', releaseCarriesRetirement(0) === true);
    assert('21b. git exit 1 means it predates the retirement — nothing is deleted', releaseCarriesRetirement(1) === false);
    assert('21c. any other git exit (shallow clone, unknown sha) is "cannot prove", not "yes"',
        releaseCarriesRetirement(128) === null && releaseCarriesRetirement(null) === null,
        'an inconclusive ancestry check was read as permission to delete');
}

// 22 — the workflow actually runs it, in the right place, and nothing else deletes functions.
{
    const promote = readFileSync(resolvePath(here, '../../.github/workflows/promote-production.yml'), 'utf8');
    const main = readFileSync(resolvePath(here, '../../.github/workflows/main.yml'), 'utf8');

    const stepAt = promote.indexOf('node "$RUNNER_TEMP/retire-functions.mjs" "$CANDIDATE_SHA"');
    const recordAt = promote.indexOf('run: node scripts/record-release.mjs');
    const verifyAt = promote.indexOf('run: node scripts/verify-live-release.mjs');
    assert('22. the promotion workflow runs the retirement after the release is verified and recorded',
        stepAt !== -1 && verifyAt !== -1 && recordAt !== -1 && stepAt > recordAt && recordAt > verifyAt,
        `verify@${verifyAt} record@${recordAt} retire@${stepAt}`);

    const stepBlock = promote.slice(promote.lastIndexOf('- name:', stepAt), stepAt);
    assert('22b. and skips it when production already serves the release',
        /if: steps\.release\.outputs\.already_live != 'true'/.test(stepBlock),
        'the retirement step is not guarded by already_live');

    assert('22c. the checkout has full history, so the ancestry proof can be made',
        /fetch-depth: 0/.test(promote),
        'a shallow checkout would make every ancestry check "cannot prove"');

    assert('22d. a merge to main never deletes a function',
        !/functions:delete/.test(main),
        'main.yml still carries a functions:delete step');

    // The checkout is the CANDIDATE, and a rollback's candidate predates the
    // list or the script itself; `main` (this workflow's commit) has both.
    assert('22e. the script comes from the workflow\'s own commit, not the candidate checkout',
        stepBlock.includes('TOOLING_SHA: ${{ github.sha }}')
            && stepBlock.includes('git show "$TOOLING_SHA:scripts/retire-functions.mjs" > "$RUNNER_TEMP/retire-functions.mjs"')
            && !/node scripts\/retire-functions\.mjs/.test(promote),
        'a rollback to a release without scripts/retire-functions.mjs would fail the promotion');
}

}
