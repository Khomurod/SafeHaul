/**
 * The run ledger's retention policy, read out of the deployed configuration.
 *
 * `expiresAt` is an ordinary Firestore field until a TTL policy names it. The AI
 * telemetry collection shipped in exactly that state once — the field was
 * written, the documentation promised 30 days, and nothing was ever deleted — so
 * the policy is asserted rather than assumed.
 *
 * The ledger and the telemetry it points at must expire together: a ledger row
 * that outlived its transaction timeline would name a diagnosis nobody can open.
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');

const runLedger = require('../../blog/runLedger');
const telemetry = require('../../ai/telemetry/record');

const indexes = JSON.parse(
    readFileSync(resolve(__dirname, '../../../firestore.indexes.json'), 'utf8'),
);

describe('blog_runs retention', () => {
    it('declares a TTL policy on expiresAt, or nothing is ever deleted', () => {
        const override = (indexes.fieldOverrides || []).find((entry) => (
            entry.collectionGroup === 'blog_runs' && entry.fieldPath === 'expiresAt'
        ));

        expect(override).toBeTruthy();
        expect(override.ttl).toBe(true);
    });

    it('expires on the same schedule as the telemetry it points at', () => {
        expect(runLedger.RETENTION_DAYS).toBe(telemetry.RETENTION_DAYS);
    });

    it('is denied to every client, including a super admin', () => {
        const rules = readFileSync(resolve(__dirname, '../../../src/firestore.rules'), 'utf8');

        // Read through the audited callable or not at all. The ledger names
        // themes, dates and refusal reasons — operational, but not public, and
        // there is no reason for a browser to reach it directly.
        expect(rules).toMatch(/match \/blog_runs\/\{[^}]+\} \{ allow read, write: if false; \}/);
    });
});
