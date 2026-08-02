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
                // Baseline measured 2026-06 (stmts 17.5 / br 14.8 / fns 14.9 /
                // lines 17.9); set ~1.5% below so the gate passes today but blocks
                // regressions. Ratchet upward over time, never down.
                statements: 16,
                branches: 13,
                functions: 13,
                lines: 16,
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
