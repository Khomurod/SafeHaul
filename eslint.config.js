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
      ...reactHooks.configs.recommended.rules,
      'react/jsx-uses-vars': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
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
