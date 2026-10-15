/**
 * Loads the entry point the way Cloud does for one function, under plain Node,
 * for `functionTarget.test.js`. Run from `functions/` with a JSON array of
 * export names:
 *
 *   node test/helpers/functionTargetLoads.js '["initBulkSession", "companyApi"]'
 *
 * It loads `index.js` first under the FUNCTION_TARGET it was started with (none:
 * in full), then once per name with FUNCTION_TARGET set to it, dropping the
 * `functions/` source between loads so each name starts on that code alone.
 * `firebaseAdmin.js` stays loaded: Firestore takes its settings once per process,
 * and each load is checked to require it first instead. Prints one line of JSON:
 * what the first load and each name exported.
 */
const path = require('path');

const root = process.cwd();
const indexPath = path.join(root, 'index.js');
const adminPath = path.join(root, 'firebaseAdmin.js');
const isOwnSource = (file) => file.startsWith(root + path.sep) && !file.includes(`${path.sep}node_modules${path.sep}`);
const ownFiles = () => Object.keys(require.cache).filter(isOwnSource).length;

function load(target) {
    for (const file of Object.keys(require.cache)) {
        if (isOwnSource(file) && file !== adminPath) delete require.cache[file];
    }
    if (target) process.env.FUNCTION_TARGET = target;
    else delete process.env.FUNCTION_TARGET;
    const exported = require(indexPath);
    const names = Object.keys(exported);
    return {
        names,
        endpoints: Object.fromEntries(names.map((name) => [name, JSON.stringify(exported[name].__endpoint)])),
        adminFirst: require.cache[indexPath].children[0]?.id === adminPath,
        ownFiles: ownFiles(),
    };
}

const first = load(process.env.FUNCTION_TARGET || '');
const alone = Object.fromEntries(JSON.parse(process.argv[2] || '[]').map((name) => [name, load(name)]));
process.stdout.write(`\n${JSON.stringify({ first, alone })}`);
process.exit(0);
