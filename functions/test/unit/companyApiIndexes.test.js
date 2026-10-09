/**
 * The company API's indexes and retention, declared where Firestore reads them.
 *
 * The unit suites stub Firestore and a stub answers any query, so a missing
 * index would first show as every submissions request failing with
 * `FAILED_PRECONDITION` for a real integration. And `expiresAt` deletes
 * nothing until a TTL policy names it: the 90 days the documentation promises
 * for request records hold only because of the override checked here.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'firestore.indexes.json'), 'utf8'));
const routesSource = fs.readFileSync(path.join(REPO_ROOT, 'functions/companyApi/routes.js'), 'utf8');
const callablesSource = fs.readFileSync(path.join(REPO_ROOT, 'functions/companyApi/keyCallables.js'), 'utf8');
const { AUDIT_COLLECTION, KEYS_COLLECTION } = require('../../companyApi/apiKeys');

const index = (collectionGroup, queryScope) => (config.indexes || [])
    .filter((entry) => entry.collectionGroup === collectionGroup && entry.queryScope === queryScope)
    .map((entry) => entry.fields.map((field) => `${field.fieldPath} ${field.order}`).join(', '));

describe('the company API’s Firestore indexes', () => {
    it('declare the submissions feed: one company, in the order records arrived', () => {
        expect(routesSource).toMatch(/collectionGroup\('submission'\)\.where\('companyId', '==',/);
        expect(routesSource).toMatch(/\.orderBy\('submittedAt'\)\s*\.orderBy\(admin\.firestore\.FieldPath\.documentId\(\)\)/);
        expect(index('submission', 'COLLECTION_GROUP')).toContain('companyId ASCENDING, submittedAt ASCENDING');
    });

    it('declare the count of a company’s turned-on keys', () => {
        expect(callablesSource).toMatch(/\.where\('companyId', '==', companyId\)\s*\.where\('revokedAt', '==', null\)/);
        expect(index(KEYS_COLLECTION, 'COLLECTION')).toContain('companyId ASCENDING, revokedAt ASCENDING');
    });

    it('delete request records by their expiresAt', () => {
        expect(config.fieldOverrides).toContainEqual({ collectionGroup: AUDIT_COLLECTION, fieldPath: 'expiresAt', ttl: true, indexes: [] });
    });
});
