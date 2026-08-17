/**
 * The AI telemetry index and retention guard.
 *
 * Two separate defects live here, and both are invisible to every other test in
 * the suite.
 *
 * ## 1. Composite indexes
 *
 * `readTelemetry` combines an equality filter (`taskType` or `outcome`) with
 * `orderBy('timestamp')`. Firestore rejects that shape with `FAILED_PRECONDITION`
 * unless a matching composite index is declared — *even against an empty
 * collection*. The unit suite cannot catch it because it stubs the Firestore
 * client, and a stub answers any query; the emulator cannot catch it because it
 * creates composite indexes on demand. The first place it would surface is an
 * operator opening the Logs tab in production, which is exactly how the
 * equivalent blog defect was found (see `blogFirestoreIndexes.test.js`).
 *
 * ## 2. The TTL policy that was documented but never existed
 *
 * `record.js` writes `expiresAt` on every row and the platform documentation
 * promised 30-day retention. But `expiresAt` does nothing on its own — Firestore
 * deletes only when a TTL *policy* names the field, and `fieldOverrides` was an
 * empty array. So telemetry was retained forever while the docs said otherwise,
 * and nothing anywhere would have said so.
 *
 * That matters more now than it did: transactions carry per-attempt operational
 * detail, and "we keep this for 30 days" is a claim the repository should be
 * able to back up.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const INDEXES_PATH = path.join(REPO_ROOT, 'firestore.indexes.json');
const RECORD_PATH = path.join(REPO_ROOT, 'functions/ai/telemetry/record.js');

const config = JSON.parse(fs.readFileSync(INDEXES_PATH, 'utf8'));
const recordSource = fs.readFileSync(RECORD_PATH, 'utf8');

function hasIndex(collectionGroup, fields) {
    return (config.indexes || []).some((index) => (
        index.collectionGroup === collectionGroup
        && index.fields.length === fields.length
        && index.fields.every((field, position) => (
            field.fieldPath === fields[position].fieldPath
            && field.order === fields[position].order
        ))
    ));
}

describe('ai_telemetry composite indexes', () => {
    it.each([
        ['taskType'],
        ['outcome'],
    ])('declares the %s + timestamp index the Logs filter needs', (equalityField) => {
        expect(hasIndex('ai_telemetry', [
            { fieldPath: equalityField, order: 'ASCENDING' },
            { fieldPath: 'timestamp', order: 'DESCENDING' },
        ])).toBe(true);
    });

    it('declares an index for every field readTelemetry filters on server-side', () => {
        // Reads the real query chain rather than trusting the list above, so a
        // new `.where(...)` added to `readTelemetry` fails here instead of in
        // production. The date range is excluded deliberately: a range filter
        // and an `orderBy` on the *same* field need no composite index.
        const body = recordSource.slice(recordSource.indexOf('async function readTelemetry'));
        const filtered = [...body.matchAll(/\.where\('([a-zA-Z]+)',\s*'=='/g)]
            .map((match) => match[1]);

        expect(filtered.length).toBeGreaterThan(0);
        for (const field of new Set(filtered)) {
            expect(hasIndex('ai_telemetry', [
                { fieldPath: field, order: 'ASCENDING' },
                { fieldPath: 'timestamp', order: 'DESCENDING' },
            ])).toBe(true);
        }
    });
});

describe('ai_telemetry retention', () => {
    it('declares the TTL policy that makes expiresAt actually delete anything', () => {
        const override = (config.fieldOverrides || []).find((entry) => (
            entry.collectionGroup === 'ai_telemetry' && entry.fieldPath === 'expiresAt'
        ));

        expect(override).toBeDefined();
        expect(override.ttl).toBe(true);
    });

    it('writes the field the TTL policy names', () => {
        // The policy and the writer have to agree on the field name, and they
        // are in different files with no compiler between them.
        expect(recordSource).toMatch(/expiresAt/);
        expect(recordSource).toMatch(/RETENTION_DAYS\s*=\s*30/);
    });
});
