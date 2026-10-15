// @vitest-environment node
import { describe, expect, it } from 'vitest';
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
