import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  // .claude/ holds local agent worktrees (full repo copies) — linting them
  // double-reports every file and trips on their vendored public/*.min.mjs.
  // `storybook-static/` is the Storybook build output (gitignored, like `dist/`).
  // Linting a minified bundle reports thousands of meaningless errors.
  { ignores: ['**/dist/**', '**/storybook-static/**', '**/functions/**', '**/public/*.min.mjs', '.claude/**', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,cjs,mjs}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest
      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Deliberately NOT `...reactHooks.configs.recommended.rules`. Under
      // eslint-plugin-react-hooks 5 that spread was exactly the two rules declared
      // below; under 7 it also switches on the seven React Compiler rules
      // (set-state-in-effect, refs, immutability, purity,
      // preserve-manual-memoization, static-components, globals) as errors —
      // measured on 2026-09-08 at 89 errors across 69 files. Adopting those is a
      // migration of component code, not a linter bump, so the policy here stays
      // what it was and the compiler rules become a deliberate opt-in when that
      // migration is scheduled.
      'react/jsx-uses-vars': 'warn',
      'react/jsx-no-undef': 'error',
      // An error, not a warning, since 2026-09-06: the three violations this
      // rule reported were all one early return in `DocumentsManager.jsx`, and it
      // crashed the screen when the E-Docs flag changed on a mounted view. A
      // conditional hook is never a style choice; React throws at run time.
      'react-hooks/rules-of-hooks': 'error',
      'no-case-declarations': 'warn',
      'no-unused-vars': ['warn', {
        varsIgnorePattern: '^React$',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'react-refresh/only-export-components': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'no-prototype-builtins': 'warn',
      'no-constant-condition': 'warn',
      'no-empty': 'warn',
      'no-restricted-imports': ['warn', {
        patterns: [
          {
            group: ['@features/company-admin/components/modals/driver-dossier/*'],
            message: 'Import cross-feature UI from a feature public API (for example @features/company-admin).',
          },
          {
            group: ['@features/campaigns/CampaignsDashboard'],
            message: 'Import from @features/campaigns public API instead of deep implementation paths.',
          },
        ],
      }],
    },
  },
]
