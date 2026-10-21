#!/usr/bin/env node
/**
 * Takes the pixel baselines from a failed CI screenshot job, in one command:
 *
 *     npm run screenshots:pull -- <workflow run id>
 *     npm run screenshots:pull -- <unpacked or .zip artifact>
 *
 * Baselines are rendered on CI's pinned browser, so a local `--update-snapshots`
 * gives other bytes; this copies CI's own renders instead. It downloads the
 * run's `app-screenshots-diff` and `visual-regression-diff` artifacts (with `gh`
 * when it is installed, else through the GitHub API with curl), and replaces
 * each baseline whose attempts all rendered the same bytes. Look at the changed
 * images before committing them.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planBaselines } from './lib/screenshotBaselines.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'e2e/visual/__screenshots__');
const ARTIFACTS = ['app-screenshots-diff', 'visual-regression-diff'];

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { encoding: 'utf8', ...options });
    return { ok: result.status === 0, out: result.stdout || '', err: result.stderr || String(result.error || '') };
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

/** `owner/repo` from the origin remote, whatever host or proxy it goes through. */
function repoSlug() {
    const url = run('git', ['remote', 'get-url', 'origin'], { cwd: ROOT }).out.trim();
    const match = /([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    if (!match) fail(`Could not read the repository from the origin remote (${url || 'none'}).`);
    return `${match[1]}/${match[2]}`;
}

function download(runId, into) {
    const repo = repoSlug();
    const viaGh = run('gh', ['--version']).ok;
    let names;
    if (viaGh) {
        const listed = run('gh', ['api', `repos/${repo}/actions/runs/${runId}/artifacts`, '--jq', '.artifacts[].name']);
        if (!listed.ok) fail(`gh could not list run ${runId}'s artifacts: ${listed.err.trim()}`);
        names = listed.out.split('\n').filter((name) => ARTIFACTS.includes(name));
    } else {
        const listed = run('curl', ['-sSf', `https://api.github.com/repos/${repo}/actions/runs/${runId}/artifacts`]);
        if (!listed.ok) fail(`Could not list run ${runId}'s artifacts: ${listed.err.trim()}`);
        const artifacts = JSON.parse(listed.out).artifacts || [];
        names = artifacts.filter((artifact) => ARTIFACTS.includes(artifact.name)).map((artifact) => artifact.name);
        for (const artifact of artifacts.filter((item) => names.includes(item.name))) {
            const dir = join(into, artifact.name);
            mkdirSync(dir, { recursive: true });
            const zip = join(into, `${artifact.name}.zip`);
            const got = run('curl', ['-sSfL', '-o', zip, artifact.archive_download_url]);
            if (!got.ok) fail(`Could not download ${artifact.name}: ${got.err.trim()}`);
            if (!run('unzip', ['-q', zip, '-d', dir]).ok) fail(`Could not unpack ${zip}.`);
        }
    }
    if (!names.length) fail(`Run ${runId} has no screenshot diff. Its screenshots passed, or the run is not finished.`);
    if (viaGh) {
        for (const name of names) {
            const got = run('gh', ['run', 'download', String(runId), '-R', repo, '-n', name, '-D', join(into, name)]);
            if (!got.ok) fail(`gh could not download ${name}: ${got.err.trim()}`);
        }
    }
    return names.map((name) => join(into, name));
}

function filesUnder(dir) {
    return readdirSync(dir, { recursive: true })
        .map((name) => join(dir, String(name)))
        .filter((path) => statSync(path).isFile());
}

const source = process.argv[2];
if (!source) fail('Usage: npm run screenshots:pull -- <workflow run id | artifact folder or .zip>');

let roots;
if (/^\d+$/.test(source)) {
    roots = download(source, mkdtempSync(join(tmpdir(), 'safehaul-shots-')));
} else if (source.endsWith('.zip')) {
    const dir = mkdtempSync(join(tmpdir(), 'safehaul-shots-'));
    if (!run('unzip', ['-q', resolve(source), '-d', dir]).ok) fail(`Could not unpack ${source}.`);
    roots = [dir];
} else {
    if (!existsSync(source)) fail(`${source} does not exist.`);
    roots = [resolve(source)];
}

const specs = readdirSync(SHOTS);
let changed = 0;
for (const root of roots) {
    const files = filesUnder(root).map((path) => ({
        path: relative(root, path).split('\\').join('/'),
        hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
    }));
    const { updates, unstable } = planBaselines(files, specs);
    for (const { from, to } of updates) {
        const target = join(ROOT, to);
        const isNew = !existsSync(target);
        copyFileSync(join(root, from), target);
        changed += 1;
        console.log(`${isNew ? 'added  ' : 'updated'} ${to}`);
    }
    for (const to of unstable) console.warn(`skipped ${to}: its attempts rendered different images`);
}
console.log(changed ? `${changed} baseline(s) replaced. Look at them before committing.` : 'No baseline to replace.');
