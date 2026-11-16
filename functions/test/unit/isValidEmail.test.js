/**
 * The server's rule for an address it will send to, over the shared vectors.
 * The browser's check for a press that reaches a sender (`isWellFormedEmail`)
 * runs the same list in `src/shared/utils/emailValidation.parity.test.js`, so
 * a change to either rule fails until the other matches.
 */
const vectors = require('../../shared/isValidEmail.vectors.json');
const { isValidEmail } = require('../../shared/isValidEmail');

describe('isValidEmail — shared vectors', () => {
    it.each(vectors.accepted)('accepts %j', (email) => {
        expect(isValidEmail(email)).toBe(true);
    });

    it.each(vectors.refused)('refuses %j', (email) => {
        expect(isValidEmail(email)).toBe(false);
    });
});
