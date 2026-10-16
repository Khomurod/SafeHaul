/**
 * I, J — workflow wiring, and the Playwright project arithmetic.
 *
 * J is the half that reads like a detail and is not: `--project` ACCUMULATES, it
 * does not narrow. Naming the functional projects in the `test:e2e` script put
 * firefox, webkit and both mobile lanes into every chromium shard, and 113 tests
 * failed on all four shards through all three retries because the runner installs
 * only Chromium. Both halves of that number are pinned here.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { runInNewContext } from 'node:vm';
import { assert, here } from './test-support.mjs';

console.log('\nI. Workflow wiring');
/* ========================================================================== */

// Cheap structural checks over EVERY workflow file, not just main.yml. These are
// the mistakes that produce a condition which quietly evaluates to nothing rather
// than an error: a dependency that does not exist, or a job referenced in a
// condition that was never declared as a dependency.
//
// Text-parsed on purpose: a yaml parser is only present here transitively, so
// depending on one would be one lockfile change away from breaking.
{
    /**
     * Job blocks from one workflow file.
     *
     * Scoped to the `jobs:` section, because the keys under `on:` sit at the same
     * indent and would otherwise be read as jobs named `push` and `schedule` —
     * which this check reported the first time it ran.
     */
    const parseJobs = (text) => {
        const jobsAt = text.search(/^jobs:$/m);
        if (jobsAt === -1) return [];
        const section = text.slice(jobsAt);
        const matches = [...section.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)];

        return matches.map((match, index) => {
            const end = index + 1 < matches.length ? matches[index + 1].index : section.length;
            const block = section.slice(match.index, end);
            const stepsAt = block.indexOf('\n    steps:');
            const header = stepsAt === -1 ? block : block.slice(0, stepsAt);

            // All three forms YAML allows: a block list, an inline list, and a
            // bare scalar. The lane jobs use the scalar form (`needs: plan`),
            // which this check missed on its first run.
            const needs = [...header.matchAll(/^ {6}- ([a-z][a-z0-9-]*)$/gm)].map((m) => m[1]);
            const inline = header.match(/^ {4}needs:\s*\[([^\]]*)\]/m);
            if (inline) needs.push(...inline[1].split(',').map((s) => s.trim()).filter(Boolean));
            const scalar = header.match(/^ {4}needs:\s*([a-z][a-z0-9-]*)\s*$/m);
            if (scalar) needs.push(scalar[1]);

            return { id: match[1], block, header, needs };
        });
    };

    const workflowDir = resolvePath(here, '../.github/workflows');
    const files = readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name));

    assert('I0. there are workflow files to check', files.length >= 3, `found ${files.length}`);

    for (const file of files) {
        const jobs = parseJobs(readFileSync(resolvePath(workflowDir, file), 'utf8'));
        const jobIds = jobs.map((job) => job.id);

        assert(`I1. ${file}: parsed at least one job`, jobs.length > 0);

        assert(`I1b. ${file}: job ids are unique`,
            new Set(jobIds).size === jobIds.length,
            `duplicates: ${jobIds.filter((id, i) => jobIds.indexOf(id) !== i).join(', ')}`);

        for (const { id, block, header, needs } of jobs) {
            const unknown = needs.filter((need) => !jobIds.includes(need));
            assert(`I2. ${file}/${id}: every dependency names a real job`,
                unknown.length === 0, `unknown: ${unknown.join(', ')}`);

            // THE one that matters: a job referenced in a condition but never
            // depended on always reads as empty, so the condition silently
            // evaluates to false and the job never runs — no error, no warning.
            const referenced = [...block.matchAll(/needs\.([a-z][a-z0-9-]*)\./g)].map((m) => m[1]);
            const undeclared = [...new Set(referenced)].filter((ref) => !needs.includes(ref));
            assert(`I3. ${file}/${id}: every job it references is one it depends on`,
                undeclared.length === 0,
                `referenced but not in needs: ${undeclared.join(', ')} — these always read as empty`);

            assert(`I4. ${file}/${id}: declares where it runs`,
                /^ {4}runs-on:/m.test(header), 'missing runs-on');
        }
    }

    // The functions deploy refuses to run when an export in `functions/index.js`
    // maps to no module. The checks that say so run on every event, in the job
    // nothing can skip, and ask the deploy's own parser rather than a copy.
    const contract = parseJobs(readFileSync(resolvePath(workflowDir, 'main.yml'), 'utf8'))
        .find(({ id }) => id === 'callable-contract');
    assert('I5. callable-contract runs both deploy-planner checks on every event',
        contract !== undefined && !/^ {4}if:/m.test(contract.header)
            && /npm run check:function-exports/.test(contract.block)
            && /npm run check:deploy-script/.test(contract.block),
        'a PR that breaks the export mapping would go green and stop the next functions deploy');
    const validator = readFileSync(resolvePath(here, 'validate-function-index-parse.mjs'), 'utf8');
    assert('I5b. check:function-exports asks the deploy\'s own parser',
        /from '\.\/deploy-functions-resolve\.mjs'/.test(validator) && !/\.exec\(|matchAll/.test(validator),
        'a copy of the parser keeps passing after the real one changes');
}

/*
 * J. Playwright project selection: the scripts and the workflow are one contract.
 *
 * `--project` ACCUMULATES on the Playwright command line. `main.yml` runs
 * `npm run test:e2e -- --project=chromium --project=mobile-chrome`, so any
 * `--project` baked into the script UNIONS with those rather than narrowing
 * them. Naming the five functional projects in `test:e2e` — a
 * reasonable-looking way to keep the visual lane out of a bare run — therefore
 * puts firefox, webkit and both mobile lanes into every chromium shard. The
 * runner installs only Chromium, so their tests fail with `browserType.launch:
 * Executable doesn't exist`, on every shard, through every retry.
 *
 * The visual lane is kept out by living in its own config instead, which no
 * caller can accidentally widen. These checks pin both halves of that.
 */
{
    const pkg = JSON.parse(readFileSync(resolvePath(here, '../package.json'), 'utf8'));
    const scripts = pkg.scripts || {};
    const workflow = readFileSync(resolvePath(here, '../.github/workflows/main.yml'), 'utf8');

    assert('J1. test:e2e bakes in no --project',
        !/--project/.test(scripts['test:e2e'] || ''),
        `test:e2e = ${JSON.stringify(scripts['test:e2e'])} — a caller's --project would union with it, not replace it`);

    assert('J2. every workflow use of test:e2e names its project',
        [...workflow.matchAll(/npm run test:e2e\b[^\n]*/g)].every((m) => m[0].includes('--project=')),
        'a run without --project would execute every configured project');

    // The reason J1 is safe: the functional config carries no visual project, so
    // a bare `playwright test` cannot reach the lane that needs storybook-static.
    const functional = readFileSync(resolvePath(here, '../playwright.config.cjs'), 'utf8');
    assert('J3. the functional config declares no visual project',
        !/name:\s*'visual'/.test(functional),
        'a visual project here runs on a bare `playwright test`, which needs storybook-static');

    const visual = readFileSync(resolvePath(here, '../playwright.visual.config.cjs'), 'utf8');
    assert('J4. the visual config declares the visual project',
        /name:\s*'visual'/.test(visual));

    // And the scripts that drive it must ask for that config by name, or they
    // silently run the functional projects instead.
    for (const name of ['test:visual', 'test:visual:update']) {
        assert(`J5. ${name} names the visual config`,
            (scripts[name] || '').includes('--config=playwright.visual.config.cjs'),
            `${name} = ${JSON.stringify(scripts[name])}`);
    }
}

/*
 * J6–J8. The mobile lane. The mobile projects run only `@mobile` tests (their
 * `grep`), and the E2E shards run `mobile-chrome`. A test whose mobile path is
 * not tagged runs nowhere: the desktop lane skips that path, and the mobile
 * project's filter leaves the test out.
 */
{
    // Evaluated with a stand-in for `@playwright/test`, so this file still needs
    // nothing installed.
    const playwright = { defineConfig: (config) => config, devices: new Proxy({}, { get: () => ({}) }) };
    const sandbox = {
        module: { exports: {} },
        process: { env: {} },
        require: (name) => {
            if (name === '@playwright/test') return playwright;
            throw new Error(`playwright.config.cjs requires ${name}; J6 has no stand-in for it`);
        },
    };
    runInNewContext(readFileSync(resolvePath(here, '../playwright.config.cjs'), 'utf8'), sandbox);
    const mobile = sandbox.module.exports.projects.filter(({ name }) => name.startsWith('mobile'));
    assert('J6. both mobile projects run only @mobile tests',
        // Not `instanceof RegExp`: the pattern was built in the sandbox's realm.
        mobile.length === 2 && mobile.every(({ grep }) => typeof grep?.test === 'function'
            && grep.test('opens on a phone @mobile') && !grep.test('opens on a desktop')),
        mobile.map(({ name, grep }) => `${name}: grep=${grep}`).join(', '));

    const workflow = readFileSync(resolvePath(here, '../.github/workflows/main.yml'), 'utf8');
    assert('J7. the E2E shards run the mobile-chrome project',
        /npm run test:e2e -- --project=chromium --project=mobile-chrome --shard=/.test(workflow),
        'no CI lane would run the @mobile tests');

    // `test.skip(testInfo.project.name.startsWith('mobile'), …)` marks a desktop
    // test; every other use of that check is a path only a phone runs, and the
    // nearest `test(` before it is the test that has to carry the tag.
    const untagged = [];
    let mobilePaths = 0;
    const specDir = resolvePath(here, '../e2e');
    for (const file of readdirSync(specDir).filter((name) => name.endsWith('.spec.cjs'))) {
        const spec = readFileSync(resolvePath(specDir, file), 'utf8');
        for (const use of spec.matchAll(/project\.name\.startsWith\('mobile'\)/g)) {
            const before = spec.slice(0, use.index);
            if (/test\.skip\(\s*testInfo\.$/.test(before)) continue;
            mobilePaths += 1;
            const title = [...before.matchAll(/\btest\(\s*(['"`])([\s\S]*?)\1/g)].at(-1)?.[2];
            if (!title?.includes('@mobile')) untagged.push(`${file}: ${title ?? '(outside a test)'}`);
        }
    }
    // A floor, so a change of idiom cannot leave this scanning nothing.
    assert('J8. every test with a mobile-only path carries @mobile',
        mobilePaths >= 30 && untagged.length === 0,
        `mobile paths found: ${mobilePaths}; untagged: ${untagged.join('; ') || 'none'}`);
}


/* ========================================================================== */
