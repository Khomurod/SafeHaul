// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import viteConfig from '../../vite.config.js';
import firebaseConfigSource from '../lib/firebase/config.js?raw';

const plugins = viteConfig.plugins.flat();
const chunkFor = viteConfig.build.rolldownOptions.output.codeSplitting.groups[0].name;
const nm = (path) => `/home/app/node_modules/${path}`;

describe('the production build', () => {
    it('puts the start-up libraries in a chunk of their own', () => {
        for (const id of [
            nm('react/cjs/react.production.js'), nm('react-dom/cjs/react-dom-client.production.js'),
            nm('scheduler/cjs/scheduler.production.js'), nm('react-router/dist/production/index.mjs'),
            nm('@firebase/auth/dist/esm2017/index-abc.js'), nm('@firebase/firestore/dist/index.esm2017.js'),
        ]) expect(chunkFor(id), id).toBe('vendor');
    });

    it('leaves out what loads later, and the application', () => {
        // Sentry's tracing and Replay, Storage and the icons load after the first
        // screen from these packages; in the vendor chunk they would load with it.
        for (const id of [
            nm('@sentry/core/build/esm/index.js'), nm('@firebase/storage/dist/index.esm2017.js'),
            nm('lucide-react/dist/esm/icons/trash-2.js'), nm('firebase/storage/dist/esm/index.esm.js'),
            '/home/app/src/App.jsx', '\0virtual:safehaul-glyph/Trash2',
        ]) expect(chunkFor(id), id).toBeUndefined();
        expect(chunkFor(nm('pdfjs-dist/build/pdf.mjs'))).toBe('pdfjs');
    });

    it('preloads the Firebase config that config.js fetches, in builds only', () => {
        const preload = plugins.find((p) => p?.name === 'safehaul:preload-firebase-config');
        expect(preload.apply).toBe('build');
        expect(preload.transformIndexHtml()).toEqual([{
            tag: 'link',
            attrs: { rel: 'preload', href: '/__/firebase/init.json', as: 'fetch', crossorigin: 'anonymous' },
            injectTo: 'head',
        }]);
        expect(firebaseConfigSource).toContain("fetch('/__/firebase/init.json'");
    });
});

describe('the vendor chunk after a release', () => {
    // One library and an application whose chunks import its exports in two
    // orders, as any release that moves the application's code around does.
    // Under Rollup the vendor chunk's exports took short names in the order the
    // application's chunks imported them, and a CommonJS default export took
    // its last importer's local name, so the file was renamed; two build-only
    // workarounds held it. Rolldown (Vite 8) names both the same either way,
    // with its defaults: these builds prove it with the same split as the app.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-names-'));
    fs.mkdirSync(path.join(root, 'node_modules/examplelib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/examplelib/package.json'),
        JSON.stringify({ name: 'examplelib', type: 'module', main: 'index.js' }));
    fs.writeFileSync(path.join(root, 'node_modules/examplelib/index.js'),
        "export const getAlpha = () => 'alpha';\nexport const getBeta = () => 'beta';\nexport const getGamma = () => 'gamma';\n");
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    /** The vendor chunk of a build whose entry draws `first` and whose lazy screen draws `rest`. */
    async function vendorChunk([first, ...rest]) {
        const dir = fs.mkdtempSync(path.join(root, 'app-'));
        fs.writeFileSync(path.join(dir, 'entry.js'),
            `import { ${first} } from 'examplelib';\nconsole.log(${first}());\nimport('./screen.js');\n`);
        fs.writeFileSync(path.join(dir, 'screen.js'),
            `import { ${rest.join(', ')} } from 'examplelib';\nconsole.log(${rest.map((name) => `${name}()`).join(', ')});\n`);
        const output = await build({
            root, configFile: false, logLevel: 'silent',
            build: {
                write: false,
                rolldownOptions: {
                    input: path.join(dir, 'entry.js'),
                    output: {
                        codeSplitting: { groups: [{ name: (id) => (id.includes('/node_modules/examplelib/') ? 'vendor' : undefined) }] },
                    },
                },
            },
        });
        const chunks = (Array.isArray(output) ? output[0] : output).output;
        return chunks.find((chunk) => chunk.type === 'chunk' && chunk.name === 'vendor');
    }

    it('keeps its bytes and its name whichever order the application imports its exports in', async () => {
        expect(viteConfig.build.rolldownOptions.output.minifyInternalExports).toBeUndefined();
        const before = await vendorChunk(['getAlpha', 'getBeta', 'getGamma']);
        const after = await vendorChunk(['getGamma', 'getAlpha', 'getBeta']);

        expect(after.code).toBe(before.code);
        expect(after.fileName).toBe(before.fileName);
    }, 60_000);

    // A CommonJS library, as React is, whose default export the application's
    // modules import under different local names, as React's is (`E` in
    // react-virtuoso, `React` in the application).
    fs.mkdirSync(path.join(root, 'node_modules/examplecjs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/examplecjs/package.json'),
        JSON.stringify({ name: 'examplecjs', main: 'index.js' }));
    fs.writeFileSync(path.join(root, 'node_modules/examplecjs/index.js'),
        "module.exports = { greet: function () { return 'hello'; } };\n");

    /** The vendor chunk of a build whose entry imports the library as `first` and whose lazy screen imports it as `second`. */
    async function commonjsVendorChunk([first, second]) {
        const dir = fs.mkdtempSync(path.join(root, 'cjs-app-'));
        fs.writeFileSync(path.join(dir, 'entry.js'),
            `import ${first} from 'examplecjs';\nconsole.log(${first}.greet());\nimport('./screen.js');\n`);
        fs.writeFileSync(path.join(dir, 'screen.js'),
            `import ${second} from 'examplecjs';\nconsole.log(${second}.greet());\n`);
        const output = await build({
            root, configFile: false, logLevel: 'silent',
            build: {
                write: false,
                rolldownOptions: {
                    input: path.join(dir, 'entry.js'),
                    output: {
                        codeSplitting: { groups: [{ name: (id) => (id.includes('/node_modules/examplecjs/') ? 'vendor' : undefined) }] },
                    },
                },
            },
        });
        const chunks = (Array.isArray(output) ? output[0] : output).output;
        return chunks.find((chunk) => chunk.type === 'chunk' && chunk.name === 'vendor');
    }

    it('keeps a CommonJS library’s default export under one name, whichever module imports it last', async () => {
        const before = await commonjsVendorChunk(['Library', 'lib']);
        const after = await commonjsVendorChunk(['lib', 'Library']);

        expect(after.code).toBe(before.code);
        expect(after.fileName).toBe(before.fileName);
    }, 60_000);
});
