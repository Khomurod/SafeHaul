import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'happy-dom',
        setupFiles: './src/tests/setup.js',
        css: true,
        // Cloud Functions use Jest (`cd functions && npm test`). Do not pick up those files here.
        include: ['src/**/*.{test,spec}.{js,mjs,jsx,tsx}'],
        exclude: ['**/node_modules/**', 'e2e/**'],
        // E3: coverage baseline-ratchet. Thresholds are set AT/just-below the
        // current baseline so the gate passes today but blocks regressions; raise
        // them as coverage improves. Run via `npm run test:coverage`.
        coverage: {
            provider: 'v8',
            reporter: ['text-summary', 'json-summary'],
            include: ['src/**/*.{js,jsx}'],
            exclude: [
                'src/**/*.{test,spec}.{js,jsx}',
                'src/tests/**',
                '**/*.config.*',
                'src/main.jsx',
                // Storybook catalog examples and their fixtures. They document the
                // design system and ship nowhere; counting them as application code
                // would move the coverage baseline without changing what is tested.
                // They are exercised directly by
                // `src/tests/designSystemStories.a11y.test.jsx`.
                'src/**/*.stories.jsx',
                'src/design-system/stories/fixtures.js',
            ],
            thresholds: {
                // Re-measured 2026-09-06: stmts 73.2 / br 69.4 / fns 75.1 /
                // lines 74.7. The June 2026 baseline (17.5 / 14.8 / 14.9 / 17.9)
                // had been left in place for three months while coverage rose to
                // four times the gate, so deleting half the tests would have
                // passed. Set ~3 points under today's numbers so the gate passes
                // now and blocks a real drop. Ratchet upward over time, never down.
                statements: 70,
                branches: 66,
                functions: 72,
                lines: 72,
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@app': path.resolve(__dirname, './src/app'),
            '@features': path.resolve(__dirname, './src/features'),
            '@shared': path.resolve(__dirname, './src/shared'),
            // Present in `vite.config.js` and `jsconfig.json` but previously missing
            // here, because no test imported it by alias until the story catalog did.
            '@design-system': path.resolve(__dirname, './src/design-system'),
            '@lib': path.resolve(__dirname, './src/lib'),
        },
    },
});
