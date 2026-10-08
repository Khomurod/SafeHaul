// The CI deploy runs `firebase deploy --non-interactive` without `--force`, and
// firebase-tools refuses to deploy a function that newly retries on failure
// without it ("Pass the --force option to deploy functions with a failure
// policy"): the whole deploy stops, not just that function. `--force` would also
// set up an Artifact Registry cleanup policy and accept unsafe updates on its
// own, so the pipeline does not pass it. A function that must not lose its event
// tries again within its run instead (`drafts/expired.js`). Read from the
// deployed entry point itself, under plain Node, as `functionMemoryFloor.test.js`
// reads the memory.

const path = require('path');
const { spawnSync } = require('child_process');

const FUNCTIONS_DIR = path.join(__dirname, '..', '..');

it('configures no function the deploy would refuse for its failure policy', () => {
    const script = [
        "const exported = require('./index.js');",
        'const rows = Object.entries(exported)',
        '    .map(([name, fn]) => [name, fn.__endpoint.eventTrigger?.retry ?? null]);',
        "process.stdout.write('\\n' + JSON.stringify(rows));",
    ].join('\n');
    const run = spawnSync(process.execPath, ['-e', script], {
        cwd: FUNCTIONS_DIR,
        encoding: 'utf8',
        timeout: 60000,
        // Event triggers name their resources by project; any id will do.
        env: { ...process.env, GCLOUD_PROJECT: 'demo-failure-policy' },
    });
    expect(run.status === 0 ? '' : String(run.error || run.stderr)).toBe('');

    const rows = JSON.parse(run.stdout.trim().split('\n').pop());
    expect(rows.length).toBeGreaterThan(100);
    // Anything but "no retry" (`false`, or unset) is refused, a params expression
    // included: it could resolve to `true` at deploy time.
    expect(rows.filter(([, retry]) => retry !== null && retry !== false)).toEqual([]);
}, 70000);
