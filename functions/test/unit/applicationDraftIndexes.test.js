/**
 * The draft collection's index and retention guard.
 *
 * Both of the failures this covers are invisible to every other test in the
 * suite, for the reasons `aiTelemetryIndexes.test.js` sets out at length: the
 * unit suite stubs the Firestore client and a stub answers any query, and the
 * emulator creates composite indexes on demand. The first place a missing index
 * surfaces is a real applicant, mid-application, whose resume lookup returns
 * `FAILED_PRECONDITION` — and because the lookup fails closed *into* the normal
 * flow, they would simply never be offered their saved application and nobody
 * would be told why.
 *
 * The retention half matters for a different reason. These documents hold a
 * name, a date of birth and a licence number for someone who never finished
 * applying and never signed anything. `expiresAt` does nothing on its own:
 * Firestore deletes only when a TTL *policy* names the field. Promising 30 days
 * in the documentation while retaining forever is the exact state the telemetry
 * collection shipped in once.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'firestore.indexes.json'), 'utf8'));
// The lookup lives in `functions/drafts/resume.js`; `applicationDrafts.js` is
// only the deployment surface that re-exports it. Reading the entry alone would
// find no `.where(...)` at all — which the `filtered.length` assertion below
// already refuses to treat as "nothing to check", and that is exactly how this
// test caught the module split rather than passing over an empty string.
const callableSource = fs.readFileSync(path.join(REPO_ROOT, 'functions/drafts/resume.js'), 'utf8');
/**
 * The carrier-prepared surface queries the same collection, and got the same
 * treatment for the same reason: on 2026-09-03 review found `origin == 'company'`
 * ordered by `updatedAt` in both of these with no index declared for it, so the
 * recruiter's list and the keyless invite lookup would both have failed with
 * `FAILED_PRECONDITION` in a deployed project while every test here passed.
 *
 * Read as a SET of files rather than one path, so splitting the module again does
 * not quietly move a query out from under this test.
 */
const PREPARED_SOURCE_FILES = Object.freeze([
    'functions/companyApplications/read.js',
    'functions/companyApplications/invite.js',
    'functions/companyApplications/inviteTokens.js',
    'functions/companyApplications/inviteIdentity.js',
]);

const draft = require('../../shared/applicationDraft');
const telemetry = require('../../ai/telemetry/record');

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

function ttlOverride(collectionGroup) {
    return (config.fieldOverrides || []).find((entry) => (
        entry.collectionGroup === collectionGroup && entry.fieldPath === 'expiresAt'
    ));
}

describe('application_drafts composite index', () => {
    it('declares the identityKey + updatedAt index the resume lookup needs', () => {
        expect(hasIndex('application_drafts', [
            { fieldPath: 'identityKey', order: 'ASCENDING' },
            { fieldPath: 'updatedAt', order: 'DESCENDING' },
        ])).toBe(true);
    });

    it('declares an index for every equality filter the lookup actually uses', () => {
        // Read out of the real query chain rather than trusting the assertion
        // above, so a new `.where(...)` added to `findResumableApplication` fails
        // here instead of on a driver's phone.
        const start = callableSource.indexOf('exports.findResumableApplication');
        expect(start).toBeGreaterThanOrEqual(0);
        const body = callableSource.slice(start);
        const lookup = body.slice(0, body.indexOf('exports.resumeApplicationDraft'));
        const filtered = [...lookup.matchAll(/\.where\('([a-zA-Z]+)',\s*'=='/g)].map((match) => match[1]);

        expect(filtered.length).toBeGreaterThan(0);
        for (const field of filtered) {
            expect(hasIndex('application_drafts', [
                { fieldPath: field, order: 'ASCENDING' },
                { fieldPath: 'updatedAt', order: 'DESCENDING' },
            ])).toBe(true);
        }
    });
});

describe('the carrier-prepared queries on the same collection', () => {
    it('declares the origin + updatedAt index', () => {
        expect(hasIndex('application_drafts', [
            { fieldPath: 'origin', order: 'ASCENDING' },
            { fieldPath: 'updatedAt', order: 'DESCENDING' },
        ])).toBe(true);
    });

    /**
     * Asked of the SET, not of each file.
     *
     * It used to require every listed file to contain at least one equality filter,
     * on the grounds that a file which stopped containing the query was a file the
     * query had moved out of. That reasoning holds for a *move* and fails for a
     * *deletion*: on 2026-09-09 `exchangeApplicationInvite`'s fallback scan dropped
     * its `origin == 'company'` filter outright — a continuation link has to be
     * able to resolve a draft the driver authored — and this test failed for a
     * change that removed an index dependency rather than adding one.
     *
     * The hazard it was built for is still caught, one level up: the union over the
     * whole surface must be non-empty, so a query cannot vanish from every listed
     * file unnoticed, and `read.js` is still asserted to hold the `origin` one by
     * the case above.
     */
    const equalityFiltersIn = (file) => [...fs
        .readFileSync(path.join(REPO_ROOT, file), 'utf8')
        .matchAll(/\.where\('([a-zA-Z]+)',\s*'=='/g)].map((match) => match[1]);

    it('still queries this collection by equality somewhere on the prepared surface', () => {
        const union = PREPARED_SOURCE_FILES.flatMap(equalityFiltersIn);
        expect(union.length).toBeGreaterThan(0);
    });

    it.each(PREPARED_SOURCE_FILES)('declares an index for every equality filter in %s', (file) => {
        for (const field of equalityFiltersIn(file)) {
            expect(hasIndex('application_drafts', [
                { fieldPath: field, order: 'ASCENDING' },
                { fieldPath: 'updatedAt', order: 'DESCENDING' },
            ])).toBe(true);
        }
    });
});

describe('unfinished application retention', () => {
    it('declares a TTL policy on the draft, or an abandoned one is kept forever', () => {
        const override = ttlOverride('application_drafts');
        expect(override).toBeTruthy();
        expect(override.ttl).toBe(true);
    });

    it('declares a TTL policy on the audit trail too', () => {
        // The audit rows are value-free, but they are also not worth keeping
        // beyond the drafts they describe.
        const override = ttlOverride('application_draft_audit');
        expect(override).toBeTruthy();
        expect(override.ttl).toBe(true);
    });

    it('keeps a draft no longer than the platform keeps its diagnostics', () => {
        expect(draft.RETENTION_DAYS).toBe(telemetry.RETENTION_DAYS);
    });

    it('is denied to every client, including a super admin', () => {
        const rules = fs.readFileSync(path.join(REPO_ROOT, 'src/firestore.rules'), 'utf8');

        expect(rules).toMatch(/match \/application_drafts\/\{[^}]+\} \{ allow read, write: if false; \}/);
        expect(rules).toMatch(/match \/application_draft_audit\/\{[^}]+\} \{ allow read, write: if false; \}/);
    });
});
