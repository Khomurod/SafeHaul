module.exports = {
    root: true,
    env: {
        es2020: true,
        node: true,
    },
    extends: [
        "eslint:recommended",
        "google",
    ],
    rules: {
        // Keep meaningful checks
        "no-restricted-globals": ["error", "name", "length"],
        // E4: dead imports/vars are an error (was "warn"). The superseded
        // .eslintrc.json carried this intent but ESLint never read it
        // (.eslintrc.js wins the cascade), so it never enforced — now it does.
        "no-unused-vars": "error",
        "no-empty": "warn",
        "prefer-const": "warn",
        "no-undef": "error",

        // Downgrade style-only rules
        "quote-props": "off",
        "no-multiple-empty-lines": "off",
        "prefer-arrow-callback": "off",
        "quotes": "off",
        "object-curly-spacing": "off",
        "max-len": "off",
        "require-jsdoc": "off",
        "valid-jsdoc": "off",
        "comma-dangle": "off",
        "indent": "off",
        "camelcase": "off",
        "linebreak-style": "off",
        "new-cap": "off",
        "no-trailing-spaces": "off",
        "eol-last": "off",
        "padded-blocks": "off",
        "arrow-parens": "off",
        "space-before-function-paren": "off",
        "operator-linebreak": "off",
        "guard-for-in": "off",
        "curly": "off",
        "block-spacing": "off",
        "brace-style": "off",
        "keyword-spacing": "off",
        "space-before-blocks": "off",
        "no-multi-spaces": "off",
        "semi": "off",
    },
    overrides: [
        {
            files: ["test/**/*.js", "**/*.test.js"],
            env: {
                jest: true,
            },
        },
    ],
    parserOptions: {
        ecmaVersion: 2020,
    },
};
