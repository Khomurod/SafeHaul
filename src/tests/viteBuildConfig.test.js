// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import viteConfig from '../../vite.config.js';
import firebaseConfigSource from '../lib/firebase/config.js?raw';

const plugins = viteConfig.plugins.flat();
const chunkFor = viteConfig.build.rollupOptions.output.manualChunks;
const nm = (path) => `/home/app/node_modules/${path}`;

describe('the production build', () => {
    it('puts the start-up libraries in a chunk of their own', () => {
        for (const id of [
            nm('react/cjs/react.production.js'), nm('react-dom/cjs/react-dom-client.production.js'),
            nm('scheduler/cjs/scheduler.production.js'), nm('react-router/dist/production/index.mjs'),
            nm('@firebase/auth/dist/esm2017/index-abc.js'), nm('@firebase/firestore/dist/index.esm2017.js'),
            '\0commonjsHelpers.js',
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
    // Exports that share a first letter are the ones whose short names Rollup
    // mints in the order the application's chunks import them.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-names-'));
    fs.mkdirSync(path.join(root, 'node_modules/examplelib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/examplelib/package.json'),
        JSON.stringify({ name: 'examplelib', type: 'module', main: 'index.js' }));
    fs.writeFileSync(path.join(root, 'node_modules/examplelib/index.js'),
        "export const getAlpha = () => 'alpha';\nexport const getBeta = () => 'beta';\nexport const getGamma = () => 'gamma';\n");
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    /** The vendor chunk of a build whose entry draws `first` and whose lazy screen draws `rest`. */
    async function vendorChunk([first, ...rest], minifyInternalExports) {
        const dir = fs.mkdtempSync(path.join(root, 'app-'));
        fs.writeFileSync(path.join(dir, 'entry.js'),
            `import { ${first} } from 'examplelib';\nconsole.log(${first}());\nimport('./screen.js');\n`);
        fs.writeFileSync(path.join(dir, 'screen.js'),
            `import { ${rest.join(', ')} } from 'examplelib';\nconsole.log(${rest.map((name) => `${name}()`).join(', ')});\n`);
        const output = await build({
            root, configFile: false, logLevel: 'silent',
            build: {
                write: false,
                rollupOptions: {
                    input: path.join(dir, 'entry.js'),
                    output: {
                        manualChunks: (id) => (id.includes('/node_modules/examplelib/') ? 'vendor' : undefined),
                        minifyInternalExports,
                    },
                },
            },
        });
        const chunks = (Array.isArray(output) ? output[0] : output).output;
        return chunks.find((chunk) => chunk.type === 'chunk' && chunk.name === 'vendor');
    }

    const appBuild = viteConfig.build.rollupOptions.output.minifyInternalExports;

    it('keeps its bytes and its name with the build’s export names', async () => {
        const before = await vendorChunk(['getAlpha', 'getBeta', 'getGamma'], appBuild);
        const after = await vendorChunk(['getGamma', 'getAlpha', 'getBeta'], appBuild);

        expect(after.code).toBe(before.code);
        expect(after.fileName).toBe(before.fileName);
    }, 60_000);

    it('would be renamed with the short names Rollup mints by default', async () => {
        const before = await vendorChunk(['getAlpha', 'getBeta', 'getGamma'], true);
        const after = await vendorChunk(['getGamma', 'getAlpha', 'getBeta'], true);

        expect(after.fileName).not.toBe(before.fileName);
    }, 60_000);
});
