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
        "no-restricted-globals": ["error", "name", "length"],
        "prefer-arrow-callback": "error",
        "quotes": ["error", "double", { "allowTemplateLiterals": true }],
        "object-curly-spacing": ["error", "always"],
        "max-len": "off",
        "require-jsdoc": "off",
        "valid-jsdoc": "off",
        "comma-dangle": "off",
        "indent": "off",
        "no-unused-vars": "warn",
        "camelcase": "off",
    },
    parserOptions: {
        ecmaVersion: 2020,
    },
};
