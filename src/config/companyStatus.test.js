/**
 * The workspace closes for exactly the companies the server treats as
 * deactivated. `functions/shared/companyTenant.js` loads firebase-functions, so
 * its predicate is compared as text: the same statuses, the same function.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCompanyDeactivated } from './companyStatus';

const read = (path) => readFileSync(resolve(__dirname, path), 'utf8');
const STATUSES = /const INACTIVE_STATUSES = \[[^\]]*\];/;
const PREDICATE = /function isCompanyDeactivated\(company\) \{\n[\s\S]*?\n\}\n/;

describe('parity with functions/shared/companyTenant.js', () => {
    const server = read('../../functions/shared/companyTenant.js');
    const client = read('./companyStatus.js');

    it('reads the same statuses', () => {
        expect(client.match(STATUSES)?.[0]).toBeTruthy();
        expect(client.match(STATUSES)?.[0]).toBe(server.match(STATUSES)?.[0]);
    });

    it('decides the same way', () => {
        expect(client.match(PREDICATE)?.[0]).toBeTruthy();
        expect(client.match(PREDICATE)?.[0]).toBe(server.match(PREDICATE)?.[0]);
    });
});

describe('isCompanyDeactivated', () => {
    it.each([
        [{ isActive: false }, true],
        [{ isActive: true }, false],
        [{ status: 'Suspended' }, true],
        [{ isActive: true, status: 'inactive' }, true],
        [{ status: 'active' }, false],
        [{}, false],
        [null, false],
    ])('%j is deactivated: %s', (company, expected) => {
        expect(isCompanyDeactivated(company)).toBe(expected);
    });
});
