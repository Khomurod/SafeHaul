// Preserving the original: the property the whole design rests on is that a
// stored original is never rewritten. Everything else — the path, the filename,
// the DQ file entry — exists to make that property usable.

const { buildApplicationDefinition } = require('../../shared/applicationDefinition');
const { buildSubmissionSnapshot } = require('../../shared/submissionSnapshot');
const {
    dqFileIdFor,
    originalPdfFilename,
    originalPdfPath,
    preserveApplicationPdf,
} = require('../../shared/preserveApplicationPdf');

const SUBMITTED_AT = '2026-07-14T15:22:41.000Z';
const COMPANY_ID = 'company-abc';
const APPLICATION_ID = 'a1b2c3d4e5f6a7b8c9d0';

function makeSnapshot(over = {}) {
    const definition = buildApplicationDefinition({
        company: { companyName: 'Northwind Freight Systems', ...(over.company || {}) },
    });
    return buildSubmissionSnapshot({
        definition,
        formData: { firstName: 'Marcus', lastName: 'Delgado', ssn: '412-88-7391' },
        submittedAt: SUBMITTED_AT,
        ...over.snapshot,
    });
}

/**
 * Storage double.
 *
 * Models the one behaviour the immutability guarantee rests on: `save` with
 * `ifGenerationMatch: 0` is create-only, and a second writer gets a 412 rather
 * than replacing the object — which is exactly what Cloud Storage does.
 */
function makeStorage() {
    const objects = new Map();
    const saves = [];
    /** Runs between the existence check and the save, to model a racing writer. */
    const interference = { hook: null };

    return {
        __objects: objects,
        __saves: saves,
        __interference: interference,
        bucket: () => ({
            file: (path) => ({
                exists: async () => {
                    const answer = [objects.has(path)];
                    if (interference.hook) {
                        const hook = interference.hook;
                        interference.hook = null;
                        hook(path);
                    }
                    return answer;
                },
                getMetadata: async () => [objects.get(path)?.options?.metadata || {}],
                save: async (buffer, options) => {
                    if (options?.preconditionOpts?.ifGenerationMatch === 0 && objects.has(path)) {
                        const error = new Error('At least one of the pre-conditions you specified did not hold.');
                        error.code = 412;
                        throw error;
                    }
                    saves.push({ path, size: buffer.length });
                    objects.set(path, { buffer, options });
                },
            }),
        }),
    };
}

function makeDb() {
    const docs = new Map();
    const ref = (path) => ({
        path,
        set: async (data, options) => {
            const base = options?.merge ? (docs.get(path) || {}) : {};
            docs.set(path, { ...base, ...data });
        },
        collection: (name) => collection(`${path}/${name}`),
    });
    const collection = (path) => ({ doc: (id) => ref(`${path}/${id}`) });
    return { __docs: docs, collection: (name) => collection(name) };
}

const preserve = (db, storage, over = {}) => preserveApplicationPdf({
    db,
    storage,
    serverTimestamp: '__ts__',
    companyId: COMPANY_ID,
    applicationId: APPLICATION_ID,
    snapshot: makeSnapshot(),
    snapshotId: 'v1',
    sequence: 1,
    ...over,
});

describe('preserving the original application PDF', () => {
    it('renders and stores the document once', async () => {
        const db = makeDb();
        const storage = makeStorage();

        const result = await preserve(db, storage);

        expect(result.alreadyExisted).toBe(false);
        expect(result.storagePath).toBe(
            `application_originals/${COMPANY_ID}/${APPLICATION_ID}/v1.pdf`,
        );
        expect(storage.__saves).toHaveLength(1);
        expect(storage.__saves[0].size).toBeGreaterThan(1000);
    });

    it('NEVER rewrites an original that already exists', async () => {
        const db = makeDb();
        const storage = makeStorage();

        await preserve(db, storage);
        const firstBytes = [...storage.__objects.values()][0].buffer;

        // Same application, a snapshot that now reads differently — a corrupted
        // regeneration, or a company that renamed itself. The stored original
        // must be untouched.
        const second = await preserve(db, storage, {
            snapshot: makeSnapshot({ company: { companyName: 'Renamed Carrier LLC' } }),
        });

        expect(second.alreadyExisted).toBe(true);
        expect(storage.__saves).toHaveLength(1);
        expect([...storage.__objects.values()][0].buffer).toBe(firstBytes);
    });

    it('gives a resubmission its own file beside the original', async () => {
        const db = makeDb();
        const storage = makeStorage();

        await preserve(db, storage);
        const second = await preserve(db, storage, { snapshotId: 'v2', sequence: 2 });

        expect(second.storagePath).toMatch(/\/v2\.pdf$/);
        expect(storage.__objects.size).toBe(2);
        expect(storage.__objects.has(`application_originals/${COMPANY_ID}/${APPLICATION_ID}/v1.pdf`)).toBe(true);
    });

    it('stores outside every Storage rule, so no client token can read it directly', () => {
        // `application_originals/**` is matched by nothing in storage.rules, so
        // Firebase default-denies and the audited callable is the only way in.
        expect(originalPdfPath({ companyId: 'c', applicationId: 'a', snapshotId: 'v1' }))
            .toBe('application_originals/c/a/v1.pdf');
    });

    it('files the document under the existing DQ Documents model', async () => {
        const db = makeDb();
        const storage = makeStorage();
        await preserve(db, storage, { ownerIds: { applicantId: 'driver-9', driverId: 'driver-9' } });

        const doc = db.__docs.get(
            `companies/${COMPANY_ID}/applications/${APPLICATION_ID}/dq_files/${dqFileIdFor('v1')}`,
        );
        expect(doc).toBeTruthy();
        expect(doc.fileType).toBe('Application for Employment');
        expect(doc.fileName).toMatch(/^Driver-Application-/);
        expect(doc.ownerUserIds).toEqual(['driver-9']);
        expect(doc.isOriginal).toBe(true);
        expect(doc.requiresAuditedAccess).toBe(true);
        expect(doc.containsFullSsn).toBe(true);
        expect(doc.applicantId).toBe('driver-9');
        // No durable link: this file is served only by the audited callable.
        expect(doc.url).toBeNull();
    });

    it('never puts an identifier or an SSN in the filename', () => {
        const fileName = originalPdfFilename({
            applicantName: 'Marcus Anthony Delgado',
            submittedAt: SUBMITTED_AT,
            sequence: 1,
        });
        expect(fileName).toBe('Driver-Application-Marcus-Anthony-Delgado-2026-07-14.pdf');
        expect(fileName).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
        expect(fileName).not.toMatch(APPLICATION_ID);
    });

    it('names a resubmission as one, and copes with an unnamed applicant', () => {
        expect(originalPdfFilename({ applicantName: 'Ann Lee', submittedAt: SUBMITTED_AT, sequence: 3 }))
            .toBe('Driver-Application-Ann-Lee-2026-07-14-resubmission-3.pdf');
        expect(originalPdfFilename({}))
            .toBe('Driver-Application-Applicant-undated.pdf');
    });

    it('strips path separators a hostile name could smuggle into the filename', () => {
        const fileName = originalPdfFilename({ applicantName: '../../etc/passwd', submittedAt: SUBMITTED_AT });
        expect(fileName).not.toMatch(/[/\\.]{2}/);
        expect(fileName).toBe('Driver-Application-etcpasswd-2026-07-14.pdf');
    });

    it('records that the stored file carries the full SSN, so access control knows', async () => {
        const db = makeDb();
        const storage = makeStorage();
        await preserve(db, storage);

        const stored = [...storage.__objects.values()][0];
        expect(stored.options.metadata.metadata.safehaulContainsFullSsn).toBe('true');
        // Metadata carries no SSN of its own.
        expect(JSON.stringify(stored.options.metadata)).not.toMatch(/412-?88-?7391/);
    });

    it('will not let a racing writer replace an original that already landed', async () => {
        // `exists()` then `save()` is not atomic. Two redeliveries can both see
        // no object; without a create-only precondition the later save replaces
        // the earlier, and since each render stamps its own generation time the
        // "immutable" original would silently become different bytes.
        const db = makeDb();
        const storage = makeStorage();

        // Another writer lands the object between our check and our save.
        storage.__interference.hook = (path) => {
            storage.__objects.set(path, {
                buffer: Buffer.from('the original that won the race'),
                options: { metadata: { metadata: { safehaulFileName: 'winner.pdf', safehaulApplicant: 'Marcus Delgado' } } },
            });
        };

        const result = await preserve(db, storage);

        expect(result.alreadyExisted).toBe(true);
        expect(result.fileName).toBe('winner.pdf');
        expect(storage.__saves).toHaveLength(0);
        expect(storage.__objects.get(`application_originals/${COMPANY_ID}/${APPLICATION_ID}/v1.pdf`).buffer.toString())
            .toBe('the original that won the race');
    });

    it('repairs a missing DQ entry when the object is already there', async () => {
        // If save() succeeded but the DQ write did not — a crash between them, a
        // transient Firestore failure — an early return left the preserved
        // original absent from the Documents tab forever, while the caller was
        // told it had been preserved.
        const db = makeDb();
        const storage = makeStorage();
        await preserve(db, storage);

        const dqPath = `companies/${COMPANY_ID}/applications/${APPLICATION_ID}/dq_files/${dqFileIdFor('v1')}`;
        db.__docs.delete(dqPath);

        const second = await preserve(db, storage);

        expect(second.alreadyExisted).toBe(true);
        expect(db.__docs.get(dqPath)).toBeTruthy();
        expect(db.__docs.get(dqPath).fileType).toBe('Application for Employment');
        // And still exactly one stored object.
        expect(storage.__saves).toHaveLength(1);
    });

    it('refuses to run without the arguments that bind it to one tenant', async () => {
        await expect(preserveApplicationPdf({ db: makeDb(), storage: makeStorage() }))
            .rejects.toThrow(/requires companyId, applicationId and snapshotId/);
        await expect(preserveApplicationPdf({}))
            .rejects.toThrow(/requires db and storage/);
    });
});
