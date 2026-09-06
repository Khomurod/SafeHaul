/**
 * Scenarios 19–22 — the contract phase that deletes the six landing callables
 * after a production promotion (`scripts/retire-landing-functions.mjs`).
 *
 * These are its failure modes, which matter more than the happy path: deleting
 * on a release that still needs the functions, deleting the one that must stay,
 * planning around a probe that never answered, or the workflow quietly losing
 * the step. Each is asserted against the pure helpers and the workflow text.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
    RETIRED_LANDING_FUNCTIONS,
    KEPT_LANDING_FUNCTION,
    planRetirement,
    verifyRetirement,
    releaseCarriesRetirement,
} from '../retire-landing-functions.mjs';
import { assert } from './harness.mjs';

const all404 = Object.fromEntries(RETIRED_LANDING_FUNCTIONS.map((name) => [name, 404]));

export async function runRetirementScenarios() {
// 19 — the plan deletes exactly what still answers, and nothing that is gone.
{
    const statuses = { ...all404, submitLandingLead: 405, getLandingPageSettings: 400 };
    const plan = planRetirement(statuses);
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
        planRetirement({ ...all404, retryLandingLeadDelivery: undefined });
    } catch {
        refused = true;
    }
    assert('19c. a probe with no answer is refused rather than treated as gone',
        refused, 'an unanswered probe was silently planned around');

    assert('19d. the kept function is never in the retirement set',
        !RETIRED_LANDING_FUNCTIONS.includes(KEPT_LANDING_FUNCTION) && RETIRED_LANDING_FUNCTIONS.length === 6,
        `${RETIRED_LANDING_FUNCTIONS.length} names: ${RETIRED_LANDING_FUNCTIONS.join(', ')}`);
}

// 20 — verification demands all six gone AND the archive reader still present.
{
    assert('20. a clean result verifies',
        verifyRetirement({ ...all404, [KEPT_LANDING_FUNCTION]: 400 }).length === 0,
        'a fully retired set with the keeper answering was reported as a problem');

    const survivor = verifyRetirement({ ...all404, sendLandingTelegramTest: 400, [KEPT_LANDING_FUNCTION]: 400 });
    assert('20b. a retired callable that still answers is a problem',
        survivor.length === 1 && /sendLandingTelegramTest/.test(survivor[0]),
        survivor.join('; '));

    const lostKeeper = verifyRetirement({ ...all404, [KEPT_LANDING_FUNCTION]: 404 });
    assert('20c. losing listLandingLeads is a problem — it was meant to stay',
        lostKeeper.length === 1 && /listLandingLeads/.test(lostKeeper[0]),
        lostKeeper.join('; '));
}

// 21 — the precondition: cannot prove means do not delete.
{
    assert('21. git exit 0 means the release carries LD-R3', releaseCarriesRetirement(0) === true);
    assert('21b. git exit 1 means it predates LD-R3 — nothing is deleted', releaseCarriesRetirement(1) === false);
    assert('21c. any other git exit (shallow clone, unknown sha) is "cannot prove", not "yes"',
        releaseCarriesRetirement(128) === null && releaseCarriesRetirement(null) === null,
        'an inconclusive ancestry check was read as permission to delete');
}

// 22 — the workflow actually runs it, in the right place, and nothing else deletes functions.
{
    const here = dirname(fileURLToPath(import.meta.url));
    const promote = readFileSync(resolvePath(here, '../../.github/workflows/promote-production.yml'), 'utf8');
    const main = readFileSync(resolvePath(here, '../../.github/workflows/main.yml'), 'utf8');

    const stepAt = promote.indexOf('run: node scripts/retire-landing-functions.mjs');
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
}

}
