import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
import { splitGlyphRegistry } from './src/design-system/icons/splitGlyphRegistry.js';
import { OCR_ASSET_BASE, OCR_ASSET_FILES } from './src/features/company-admin/applicationPrep/extraction/ocrAssets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const requireFromRoot = createRequire(import.meta.url);

/**
 * The libraries every screen starts with get a chunk of their own. Its bytes
 * change only when a dependency does, or when the application starts or stops
 * using one of their exports (`src/tests/viteBuildConfig.test.js` builds two
 * releases and compares), so after a release a returning browser still holds
 * the file under the same name and revalidates it (304) instead of downloading
 * it again with the application's code.
 *
 * Only packages the first screen already loads in full: the bundler moves a
 * group's dependencies into it, so a package with a module that only a later
 * screen needs would put that module into every page's first download. That is
 * why the icons stay out: each loads with the screens that draw it.
 * `check:bundle-budget` refuses the chunk if it imports the entry, whose name
 * changes with every release.
 */
const STARTUP_LIBRARIES = [
  'react', 'react-dom', 'scheduler', 'react-router', 'react-router-dom',
  '@firebase/app', '@firebase/auth', '@firebase/firestore', '@firebase/functions',
];

function packageOf(id) {
  const at = id.lastIndexOf('/node_modules/');
  if (at < 0) return null;
  const [scope, name] = id.slice(at + '/node_modules/'.length).split('/');
  return scope.startsWith('@') ? `${scope}/${name}` : scope;
}

function chunkFor(id) {
  const pkg = packageOf(id);
  if (pkg === 'pdfjs-dist') return 'pdfjs';
  if (STARTUP_LIBRARIES.includes(pkg)) return 'vendor';
  return undefined;
}

/**
 * Starts the Firebase config request with the page instead of after the entry
 * script has downloaded and run: `src/lib/firebase/config.js` waits for it
 * before anything renders. Chromium hands the preloaded response to that fetch,
 * `no-store` and all; a browser that does not just fetches it again, as before.
 * Build only: the dev server has no `/__/firebase/init.json`.
 */
function preloadFirebaseConfig() {
  return {
    name: 'safehaul:preload-firebase-config',
    apply: 'build',
    transformIndexHtml: () => [{
      tag: 'link',
      attrs: { rel: 'preload', href: '/__/firebase/init.json', as: 'fetch', crossorigin: 'anonymous' },
      injectTo: 'head',
    }],
  };
}

/**
 * Serves the in-browser OCR engine from this site instead of the CDN tesseract.js
 * defaults to (`ocrAssets.js` says why). Each file is copied from `node_modules`,
 * so nothing is committed and the bytes follow the installed version: into the
 * build at its URL, and from the dev server at the same URL, so dev, the E2E run
 * and Hosting load the same paths. The build refuses a tesseract.js version that
 * `OCR_ASSET_BASE` does not name.
 */
function serveOcrAssets() {
  const files = Object.entries(OCR_ASSET_FILES).map(([served, source]) => ({
    url: `${OCR_ASSET_BASE}/${served}`,
    path: requireFromRoot.resolve(source),
    type: served.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/gzip',
  }));
  return {
    name: 'safehaul:ocr-assets',
    buildStart() {
      const { version } = requireFromRoot('tesseract.js/package.json');
      if (OCR_ASSET_BASE !== `/ocr/tesseract-${version}`) {
        this.error(`OCR_ASSET_BASE is ${OCR_ASSET_BASE} but tesseract.js ${version} is installed: update ocrAssets.js`);
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = files.find((entry) => entry.url === (req.url || '').split('?')[0]);
        if (!file) return next();
        res.setHeader('Content-Type', file.type); // importScripts refuses a non-JavaScript type
        res.end(readFileSync(file.path));
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({ type: 'asset', fileName: file.url.slice(1), source: readFileSync(file.path) });
      }
    },
  };
}

export default defineConfig({
  // In the build only: the glyph registry split one module per glyph, so each
  // screen carries only the glyphs it draws (the plugin's file says why), and
  // the Firebase config requested with the page. The OCR engine's files are
  // served in the build and on the dev server alike.
  plugins: [react(), splitGlyphRegistry(), preloadFirebaseConfig(), serveOcrAssets()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true, // CRITICAL: Fail if port 5000 is in use, don't silently switch to 5001
    allowedHosts: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@app': path.resolve(__dirname, './src/app'),
      '@features': path.resolve(__dirname, './src/features'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@design-system': path.resolve(__dirname, './src/design-system'),
      '@lib': path.resolve(__dirname, './src/lib'),
    },
  },
  optimizeDeps: {
    exclude: [
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
      'firebase/functions',
      'firebase/storage'
    ],
    // exceljs and papaparse are imported only by the bulk-import Web Worker,
    // which the start-up dependency scan does not crawl. Without them here, the
    // dev server discovers them on the first import and reloads the page
    // mid-upload, which failed e2e/lead-intake.spec.cjs on every cold start.
    include: ['pdfjs-dist', 'exceljs', 'papaparse'],
  },
  build: {
    target: 'esnext', // CRITICAL: Ensures production build supports modern JS features
    // No sourcemaps: nothing uses them, and the deploy would only delete them
    // (main.yml). Building them cost a fifth of the build time.
    sourcemap: false,
    rolldownOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        codeSplitting: { groups: [{ name: chunkFor }] },
      }
    }
  }
})
