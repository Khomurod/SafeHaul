// The deployed entry point, loaded under plain Node the way the runtime and the
// deploy load it, and three things that must be true of it. One child process
// reads all three, because each load is a whole cold start.
//
// It loads. Nearly every suite mocks `firebaseAdmin.js`, so a call the wrapper
// does not provide passes every test and throws only in production;
// `firebaseAdmin.test.js` holds the wrapper, and this load is where the real
// SDK (and its ESM-only `jose`) runs.
//
// No function is below the memory a cold start needs. A function loads its own
// module on a cold start (`functionTarget.test.js`), but one whose name
// index.js does not export loads all of it, and a 1st Gen function at 128MB
// gets about 200 MHz of CPU to do that. On firebase-admin 14 that load no longer
// fits the start-up limit, so 256MB stays the floor.
//
// No function has a failure policy the deploy would refuse. The CI deploy runs
// `firebase deploy --non-interactive` without `--force`, and firebase-tools
// refuses to deploy a function that newly retries on failure without it ("Pass
// the --force option to deploy functions with a failure policy"): the whole
// deploy stops, not just that function. `--force` would also set up an Artifact
// Registry cleanup policy and accept unsafe updates on its own, so the pipeline
// does not pass it. A function that must not lose its event tries again within
// its run instead (`drafts/expired.js`).
//
// Read from the entry point itself, so a setting made through a shared options
// object or a constant is seen as well as a literal.

const path = require('path');
const { spawnSync } = require('child_process');

const FUNCTIONS_DIR = path.join(__dirname, '..', '..');
const MEMORY_FLOOR_MB = 256;

describe('the deployed entry point', () => {
    let run;
    let rows;

    beforeAll(() => {
        const script = [
            "const exported = require('./index.js');",
            'const rows = Object.entries(exported).map(([name, fn]) => [',
            '    name, fn.__endpoint.availableMemoryMb ?? null, fn.__endpoint.eventTrigger?.retry ?? null,',
            ']);',
            "process.stdout.write('\\n' + JSON.stringify(rows));",
        ].join('\n');
        run = spawnSync(process.execPath, ['-e', script], {
            cwd: FUNCTIONS_DIR,
            encoding: 'utf8',
            timeout: 60000,
            // Event triggers name their resources by project; any id will do.
            env: { ...process.env, GCLOUD_PROJECT: 'demo-entry-point' },
        });
        rows = run.status === 0 ? JSON.parse(run.stdout.trim().split('\n').pop()) : [];
    }, 70000);

    it('loads under plain Node', () => {
        // A failed load reports Node's own error (or the spawn error) as the received value.
        expect(run.status === 0 ? '' : String(run.error || run.stderr)).toBe('');
        expect(rows.length).toBeGreaterThan(100);
    });

    it('configures no function below the memory a cold start needs', () => {
        expect(rows.length).toBeGreaterThan(100);
        // `null` is the platform default, which is 256MB on both generations. Anything
        // that is not a plain number (a params expression, say) cannot be checked here,
        // so it is refused rather than passed.
        const unchecked = rows.filter(([, mb]) => mb !== null && !(typeof mb === 'number' && mb >= MEMORY_FLOOR_MB));
        expect(unchecked).toEqual([]);
    });

    it('configures no function the deploy would refuse for its failure policy', () => {
        expect(rows.length).toBeGreaterThan(100);
        // Anything but "no retry" (`false`, or unset) is refused, a params expression
        // included: it could resolve to `true` at deploy time.
        expect(rows.filter(([, , retry]) => retry !== null && retry !== false)).toEqual([]);
    });
});
