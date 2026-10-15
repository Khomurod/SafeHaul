// What one function loads on a cold start. In Cloud every function runs in its
// own instance, and the runtime names it in FUNCTION_TARGET: the export it calls.
// `index.js` then loads that export's module only. A function loaded alone must
// be the same function as in the full load the deploy reads, and must start on
// the shared Admin app and its Firestore settings (`firebaseAdmin.js`:
// `ignoreUndefinedProperties`). A name `index.js` does not export loads
// everything, as before.
//
// Each line is checked for the name it asks for, and each module is loaded
// alone through one of its functions (what one function of a module needs at
// load, all its functions need), all in one plain Node process
// (`test/helpers/functionTargetLoads.js`). Two more cold starts run in a process
// of their own: a function alone, and a name nobody exports.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FUNCTIONS_DIR = path.join(__dirname, '..', '..');
const INDEX_SOURCE = fs.readFileSync(path.join(FUNCTIONS_DIR, 'index.js'), 'utf8');
const LAZY_LINE = /wanted\('(\w+)'\)\) exports\.(\w+) = require\('([^']+)'\)\.(\w+);/g;
const lines = [...INDEX_SOURCE.matchAll(LAZY_LINE)].map(([, asked, name, module]) => ({ asked, name, module }));
// One function per module: the first that module's lines export.
const samples = [...new Map(lines.map((line) => [line.module, line.name])).values()];
const ALONE = 'parseCdlWithGroq'; // the applicant's CDL photo reader, a 1st Gen callable
const UNKNOWN = 'notAnExportedFunction';

function run(target, names) {
    return new Promise((resolve) => {
        const env = { ...process.env, GCLOUD_PROJECT: 'demo-function-target' };
        delete env.FUNCTION_TARGET;
        if (target) env.FUNCTION_TARGET = target;
        const child = spawn(process.execPath, ['test/helpers/functionTargetLoads.js', JSON.stringify(names)], { cwd: FUNCTIONS_DIR, env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('close', (status) => {
            resolve(status === 0
                ? JSON.parse(stdout.trim().split('\n').pop())
                : { error: stderr || `exit ${status}` });
        });
    });
}

describe('the function a cold start loads', () => {
    let sweep;
    let one;
    let unknown;

    beforeAll(async () => {
        // A start with FUNCTION_TARGET set loads the entry point first under that name.
        [sweep, one, unknown] = await Promise.all([run('', samples), run(ALONE, []), run(UNKNOWN, [])]);
    }, 120000);

    it('reads every export from a line that asks for that same name', () => {
        expect(lines.length).toBeGreaterThan(100);
        expect(lines.filter((line) => line.asked !== line.name)).toEqual([]);
        // Every export in the file loads this way.
        expect(lines.length).toBe([...INDEX_SOURCE.matchAll(/exports\.(\w+)\s*=/g)].length);
    });

    it('loads everything when no function is named', () => {
        expect(sweep.error).toBeUndefined();
        expect([...sweep.first.names].sort()).toEqual(lines.map((line) => line.name).sort());
        expect(sweep.first.adminFirst).toBe(true);
    });

    it('gives each module\'s function its own export alone, the same function, on less code', () => {
        expect(samples.length).toBeGreaterThan(40);
        for (const name of samples) {
            const alone = sweep.alone[name];
            expect({ name, names: alone.names }).toEqual({ name, names: [name] });
            expect({ name, endpoint: alone.endpoints[name] }).toEqual({ name, endpoint: sweep.first.endpoints[name] });
            expect({ name, adminFirst: alone.adminFirst }).toEqual({ name, adminFirst: true });
            expect({ name, fewer: alone.ownFiles < sweep.first.ownFiles }).toEqual({ name, fewer: true });
        }
    });

    it('starts one function cold on its own module', () => {
        expect(one.error).toBeUndefined();
        expect(one.first.names).toEqual([ALONE]);
        expect(one.first.endpoints[ALONE]).toEqual(sweep.first.endpoints[ALONE]);
        expect(one.first.adminFirst).toBe(true);
    });

    it('loads everything for a name it does not export', () => {
        expect(unknown.error).toBeUndefined();
        expect([...unknown.first.names].sort()).toEqual([...sweep.first.names].sort());
    });
});
