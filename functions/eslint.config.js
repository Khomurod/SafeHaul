'use strict';

/**
 * ESLint flat config for the Cloud Functions tree (CommonJS).
 *
 * Migrated from `.eslintrc.js` on 2026-09-08 for ESLint 10, which reads only
 * this format — `ESLINT_USE_FLAT_CONFIG=false` and `--ext` are gone. The
 * policy is unchanged: `eslint:recommended`, then eslint-config-google's
 * rules, then the local overrides, in that order, so a severity-only override
 * keeps the options of the layer beneath it exactly as the eslintrc cascade
 * did (`no-unused-vars: 'error'` still carries google's `{ args: 'none' }`).
 *
 * eslint-config-google is a legacy-format config, so its `rules` object is
 * taken directly and two rules it sets are dropped: `valid-jsdoc` and
 * `require-jsdoc`, both removed from ESLint core and both already "off" here.
 *
 * Measured before the switch: 0 errors, 0 warnings under ESLint 8 and the
 * legacy file. The same after it, under ESLint 10 and this file.
 */
const js = require('@eslint/js');
const globals = require('globals');
const google = require('eslint-config-google');

// eslint-disable-next-line no-unused-vars
const { 'valid-jsdoc': _validJsdoc, 'require-jsdoc': _requireJsdoc, ...googleRules } = google.rules;

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
        rules: googleRules,
    },
    {
        rules: {
            // Keep meaningful checks
            'no-restricted-globals': ['error', 'name', 'length'],
            // E4: dead imports/vars are an error (was "warn"). The superseded
            // .eslintrc.json carried this intent but ESLint never read it
            // (.eslintrc.js won the cascade), so it never enforced — now it does.
            // ESLint 10's `recommended` adds rules ESLint 8's did not have. Adopting
            // them is a change to the functions code, measured on 2026-09-08 at 24
            // sites: no-useless-assignment 12, preserve-caught-error 6, and
            // no-unused-vars on `catch (e)` bindings 6 — ESLint 9 changed that rule's
            // `caughtErrors` default from "none" to "all". This migration keeps the
            // policy ESLint 8 enforced; those three are the follow-up, deliberately.
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
            'no-useless-assignment': 'off',
            'preserve-caught-error': 'off',
            'no-empty': 'warn',
            'prefer-const': 'warn',
            'no-undef': 'error',

            // Downgrade style-only rules
            'quote-props': 'off',
            'no-multiple-empty-lines': 'off',
            'prefer-arrow-callback': 'off',
            'quotes': 'off',
            'object-curly-spacing': 'off',
            'max-len': 'off',
            'comma-dangle': 'off',
            'indent': 'off',
            'camelcase': 'off',
            'linebreak-style': 'off',
            'new-cap': 'off',
            'no-trailing-spaces': 'off',
            'eol-last': 'off',
            'padded-blocks': 'off',
            'arrow-parens': 'off',
            'space-before-function-paren': 'off',
            'operator-linebreak': 'off',
            'guard-for-in': 'off',
            'curly': 'off',
            'block-spacing': 'off',
            'brace-style': 'off',
            'keyword-spacing': 'off',
            'space-before-blocks': 'off',
            'no-multi-spaces': 'off',
            'semi': 'off',
        },
    },
    {
        files: ['test/**/*.js', '**/*.test.js'],
        languageOptions: { globals: { ...globals.node, ...globals.jest } },
    },
];
