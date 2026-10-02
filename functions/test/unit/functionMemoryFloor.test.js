// Every function loads the whole of index.js on a cold start, and a 1st Gen
// function at 128MB gets about 200 MHz of CPU to do it. On firebase-admin 14 that
// load no longer fits the start-up limit, so 256MB is the floor. Read from the
// deployed entry point itself, under plain Node, so a memory set through a shared
// options object or a constant is seen as well as a literal.

const path = require('path');
const { spawnSync } = require('child_process');

const FUNCTIONS_DIR = path.join(__dirname, '..', '..');
const MEMORY_FLOOR_MB = 256;

it('configures no function below the memory a cold start needs', () => {
    const script = [
        "const exported = require('./index.js');",
        'const rows = Object.entries(exported)',
        '    .map(([name, fn]) => [name, fn.__endpoint.availableMemoryMb ?? null]);',
        "process.stdout.write('\\n' + JSON.stringify(rows));",
    ].join('\n');
    const run = spawnSync(process.execPath, ['-e', script], {
        cwd: FUNCTIONS_DIR,
        encoding: 'utf8',
        timeout: 60000,
        // Event triggers name their resources by project; any id will do.
        env: { ...process.env, GCLOUD_PROJECT: 'demo-memory-floor' },
    });
    expect(run.status === 0 ? '' : String(run.error || run.stderr)).toBe('');

    const rows = JSON.parse(run.stdout.trim().split('\n').pop());
    expect(rows.length).toBeGreaterThan(100);
    // `null` is the platform default, which is 256MB on both generations.
    expect(rows.filter(([, mb]) => mb !== null && mb < MEMORY_FLOOR_MB)).toEqual([]);
}, 70000);
