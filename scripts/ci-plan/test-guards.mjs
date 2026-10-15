/**
 * K, L — the guards that have to stay guards.
 *
 * K pins the steps that were once advisory and are now blocking, so none can
 * quietly go back to `continue-on-error`, and the public-claims step that was
 * documented as a CI gate before any job ran it — in the one job no plan skips.
 * K5 holds every step of that job in one table: each guard's wiring is asserted
 * here, not in the guard's own suite. L pins the secret scanner's wiring: no
 * third-party scanning action, full history checked out, no `if:` that can
 * condition it away, and an audit that reports without being able to block a
 * release.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { ALWAYS_REQUIRED_JOBS, lanesForPath } from '../ci-plan.mjs';
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

    /*
     * K1b — the rest of the design-system family, pinned for the same reason.
     *
     * K1 above holds the visual lane because that lane spent its whole existence
     * advisory and red. It is the same argument for its four siblings: a step
     * nobody has yet made advisory with `continue-on-error` is not the same as
     * one that cannot be. Section 6 of the roadmap says the whole family is
     * "permanently blocking", and this assertion is what makes it so.
     *
     * Each entry names the step AND asserts it exists, because renaming a step
     * makes an assertion about it vacuously true — the failure mode K1's own
     * first assertion exists to catch.
     */
    for (const [step, script] of [
        ['Visual contract (geometry)', 'check:visual-contract'],
        ['Table layout check', 'check:table-layout'],
        ['Application screenshots (pixel baselines)', 'test:visual'],
    ]) {
        const block = stepBlock(step);
        assert(`K1b. the "${step}" step exists`, block !== null,
            `renaming it would make the blocking assertion below vacuous (runs ${script})`);
        assert(`K1b. and it is blocking`,
            block !== null && !/continue-on-error:\s*true/.test(block),
            'a design-system gate that cannot fail the run is a report, not a gate');
    }

    /*
     * K1d — the story render and axe test runs once, in the unit lane. The
     * catalog job used to run it again on every run that had both lanes. One
     * run is enough only while the unit lane really runs the file and every
     * change that selects the catalog lane selects the unit lane too. A unit
     * lane skipped as already proven passed on this same tree, story test
     * included.
     */
    {
        const vitestConfig = readFileSync(resolvePath(here, '../vitest.config.js'), 'utf8');
        const { scripts } = JSON.parse(readFileSync(resolvePath(here, '../package.json'), 'utf8'));
        const jobText = (job, nextJob) => {
            const start = workflowText.indexOf(`\n  ${job}:`);
            const end = workflowText.indexOf(`\n  ${nextJob}:`);
            return start >= 0 && end > start ? workflowText.slice(start, end) : '';
        };
        const unitJob = jobText('frontend-quality', 'frontend-e2e');
        const catalogJob = jobText('storybook-build', 'rules-emulator');
        assert('K1d. the story test exists',
            existsSync(resolvePath(here, '../src/tests/designSystemStories.a11y.test.jsx')),
            'renaming it would make the assertions below vacuous');
        assert('K1d. the unit lane runs every test file under src/, the story test included',
            /npm run test:coverage/.test(unitJob)
                && scripts['test:coverage'] === 'vitest run --coverage'
                && vitestConfig.includes("include: ['src/**/*.{test,spec}.{js,mjs,jsx,tsx}']")
                && vitestConfig.includes("exclude: ['**/node_modules/**', 'e2e/**']"),
            'the catalog job no longer renders the stories, so the unit lane must');
        // Every file in the repository, not a sample: a rule that sent some
        // path to the catalog lane without the unit lane would show up here.
        let tracked = [];
        try {
            tracked = execFileSync('git', ['ls-files'], { cwd: resolvePath(here, '..'), encoding: 'utf8' })
                .split('\n').filter(Boolean);
        } catch {
            // Reported by the assertion below: nothing listed is nothing checked.
        }
        const catalogWithoutUnit = tracked.filter((path) => {
            const lanes = lanesForPath(path);
            return lanes !== null && lanes.includes('storybook') && !lanes.includes('frontend_unit');
        });
        assert('K1d. every file whose change selects the catalog lane selects the unit lane too',
            tracked.length > 0 && catalogWithoutUnit.length === 0,
            tracked.length === 0
                ? 'git ls-files listed nothing, so nothing was checked'
                : `${catalogWithoutUnit.length} file(s) select the catalog lane alone, e.g. ${catalogWithoutUnit.slice(0, 5).join(', ')}`);
        assert('K1d. and the catalog job does not run the story test a second time',
            catalogJob !== '' && !/test:stories|designSystemStories/.test(catalogJob),
            'one run in the unit lane is the whole check');
    }

    /*
     * K1c — the first-download budget. A size ceiling that is not enforced after
     * every build is a number in a document. The check runs in the job that
     * builds, after the build, and is blocking; its own tests run in the job no
     * plan can skip.
     */
    {
        const jobStart = workflowText.indexOf('\n  frontend-build:');
        const jobEnd = workflowText.indexOf('\n  frontend-quality:');
        const frontendBuild = jobStart >= 0 && jobEnd > jobStart ? workflowText.slice(jobStart, jobEnd) : '';
        const buildAt = frontendBuild.indexOf('npm run build');
        const budgetAt = frontendBuild.indexOf('- name: Check the first-download budget');
        assert('K1c. the first-download budget is checked in frontend-build, after the build',
            buildAt >= 0 && budgetAt > buildAt && /npm run check:bundle-budget/.test(frontendBuild),
            'a ceiling nobody measures against after building is a number in a document');
        const budgetStep = stepBlock('Check the first-download budget');
        assert('K1c. and it is blocking',
            budgetStep !== null && !/continue-on-error:\s*true/.test(budgetStep),
            'a budget that cannot fail the run is a report, not a gate');
        const guardTests = stepBlock('Verify the bundle-budget guard');
        assert('K1c. and the guard\'s own refusals are tested in callable-contract',
            guardTests !== null && /npm run test:bundle-budget/.test(guardTests)
                && workflowText.indexOf('- name: Verify the bundle-budget guard') > workflowText.indexOf('\n  callable-contract:')
                && workflowText.indexOf('- name: Verify the bundle-budget guard') < workflowText.indexOf('\n  frontend-build:'),
            'the checker must be seen to fail on a fixture before it is trusted to fail on a build');
    }

    /*
     * K1e — the lint step. Lint refuses what would crash a screen and a glyph
     * loaded around the design system (`scripts/test-lint-rules.mjs` drives
     * both), so it is a gate like the ones above, and holds only while CI runs
     * it and can fail on it.
     */
    const lintStep = stepBlock('Frontend Lint');
    assert('K1e. the "Frontend Lint" step runs `npm run lint:frontend`',
        lintStep !== null && /^\s+run: npm run lint:frontend\s*$/m.test(lintStep),
        'the lint rules hold only where CI runs them');
    assert('K1e. and it is blocking',
        lintStep !== null && !/continue-on-error/.test(lintStep) && !/^\s+if:/m.test(lintStep),
        'a lint step that cannot fail the run is a report, not a gate');

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

    /*
     * K4 — the public site's claims gate runs on every run, in an always-required job.
     *
     * The step runs the checker itself: CI never runs the root `npm run lint`,
     * so a check reachable only through it is documented, not wired. The check
     * has TWO inputs — the pages and the capability package they are held to.
     * A `web/` change selects `frontend_unit` (A5) and a change to
     * `functions/ai/knowledge/safehaulCapabilities.js` selects only the functions
     * lane, so a step in either lane misses an edit to the other input that makes
     * the live page newly invalid while CI stays green. A gate with two inputs
     * cannot live in a lane either one can skip. It runs in an always-required
     * job instead, which no lane selection can skip and which deliberately runs
     * with no `npm ci` — so these also pin that the checker and the package it
     * loads need nothing installed. The last check is the coverage claim itself:
     * the checker reads only top-level `web/*.html`, so a page in a subdirectory
     * would be validated by nothing.
     */
    const CLAIMS_STEP = 'Public-claims check';
    const CLAIMS_SCRIPT = 'npm run check:public-claims';
    const jobBlock = (jobId) => {
        const start = workflowText.indexOf(`\n  ${jobId}:\n`);
        if (start < 0) return null;
        const rest = workflowText.slice(start + 1);
        const next = rest.search(/\n {2}[A-Za-z0-9_-]+:\n/);
        return next < 0 ? rest : rest.slice(0, next);
    };
    const stepIn = (block, name) => {
        const start = block.indexOf(`- name: ${name}`);
        if (start < 0) return null;
        const rest = block.slice(start + 1);
        const next = rest.indexOf('\n      - name:');
        return next < 0 ? rest : rest.slice(0, next);
    };
    const runsClaims = new RegExp(`^\\s+run:\\s*${CLAIMS_SCRIPT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');

    const carriers = ALWAYS_REQUIRED_JOBS.filter((job) => {
        const block = jobBlock(job);
        return block !== null && stepIn(block, CLAIMS_STEP) !== null;
    });
    assert('K4. an always-required job carries the public-claims step',
        carriers.length > 0,
        'in a lane, either of the check\'s inputs — web/ or the capability package — '
        + 'can change without selecting it; only a job no plan can skip closes both');
    for (const job of carriers) {
        const block = jobBlock(job);
        const step = stepIn(block, CLAIMS_STEP);
        assert(`K4. ${job} runs the checker itself, not a script that merely contains it`,
            runsClaims.test(step),
            'the root `npm run lint` used to be the only caller, and CI never ran it');
        assert(`K4. the public-claims step in ${job} is blocking and unconditional`,
            !/continue-on-error:\s*true/.test(step) && !/^\s+if:/m.test(step),
            'a claims check that cannot fail, or that a condition can skip, is a report');
        assert(`K4. ${job} carries no job-level \`if:\``,
            !/^\s{4}if:/m.test(block),
            'an always-required job that can be conditioned away is not always required');
    }

    const pkg = JSON.parse(readFileSync(resolvePath(here, '../package.json'), 'utf8'));
    const checkerPath = resolvePath(here, './check-public-claims.mjs');
    assert('K4. `check:public-claims` still points at the checker',
        pkg.scripts['check:public-claims'] === 'node scripts/check-public-claims.mjs' && existsSync(checkerPath),
        'the workflow names the npm script, so the script must still name the file');
    const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const checker = stripComments(readFileSync(checkerPath, 'utf8'));
    const specifiers = [...checker.matchAll(/\bfrom\s+'([^']+)'/g)].map((match) => match[1]);
    assert('K4. the checker imports nothing but Node builtins',
        specifiers.length > 0 && specifiers.every((specifier) => specifier.startsWith('node:')),
        'this checker stays dependency-free on purpose: it is the one gate that must survive a '
        + `broken install in the always-required job: ${specifiers.join(', ')}`);
    // A helper the package requires from its own folder (`claimScope.js`) is part
    // of it, and must itself require nothing: nothing installed is ever reached.
    const knowledgeFile = (name) => stripComments(readFileSync(
        resolvePath(here, `../functions/ai/knowledge/${name}.js`), 'utf8'));
    const capabilities = knowledgeFile('safehaulCapabilities');
    const ownHelper = /\brequire\(\s*'\.\/([\w-]+)'\s*\)/g;
    const loaded = [
        capabilities.replace(ownHelper, ''),
        ...[...capabilities.matchAll(ownHelper)].map((match) => knowledgeFile(match[1])),
    ];
    assert('K4. the capability package the checker loads needs nothing installed either',
        loaded.every((source) => !/\brequire\s*\(/.test(source) && !/^\s*import\s/m.test(source)),
        'it is a data module, and a helper from its own folder must require nothing; the first '
        + 'installed dependency would break the always-required job');
    assert('K4. the checker reads the public site from `web/`',
        /PUBLIC_DIR = path\.join\(ROOT, 'web'\)/.test(checker),
        'the checker must read the directory the hosting targets serve, or it validates the wrong site');
    assert('K4. the checker refuses when it finds no HTML',
        /if \(pages\.length === 0\) \{[^}]*process\.exit\(1\)/.test(checker),
        'zero pages means nothing was checked, and nothing checked must not pass');
    assert('K4. the checker reuses the capability package\'s own checkClaims',
        /require\([^)]*safehaulCapabilities\.js/.test(checker) && /\bcheckClaims\(/.test(checker),
        'the blog and the public site are held to one list, not two copies that drift');

    const webDir = resolvePath(here, '../web');
    const nestedHtml = readdirSync(webDir, { recursive: true })
        .map(String)
        .filter((file) => file.endsWith('.html') && /[\\/]/.test(file));
    assert('K4. every public page sits where the checker looks',
        nestedHtml.length === 0,
        `the checker scans top-level web/*.html only; nested page(s) would be validated by nothing: ${nestedHtml.join(', ')}`);

    /*
     * K5 — every step of `callable-contract`, in one table.
     *
     * The job no plan can skip carries the repository's guards: a checker, the
     * tests that show it can still refuse, or both. Each guard used to pin its
     * own wiring in its own suite, with its own reading of this file. One table
     * holds them now, so a new step is one row, and every row is held to the
     * same rules: it runs in this job and nowhere else, it runs its commands and
     * nothing more (no flag, no env, so no base commit or token it could lean
     * on), nothing can make it advisory, and a guard's tests run before its
     * check, because a checker proven after it passed proves nothing about the
     * run that passed. Nothing else in the job escapes the table: each setup
     * action is listed with the settings it may take, the job holds only its
     * runner, a read-only token and its steps, and a line K5 cannot read is
     * refused.
     *
     * Each row: the step's name, the commands its `run:` holds, and for a guard's
     * test step, the pattern its suites match on disk; `GUARD_SCRIPTS` pins what
     * each npm script a row names runs. The list of suites comes off disk
     * because a hand-written one is the same hazard one level up: a suite split
     * in two, with the half that moved never chained.
     */
    const GUARD_JOB = 'callable-contract';
    const GUARD_STEPS = [
        ['Verify frontend/backend callable contract', ['node scripts/check-callable-contract.mjs']],
        [CLAIMS_STEP, [CLAIMS_SCRIPT]],
        ['Verify the production-promotion gate', ['npm run check:release-scripts']],
        ['Verify the CI plan and release-validation gate', ['node scripts/test-ci-plan.mjs']],
        ["Verify the secret scanner's range selection and detection", ['npm run test:secret-scan']],
        ['Verify the functions deploy planner', ['npm run check:function-exports', 'npm run check:deploy-script']],
        ['Verify the source-size guard', ['npm run test:source-size'], /^test-source-size(-[a-z]+)?\.mjs$/],
        ['Check source sizes', ['npm run check:source-size']],
        ['Verify the agent-docs guard', ['npm run test:agent-docs']],
        ['Check agent instruction sizes', ['npm run check:agent-docs']],
        ['Verify the AI-boundary guard', ['npm run test:ai-boundary']],
        ['Verify the AI provider boundary', ['npm run check:ai-boundary']],
        ['Verify the UI-contract guard', ['npm run test:ui-contract'], /^test-ui-contract(-[a-z]+)?\.mjs$/],
        ['UI contract ratchet', ['npm run check:ui-contract']],
        ['Verify the lint rules', ['npm run test:lint-rules']],
        ['Verify the bundle-budget guard', ['npm run test:bundle-budget']],
    ];
    /** A guard's tests, then its check. */
    const TESTS_FIRST = [
        ['Verify the source-size guard', 'Check source sizes'],
        ['Verify the agent-docs guard', 'Check agent instruction sizes'],
        ['Verify the AI-boundary guard', 'Verify the AI provider boundary'],
        ['Verify the UI-contract guard', 'UI contract ratchet'],
    ];
    /**
     * What each npm script a row names runs, exactly. The script is the next hop
     * from the step, so `|| true`, a flag, an env or another file there is the
     * step's own.
     */
    const GUARD_SCRIPTS = {
        'check:public-claims': 'node scripts/check-public-claims.mjs',
        'check:release-scripts': 'node scripts/test-release-promotion.mjs',
        'test:secret-scan': 'node scripts/test-secret-scan.mjs',
        'check:function-exports': 'node scripts/validate-function-index-parse.mjs',
        'check:deploy-script': 'node scripts/test-deploy-incremental.mjs',
        'test:source-size': 'node scripts/test-source-size.mjs',
        'check:source-size': 'node scripts/source-size.mjs',
        'test:agent-docs': 'node scripts/test-agent-docs.mjs',
        'check:agent-docs': 'node scripts/check-agent-docs.mjs',
        'test:ai-boundary': 'node scripts/test-ai-boundary.mjs',
        'check:ai-boundary': 'node scripts/check-ai-provider-boundary.mjs',
        'test:ui-contract': [
            'node scripts/test-ui-contract.mjs', 'node scripts/test-ui-contract-state.mjs',
            'node scripts/test-ui-contract-scope.mjs', 'node scripts/test-ui-contract-allowlist.mjs',
        ].join(' && '),
        'check:ui-contract': 'node scripts/check-ui-contract.mjs',
        'test:lint-rules': 'node scripts/test-lint-rules.mjs',
        'test:bundle-budget': 'node scripts/test-bundle-budget.mjs',
    };
    /**
     * The steps that run no command: the action each uses, revision included,
     * and its `with:` settings, exactly. A Dependabot bump of either action
     * updates this table in the same pull request.
     */
    const SETUP_STEPS = {
        'actions/checkout@v7': [],
        'actions/setup-node@v7': ['node-version: 22.x', "cache: 'npm'"],
    };
    /** The commands a step runs: its one-line `run:`, or each line of a `run: |` block. */
    const commandsOf = (step) => {
        const single = step.match(/^\s+run: (?!\|)(.+)$/m);
        if (single) return [single[1].trim()];
        const block = step.match(/^ +run: \|\n((?: {10}.+\n?)+)/m);
        return block ? block[1].split('\n').map((line) => line.trim()).filter(Boolean) : [];
    };
    /*
     * The job is read strictly, line by line. A YAML parser would be the first
     * installed dependency of a suite that needs none, and a reader that skips
     * what it does not recognise lets a step through unseen (`- { run: … }`).
     * This one knows the shapes the job is written in and refuses every other
     * line: a job key at four spaces, a step's first key after `- ` at six, its
     * other keys at eight, anything deeper the value of the key above it.
     */
    const readJob = (block) => {
        const read = { keys: {}, steps: [], unknown: [] };
        let jobKey = null;
        let step = null;
        for (const line of block.split('\n').slice(1)) {
            let match;
            if (step && /^ {10}/.test(line)) {
                step.entries.at(-1).nested.push(line);
                step.text += `${line}\n`;
            } else if (/^\s*(#.*)?$/.test(line)) {
                continue;
            } else if ((match = line.match(/^ {4}([a-z][a-z-]*):(?: (.*))?$/))) {
                jobKey = match[1];
                read.keys[jobKey] = { value: match[2], nested: [] };
                step = null;
            } else if (jobKey === 'steps' && read.keys.steps.value === undefined
                && (match = line.match(/^ {6}- ([a-z][a-z-]*):(?: (.*))?$/))) {
                step = { name: match[1] === 'name' ? match[2] : undefined, entries: [], text: `${line}\n` };
                step.entries.push({ key: match[1], value: match[2], nested: [] });
                read.steps.push(step);
            } else if (step && (match = line.match(/^ {8}([a-z][a-z-]*):(?: (.*))?$/))) {
                step.entries.push({ key: match[1], value: match[2], nested: [] });
                step.text += `${line}\n`;
            } else if (jobKey !== null && jobKey !== 'steps' && /^ {6}/.test(line)) {
                read.keys[jobKey].nested.push(line.trim());
            } else {
                read.unknown.push(line.trim());
            }
        }
        return read;
    };
    const keysOf = (step) => step?.entries.map(({ key }) => key) ?? [];

    const guardJob = jobBlock(GUARD_JOB) ?? '';
    const job = readJob(guardJob);
    assert(`K5. ${GUARD_JOB} is always required`,
        guardJob !== '' && ALWAYS_REQUIRED_JOBS.includes(GUARD_JOB),
        'a guard in a job a plan or a condition can skip makes a claim only about the runs that kept it');
    assert(`K5. and every line of it is one K5 can read`, job.unknown.length === 0, job.unknown.join(' | '));
    // A job-level `if:` skips every step; an `env:`, `defaults:`, `container:` or
    // `continue-on-error:` reaches every step the way the step's own key would.
    const jobKeys = Object.keys(job.keys);
    assert('K5. and it holds no job key but runs-on, permissions and steps',
        jobKeys.every((key) => ['runs-on', 'permissions', 'steps'].includes(key)), jobKeys.join(', '));
    assert('K5. and its token reads the repository and nothing more',
        job.keys.permissions?.value === undefined
            && JSON.stringify(job.keys.permissions?.nested) === JSON.stringify(['contents: read']),
        JSON.stringify(job.keys.permissions ?? 'no permissions block'));
    // And above it: a workflow-level `env:` or `defaults:` reaches every step of every job.
    const topLines = workflowText.split('\n').filter((line) => /^[^\s#]/.test(line));
    assert('K5. and nothing above the job reaches its steps: no workflow-level env or defaults',
        topLines.every((line) => /^(name|run-name|on|permissions|concurrency|jobs):( .*)?$/.test(line)),
        topLines.join(' | '));

    const commandSteps = job.steps.filter((step) => keysOf(step).includes('run'));
    // A step needs a name to have a row, and opens with it, as every step here does.
    const unnamed = commandSteps.filter((step) => step.name === undefined);
    assert(`K5. every step of ${GUARD_JOB} that runs a command opens with its name, so it can have a row`,
        unnamed.length === 0, unnamed.map((step) => step.text.split('\n')[0].trim()).join(' | '));
    // A step that runs no command runs an action, and an action can run anything,
    // check out another tree or set up another Node: each is one K5 lists, at the
    // revision and with the settings it lists.
    for (const step of job.steps.filter((candidate) => !commandSteps.includes(candidate))) {
        const entry = (key) => step.entries.find((candidate) => candidate.key === key);
        const uses = entry('uses')?.value ?? '';
        const settings = entry('with');
        assert(`K5. the setup step "${step.name ?? uses}" is one K5 lists, exactly`,
            Object.hasOwn(SETUP_STEPS, uses)
                && keysOf(step).every((key) => ['name', 'uses', 'with'].includes(key))
                && settings?.value === undefined
                && JSON.stringify((settings?.nested ?? []).map((line) => line.trim())) === JSON.stringify(SETUP_STEPS[uses]),
            step.text.trim().split('\n').map((line) => line.trim()).join(' | '));
    }

    // And the table is the set, not an allowlist: without setup-node the job
    // runs on whatever Node the runner has.
    const setupSteps = job.steps.filter((candidate) => !commandSteps.includes(candidate));
    const opening = job.steps.slice(0, setupSteps.length);
    assert('K5. the job opens with every setup step K5 lists, each once, in its order',
        JSON.stringify(opening.map((step) => step.entries.find(({ key }) => key === 'uses')?.value ?? ''))
            === JSON.stringify(Object.keys(SETUP_STEPS)) && opening.every((step) => setupSteps.includes(step)),
        job.steps.slice(0, 3).map((step) => step.text.split('\n')[0].trim()).join(' | '));

    // A name is how a step is found, so two steps may not share one: a second
    // `Install Dependencies` would be a command that only the first is held to.
    const names = job.steps.map((step) => step.name).filter((name) => name !== undefined);
    assert(`K5. every step of ${GUARD_JOB} has a name of its own`,
        new Set(names).size === names.length,
        names.filter((name, at) => names.indexOf(name) !== at).join(', '));
    const stepAt = (name) => job.steps.findIndex((step) => step.name === name);
    const install = job.steps[stepAt('Install Dependencies')];

    // Every step that runs a command, the one install aside.
    const named = commandSteps.filter((step) => step !== install).map((step) => step.name);
    const rows = GUARD_STEPS.map(([name]) => name);
    assert(`K5. the table names every step ${GUARD_JOB} runs, and nothing else`,
        named.length === rows.length && named.every((name) => rows.includes(name)),
        `job: ${named.join(' | ')}`);
    const firstGuard = Math.min(...rows.map(stepAt).filter((at) => at !== -1));
    assert('K5. it installs dependencies with `npm ci` before the first guard step',
        install !== undefined && keysOf(install).join() === 'name,run'
            && JSON.stringify(commandsOf(install.text)) === JSON.stringify(['npm ci'])
            && stepAt('Install Dependencies') < firstGuard,
        'the table rule parses with @babel/parser and the lint test drives ESLint; neither is a Node builtin');

    for (const [name, commands, suitePattern] of GUARD_STEPS) {
        const step = job.steps[stepAt(name)];
        const text = step?.text ?? '';
        assert(`K5. "${name}" runs ${commands.join(' and ')}, and nothing more`,
            JSON.stringify(commandsOf(text)) === JSON.stringify(commands),
            text.split('\n').slice(0, 3).join(' | ') || 'step missing');
        // An `env:`, `if:`, `continue-on-error:`, `working-directory:` or `shell:`
        // makes it advisory, or changes what the same command runs.
        assert('K5. and the step holds nothing but its name and its command',
            keysOf(step).join() === 'name,run', keysOf(step).join(', '));
        assert('K5. and no other job runs it',
            workflowText.split(`- name: ${name}\n`).length === 2,
            'a copy elsewhere is a second step to keep in step with this one');
        const scripts = commands.map((command) => command.match(/^npm run ([\w:-]+)$/)?.[1]).filter(Boolean);
        assert('K5. and each npm script it names runs exactly what the table pins',
            scripts.every((script) => Object.hasOwn(GUARD_SCRIPTS, script) && pkg.scripts[script] === GUARD_SCRIPTS[script]),
            scripts.map((script) => `${script} = ${JSON.stringify(pkg.scripts[script])}`).join(', '));
        if (suitePattern) {
            const suites = readdirSync(here).filter((file) => suitePattern.test(file));
            const chain = pkg.scripts[scripts[0]] ?? '';
            assert(`K5. and ${scripts[0]} chains every suite the guard has (${suites.length})`,
                suites.length > 0 && suites.every((file) => chain.includes(`scripts/${file}`)),
                `${suites.join(', ')} vs ${chain}`);
        }
    }
    // npm runs `pre<name>` and `post<name>` around `npm run <name>`, and the
    // root's install lifecycle inside `npm ci`; `.npmrc` can change the shell or
    // the Node options every script runs with. Each is a command no row holds.
    const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare'];
    const hooks = Object.keys(pkg.scripts).filter((name) => LIFECYCLE.includes(name)
        || Object.keys(GUARD_SCRIPTS).some((script) => name === `pre${script}` || name === `post${script}`));
    assert('K5. and npm runs nothing around them: no pre or post script, no install lifecycle, no .npmrc',
        hooks.length === 0 && !existsSync(resolvePath(here, '../.npmrc')),
        hooks.join(', ') || '.npmrc');
    // CI runs this suite by its file, because it could not see its own npm script
    // pointed somewhere else; the script agents run locally runs the same file.
    assert('K5. and `npm run check:ci-plan` runs the file CI runs',
        pkg.scripts['check:ci-plan'] === 'node scripts/test-ci-plan.mjs',
        `check:ci-plan = ${JSON.stringify(pkg.scripts['check:ci-plan'])}`);
    const scriptsNamed = GUARD_STEPS.flatMap(([, commands]) => commands)
        .map((command) => command.match(/^npm run ([\w:-]+)$/)?.[1]).filter(Boolean);
    assert('K5. and the table pins no script a row does not name',
        Object.keys(GUARD_SCRIPTS).every((script) => scriptsNamed.includes(script)),
        Object.keys(GUARD_SCRIPTS).filter((script) => !scriptsNamed.includes(script)).join(', '));
    for (const [tests, check] of TESTS_FIRST) {
        assert(`K5. "${tests}" runs before "${check}"`,
            stepAt(tests) !== -1 && stepAt(tests) < stepAt(check),
            'a checker proven after it passed proves nothing about the run that passed');
    }
}

console.log('\nL. The secret scanner is scoped, pinned, and still mandatory');
{
    /*
     * `gitleaks/gitleaks-action@v2` chooses the scan range from the event and,
     * on `workflow_dispatch`, passes no range at all — so a manual verification
     * of an already-merged commit scans all history, reports the known legacy
     * values, fails `secret-scan`, fails `release-validation` and skips both
     * deploys.
     *
     * These assertions exist because that is invisible from inside this
     * repository: the range lives in someone else's JavaScript. They pin the
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
     * L8-L10 and L15-L26 live in `scripts/secret-scan/test-pinning.mjs`.
     *
     * They read the scanner's own SOURCE — the pinned version and digest, both
     * scan modes, the flags, and `.gitleaks.toml` line for line. Read here as one
     * path, `./secret-scan.mjs`, those regexes would pass over an entry that no
     * longer contains what they check, which is the worst way for a security
     * assertion to fail. `test-pinning.mjs` reads the entry plus every non-test
     * module beside it instead, so it cannot go stale the next time a module
     * moves.
     *
     * What stays here is the WIRING: that the job exists, runs this repository's
     * scanner, checks out full history, cannot be conditioned away, is still
     * required, still fails the release when it fails or is skipped, and that the
     * separate full-history audit cannot reach `release-validation`.
     */
    /*
     * The full-history sweep still exists — it just cannot block a deploy. If it
     * ever gains a push or pull_request trigger, or turns up in
     * release-validation's `needs`, every release is gated on legacy findings it
     * did not introduce.
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
