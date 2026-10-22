import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as site from './previousEmployerRelease';

/*
 * One release, three places: the consent step the applicant signs under, the
 * server's request PDF and the browser's VOE document. The server's own test
 * checks its copy against the consent step; this one runs with the site's
 * tests, so a change to either copy, or to the consent step, fails here.
 */
const require = createRequire(import.meta.url);
const server = require('../../../functions/shared/previousEmployerRelease.js');
const consentStep = readFileSync(
    resolve(process.cwd(), 'src/features/driver-app/components/application/steps/Step9_Consent.jsx'),
    'utf8',
);
const squash = (value) => value.replace(/\s+/g, ' ');

describe('previous-employer release parity', () => {
    it('holds the server copy word for word', () => {
        expect(site.RELEASE_PARAGRAPHS).toEqual(server.RELEASE_PARAGRAPHS);
        expect(site.RELEASE_RIGHTS).toEqual(server.RELEASE_RIGHTS);
        expect(site.RELEASE_NOTES).toEqual(server.RELEASE_NOTES);
        expect(site.RELEASE_WORDING_SINCE).toBe(server.RELEASE_WORDING_SINCE);
    });

    it.each([...site.RELEASE_PARAGRAPHS, ...site.RELEASE_RIGHTS])('is what the consent step shows: %s', (wording) => {
        expect(squash(consentStep)).toContain(squash(wording));
    });

    it.each([
        ['drawn, after the wording', { signature: 'data:image/png;base64,AAAA', signatureDate: '2026-09-01T00:00:00Z' }],
        ['typed', { signature: 'TEXT_SIGNATURE:Jane Doe', signatureDate: '2026-09-01T00:00:00Z' }],
        ['before the wording', { signature: 'data:image/png;base64,AAAA', signatureDate: '2026-01-22T23:59:59Z' }],
        ['legacy date field', { signature: 'TEXT_SIGNATURE:Jane', 'signature-date': '03/01/2026' }],
        ['undated', { signature: 'TEXT_SIGNATURE:Jane' }],
        ['created but not dated', { signature: 'TEXT_SIGNATURE:Jane', createdAt: '2026-09-01T00:00:00Z' }],
        ['unsigned', { signatureDate: '2026-09-01T00:00:00Z' }],
        ['a link, not a signature', { signature: 'https://example.test/s.png', signatureDate: '2026-09-01T00:00:00Z' }],
    ])('decides as the server does: %s', (_name, application) => {
        expect(site.releaseOf(application)).toEqual(server.releaseOf(application));
    });
});
