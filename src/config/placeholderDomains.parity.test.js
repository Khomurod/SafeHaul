// src/config/placeholderDomains.parity.test.js
//
// PARITY with the server. `placeholderDomains.js` and
// `functions/shared/placeholderDomains.js` are one rule written twice:
// `functions/` is CommonJS and deployed on its own, so they cannot be one
// module. They must agree on which addresses are made up. The site gives an
// imported lead without an email such an address and skips the missed-call email
// to it; the server refuses to email it, and driver sync treats it as no address
// at all. Both copies judge one table of addresses here.

import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

import * as site from './placeholderDomains';

const require = createRequire(import.meta.url);
const server = require('../../functions/shared/placeholderDomains.js');

const DOMAINS = [...new Set([...site.PLACEHOLDER_DOMAINS, ...server.PLACEHOLDER_DOMAINS])];

const ADDRESSES = [
    // Missing, blank, or not text at all.
    undefined, null, '', '   ', 0, 42, {}, ['someone@placeholder.com'],
    // Every known domain as made, shouted, padded and bare; then near misses.
    ...DOMAINS.flatMap((domain) => [
        `someone@${domain}`,
        `SOMEONE@${domain.toUpperCase()}`,
        ` someone@${domain}\n`,
        `@${domain}`,
        domain,
        `someone@mail.${domain}`,
        `someone@not${domain}`,
        `someone@${domain}.example.com`,
        `someone@${domain}.`,
        `${domain}@example.com`,
    ]),
    'someone@example.com',
    'Someone@Example.COM',
];

describe('parity with functions/shared/placeholderDomains.js', () => {
    it('makes addresses on the same domain and recognises the same list', () => {
        expect(site.PLACEHOLDER_DOMAIN).toBe(server.PLACEHOLDER_DOMAIN);
        expect(site.PLACEHOLDER_DOMAINS).toEqual(server.PLACEHOLDER_DOMAINS);
    });

    it.each(ADDRESSES.map((address) => [address]))('judges %j the same way', (address) => {
        expect(site.isPlaceholderEmail(address)).toBe(server.isPlaceholderEmail(address));
    });

    it('recognises on the server the addresses the site makes', () => {
        // As the lead import and the lead upload write them.
        expect(server.isPlaceholderEmail(`placeholder_1a2b3c@${site.PLACEHOLDER_DOMAIN}`)).toBe(true);
        expect(server.isPlaceholderEmail(`no_email_1789171200000_abcde@${site.PLACEHOLDER_DOMAIN}`)).toBe(true);
    });
});
