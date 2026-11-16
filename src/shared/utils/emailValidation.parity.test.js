// src/shared/utils/emailValidation.parity.test.js
//
// PARITY with the server. Whether the server will send to an address is
// `functions/shared/isValidEmail.js`. A screen that decides whether a press can
// reach the server's sender (`canEmailLinkTo`, the Fix recipient form) checks
// with `isWellFormedEmail`; `isValidEmail` here is looser and passes addresses
// the server refuses. `functions/` is CommonJS and deployed on its own, so the
// two cannot be one module: this runs both over one list.

import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import vectors from '../../../functions/shared/isValidEmail.vectors.json';
import { isWellFormedEmail } from './validation';
import { canEmailLinkTo } from './linkEmail';

const require = createRequire(import.meta.url);
const server = require('../../../functions/shared/isValidEmail.js');

const cases = [
    ...vectors.accepted.map((email) => [email, true]),
    ...vectors.refused.map((email) => [email, false]),
];

describe('email addresses, browser and server', () => {
    it.each(cases)('%j: server and browser both say %s', (email, expected) => {
        expect(server.isValidEmail(email)).toBe(expected);
        expect(isWellFormedEmail(email)).toBe(expected);
    });

    it.each(cases)('%j: the Email link button is offered only where the server would send', (email) => {
        // The server trims and lowercases the address before it checks it
        // (`deliverableEmail`, `functions/shared/linkDelivery.js`).
        const asTheServerReadsIt = typeof email === 'string' ? email.trim().toLowerCase() : '';
        expect(canEmailLinkTo(email)).toBe(server.isValidEmail(asTheServerReadsIt));
    });
});
