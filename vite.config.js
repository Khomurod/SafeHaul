import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
import { splitGlyphRegistry } from './src/design-system/icons/splitGlyphRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * The libraries every screen starts with get a chunk of their own. Its bytes
 * change only when a dependency does, or when the application starts or stops
 * using one of their exports (see `minifyInternalExports` below and
 * `nameCommonjsDefaultExports`), so after a release a returning browser still
 * holds the file under the same name and revalidates it (304) instead of
 * downloading it again with the application's code.
 *
 * Only packages the first screen already loads in full: Rollup moves a manual
 * chunk's dependencies into it, so a package with a module that only a later
 * screen needs would put that module into every page's first download. That is
 * why Sentry stays out — its tracing and Replay load later from the same
 * packages — and the icons, which load with the screens that draw them.
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
  // Rollup's CommonJS helpers: React's modules need them, so they go with React.
  if (id === '\0commonjsHelpers.js' || STARTUP_LIBRARIES.includes(pkg)) return 'vendor';
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
 * A CommonJS dependency reaches the application through an ES wrapper whose
 * default export is an expression, and Rollup exports such a value under the
 * local name of the last module that imports it: `react-virtuoso` calls React
 * `E`, the application `React`. A release that only moved the application's
 * code could rename that export, and with it the vendor chunk. Declared first,
 * the value is exported under its declaration's name. Build only.
 */
function nameCommonjsDefaultExports() {
  return {
    name: 'safehaul:name-commonjs-default-exports',
    apply: 'build',
    transform(code, id) {
      if (!id.endsWith('?commonjs-es-import')) return null;
      const named = code.replace(
        /^export default (\/\*@__PURE__\*\/)?getDefaultExportFromCjs\((\w+)\);$/m,
        (_, pure = '', exportsName) => `var ${exportsName}Default = ${pure}getDefaultExportFromCjs(${exportsName});\n`
          + `export { ${exportsName}Default as default };`,
      );
      return named === code ? null : { code: named, map: null };
    },
  };
}

export default defineConfig({
  // In the build only: the glyph registry split one module per glyph, so each
  // screen carries only the glyphs it draws (the plugin's file says why), the
  // Firebase config requested with the page, and dependencies' default exports
  // under fixed names.
  plugins: [react(), splitGlyphRegistry(), preloadFirebaseConfig(), nameCommonjsDefaultExports()],
  // Sentry's own tree-shaking flag: its debug logging leaves the bundle (3 kB of
  // the first download's gzip). Only `debug: true` in `Sentry.init` used it, and
  // no build sets that.
  define: { __SENTRY_DEBUG__: false },
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
      'firebase/storage',
      'firebase/app-check'
    ],
    // exceljs and papaparse are imported only by the bulk-import Web Worker,
    // which the start-up dependency scan does not crawl. Without them here, the
    // dev server discovers them on the first import and reloads the page
    // mid-upload, which failed e2e/lead-intake.spec.cjs on every cold start.
    include: ['pdfjs-dist', 'exceljs', 'papaparse'],
    esbuildOptions: {
      target: 'esnext', // CRITICAL: Allows Top-Level Await for PDF.js
    },
  },
  build: {
    target: 'esnext', // CRITICAL: Ensures production build supports modern JS features
    // No sourcemaps: nothing uploads them to Sentry, and the deploy would only
    // delete them (main.yml). Building them cost a fifth of the build time.
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: chunkFor,
        // Chunks export under the names their code gives, not under short
        // names Rollup mints in the order the other chunks happen to import
        // them: a release that only moved the application's code renamed the
        // vendor chunk's exports, and with them its bytes and its file name.
        // 2.3 kB more gzip in the first download, against the 222 kB of
        // `vendor` a returning browser no longer downloads again.
        minifyInternalExports: false,
      }
    }
  }
})
