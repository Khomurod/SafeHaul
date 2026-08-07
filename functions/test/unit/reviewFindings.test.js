// Regressions for five defects found in review of the preservation work.
//
// Each of these was a way the system could assert something that was not true,
// or lose something it promised to keep. They are grouped here because they
// share that character, not because they share a module.

const {
    reconstructSubmissionSnapshot,
    LEGACY_ACCEPTANCE_KEYS,
} = require('../../shared/reconstructSubmission');
const {
    resolveAgreement,
    resolveAgreementSet,
    submittableVersions,
} = require('../../shared/legalAgreements');
const { writeSubmissionSnapshot } = require('../../shared/writeSubmissionSnapshot');

const company = { companyName: 'Northwind Freight Systems' };

const historical = (over = {}) => ({
    id: 'app-1',
    firstName: 'Marcus',
    lastName: 'Delgado',
    submittedAt: '2024-03-02T11:04:00.000Z',
    signature: 'data:image/png;base64,AAAA',
    'final-certification': 'yes',
    ...over,
});

const rebuild = (over) => reconstructSubmissionSnapshot({ application: historical(over), company });
const byId = (snapshot) => Object.fromEntries(snapshot.agreements.map((a) => [a.id, a]));

describe('a historical record claims only the agreements actually accepted', () => {
    it('never claims the Clearinghouse consent, which was never presented', () => {
        // The old consent screen showed three agreements. The old PDF printed a
        // fourth — Clearinghouse — and stamped the driver's signature on it.
        // A reconstruction must not resurrect that claim.
        const { snapshot } = rebuild();
        expect(snapshot.agreements.map((a) => a.id))
            .toEqual(['electronicSignature', 'fcraDisclosure', 'pspDisclosure']);
        expect(byId(snapshot).clearinghouseConsent).toBeUndefined();
    });

    it('honours the individual acknowledgement the applicant actually left', () => {
        const { snapshot } = rebuild({
            'agree-electronic': 'agreed',
            'agree-background-check': 'agreed',
            // PSP deliberately not ticked.
        });

        const agreements = byId(snapshot);
        expect(agreements.electronicSignature.accepted).toBe(true);
        expect(agreements.electronicSignature.acceptanceScope).toBe('individual');
        expect(agreements.fcraDisclosure.accepted).toBe(true);

        // The one they did not tick stays unaccepted, and carries no signature.
        expect(agreements.pspDisclosure.accepted).toBe(false);
        expect(agreements.pspDisclosure.signature).toBeNull();
    });

    it('falls back to combined certification only when no individual record survives', () => {
        const { snapshot, unrecoverable } = rebuild();
        for (const agreement of snapshot.agreements) {
            expect(agreement.accepted).toBe(true);
            expect(agreement.acceptanceScope).toBe('combined');
        }
        expect(unrecoverable).toContain('individual_agreement_acceptance');
    });

    it('does not treat a surviving acknowledgement as unrecoverable', () => {
        const { unrecoverable } = rebuild({ 'agree-electronic': 'agreed' });
        expect(unrecoverable).not.toContain('individual_agreement_acceptance');
    });

    it('maps every legacy key to an agreement that has legacy wording', () => {
        for (const [agreementId] of Object.entries(LEGACY_ACCEPTANCE_KEYS)) {
            expect(() => resolveAgreement(agreementId, 'legacy-1', company)).not.toThrow();
        }
        expect(LEGACY_ACCEPTANCE_KEYS.clearinghouseConsent).toBeUndefined();
    });
});

describe('a new submission binds to the wording it displayed', () => {
    it('offers no retired wording as submittable', () => {
        const versions = submittableVersions();
        expect(versions.has('v1')).toBe(true);
        for (const version of versions) expect(version).not.toMatch(/^legacy-/);
    });

    it('resolves the legacy set without the agreement added later', () => {
        expect(resolveAgreementSet({ companyName: 'X', version: 'legacy-1' }).map((a) => a.id))
            .not.toContain('clearinghouseConsent');
    });
});

describe('one submission attempt stays one record, even delivered concurrently', () => {
    // The failure this replaces: a query for "is this attempt already recorded"
    // followed by an independent create. Two deliveries of one attempt could
    // both find nothing and then take v1 and v2 — permanently recording a retry
    // as a resubmission the driver never made.
    const makeDb = () => {
        const docs = new Map();
        let lock = Promise.resolve();

        const refFor = (path) => ({
            path,
            async get() {
                return docs.has(path)
                    ? { exists: true, data: () => docs.get(path) }
                    : { exists: false, data: () => undefined };
            },
            async create(data) {
                if (docs.has(path)) {
                    const error = new Error('6 ALREADY_EXISTS'); error.code = 6; throw error;
                }
                docs.set(path, data);
            },
        });

        const collectionAt = (base) => ({
            doc: (id) => ({ ...refFor(`${base}/${id}`), collection: (n) => collectionAt(`${base}/${id}/${n}`) }),
        });

        return {
            docs,
            collection: (name) => collectionAt(name),
            // Serialised, as Firestore's transactions are: writes land together
            // and a second transaction sees them.
            runTransaction: async (fn) => {
                const mine = lock.then(async () => {
                    const writes = [];
                    const result = await fn({
                        get: (ref) => ref.get(),
                        create: (ref, data) => writes.push([ref, data]),
                    });
                    for (const [ref, data] of writes) await ref.create(data);
                    return result;
                });
                lock = mine.catch(() => {});
                return mine;
            },
        };
    };

    const write = (db, attemptId) => writeSubmissionSnapshot({
        db,
        companyId: 'co-1',
        applicationId: 'app-1',
        snapshot: { sections: [] },
        submissionAttemptId: attemptId,
    });

    it('collapses two SIMULTANEOUS deliveries of one attempt into one record', async () => {
        const db = makeDb();
        const [a, b] = await Promise.all([write(db, 'attempt-1'), write(db, 'attempt-1')]);

        expect(a.snapshotId).toBe('v1');
        expect(b.snapshotId).toBe('v1');
        expect([a.deduplicated, b.deduplicated].sort()).toEqual([false, true]);

        const snapshots = [...db.docs.keys()].filter((k) => k.includes('/submission/'));
        expect(snapshots).toHaveLength(1);
    });

    it('still gives a GENUINE resubmission its own record', async () => {
        const db = makeDb();
        const first = await write(db, 'attempt-1');
        const second = await write(db, 'attempt-2');

        expect(first.snapshotId).toBe('v1');
        expect(first.isOriginal).toBe(true);
        expect(second.snapshotId).toBe('v2');
        expect(second.isOriginal).toBe(false);
    });

    it('refuses to run without transactions rather than silently losing idempotency', async () => {
        const db = makeDb();
        delete db.runTransaction;
        await expect(write(db, 'attempt-1')).rejects.toThrow(/transactions/i);
    });
});
