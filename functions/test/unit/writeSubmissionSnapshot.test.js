const {
  MAX_SNAPSHOT_SEQUENCE,
  isAlreadyExists,
  readOriginalSubmissionSnapshot,
  writeSubmissionSnapshot,
} = require('../../shared/writeSubmissionSnapshot');

// Minimal in-memory Firestore standing in for the Admin SDK. `create` rejects
// with ALREADY_EXISTS when the document is taken, which is the behaviour the
// sequence claim relies on.
function makeDb(existing = {}) {
  const store = { ...existing };
  const calls = [];
  const docRef = (path) => ({
    async create(data) {
      calls.push({ path, data });
      if (path in store) {
        const err = new Error(`6 ALREADY_EXISTS: Document already exists: ${path}`);
        err.code = 6;
        throw err;
      }
      store[path] = data;
      return { path };
    },
    async get() {
      return path in store
        ? { exists: true, data: () => store[path] }
        : { exists: false, data: () => undefined };
    },
  });

  const build = (prefix) => ({
    collection: (name) => ({
      doc: (id) => {
        const path = `${prefix}/${name}/${id}`;
        return { ...docRef(path), ...build(path) };
      },
    }),
  });

  return { db: build('').collection ? build('') : build(''), store, calls };
}

const SNAP = { schemaVersion: 1, frozen: true, definitionVersion: 'def-abc', agreementVersion: 'v1' };
const args = (db, over = {}) => ({
  db, companyId: 'co-a', applicationId: 'app-1', snapshot: SNAP, ...over,
});

describe('sequence claiming', () => {
  it('writes the original submission as v1', async () => {
    const { db, store } = makeDb();
    const result = await writeSubmissionSnapshot(args(db));
    expect(result).toEqual({ snapshotId: 'v1', sequence: 1, isOriginal: true, deduplicated: false });
    expect(store['/companies/co-a/applications/app-1/submission/v1']).toBeDefined();
  });

  // The defect this prevents: upsertApplicationDoc supports re-submission, so a
  // fixed snapshot id would let a second submission overwrite the first — the
  // exact evidence this design exists to protect.
  it('adds a sibling on re-submission instead of overwriting the original', async () => {
    const { db, store } = makeDb();
    const first = await writeSubmissionSnapshot(args(db, { snapshot: { ...SNAP, marker: 'first' } }));
    const second = await writeSubmissionSnapshot(args(db, { snapshot: { ...SNAP, marker: 'second' } }));

    expect(first.snapshotId).toBe('v1');
    expect(second).toEqual({ snapshotId: 'v2', sequence: 2, isOriginal: false, deduplicated: false });
    expect(store['/companies/co-a/applications/app-1/submission/v1'].marker).toBe('first');
    expect(store['/companies/co-a/applications/app-1/submission/v2'].marker).toBe('second');
  });

  it('keeps climbing past several existing submissions', async () => {
    const { db } = makeDb({
      '/companies/co-a/applications/app-1/submission/v1': {},
      '/companies/co-a/applications/app-1/submission/v2': {},
      '/companies/co-a/applications/app-1/submission/v3': {},
    });
    expect((await writeSubmissionSnapshot(args(db))).snapshotId).toBe('v4');
  });

  it('records the sequence on the stored document', async () => {
    const { db, store } = makeDb();
    await writeSubmissionSnapshot(args(db));
    expect(store['/companies/co-a/applications/app-1/submission/v1'].sequence).toBe(1);
  });

  it('keeps snapshots of different applications independent', async () => {
    const { db } = makeDb();
    await writeSubmissionSnapshot(args(db));
    const other = await writeSubmissionSnapshot(args(db, { applicationId: 'app-2' }));
    expect(other.snapshotId).toBe('v1');
  });

  it('keeps snapshots of different companies independent', async () => {
    const { db } = makeDb();
    await writeSubmissionSnapshot(args(db));
    const other = await writeSubmissionSnapshot(args(db, { companyId: 'co-b' }));
    expect(other.snapshotId).toBe('v1');
  });

  it('gives up loudly rather than looping forever', async () => {
    const taken = {};
    for (let i = 1; i <= MAX_SNAPSHOT_SEQUENCE; i += 1) {
      taken[`/companies/co-a/applications/app-1/submission/v${i}`] = {};
    }
    const { db } = makeDb(taken);
    await expect(writeSubmissionSnapshot(args(db))).rejects.toThrow(/Could not claim a submission snapshot sequence/);
  });
});

describe('tenant binding and owner stamping', () => {
  it('stamps companyId and applicationId onto the snapshot', async () => {
    const { db, store } = makeDb();
    await writeSubmissionSnapshot(args(db));
    const stored = store['/companies/co-a/applications/app-1/submission/v1'];
    expect(stored.companyId).toBe('co-a');
    expect(stored.applicationId).toBe('app-1');
  });

  // The owner-read rule matches these, exactly as dq_files does. They are
  // access-control metadata, never presentation data.
  it('stamps owner ids so the driver can read their own snapshot', async () => {
    const { db, store } = makeDb();
    await writeSubmissionSnapshot(args(db, { ownerIds: { applicantId: 'driver-a', driverId: 'driver-a' } }));
    const stored = store['/companies/co-a/applications/app-1/submission/v1'];
    expect(stored.applicantId).toBe('driver-a');
    expect(stored.driverId).toBe('driver-a');
  });

  it('falls back to the application id when no owner ids are supplied', async () => {
    const { db, store } = makeDb();
    await writeSubmissionSnapshot(args(db));
    const stored = store['/companies/co-a/applications/app-1/submission/v1'];
    expect(stored.applicantId).toBe('app-1');
    expect(stored.driverId).toBe('app-1');
  });

  it('preserves the snapshot content unchanged', async () => {
    const { db, store } = makeDb();
    await writeSubmissionSnapshot(args(db));
    const stored = store['/companies/co-a/applications/app-1/submission/v1'];
    expect(stored.frozen).toBe(true);
    expect(stored.definitionVersion).toBe('def-abc');
    expect(stored.agreementVersion).toBe('v1');
  });
});

describe('error handling', () => {
  it('recognises ALREADY_EXISTS by code and by message', () => {
    expect(isAlreadyExists({ code: 6 })).toBe(true);
    expect(isAlreadyExists({ code: 'already-exists' })).toBe(true);
    expect(isAlreadyExists({ message: '6 ALREADY_EXISTS: Document already exists' })).toBe(true);
    expect(isAlreadyExists({ code: 7, message: 'PERMISSION_DENIED' })).toBe(false);
    expect(isAlreadyExists(null)).toBe(false);
  });

  // A permission or network failure must surface, not be mistaken for a taken slot.
  it('rethrows any error that is not ALREADY_EXISTS', async () => {
    const db = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => ({
              collection: () => ({
                doc: () => ({
                  create: async () => {
                    const err = new Error('7 PERMISSION_DENIED');
                    err.code = 7;
                    throw err;
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    };
    await expect(writeSubmissionSnapshot(args(db))).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it('validates its arguments', async () => {
    const { db } = makeDb();
    await expect(writeSubmissionSnapshot({ companyId: 'co-a', applicationId: 'a', snapshot: SNAP }))
      .rejects.toThrow(/requires a Firestore instance/);
    await expect(writeSubmissionSnapshot(args(db, { companyId: null })))
      .rejects.toThrow(/requires companyId and applicationId/);
    await expect(writeSubmissionSnapshot(args(db, { snapshot: null })))
      .rejects.toThrow(/requires a snapshot/);
  });
});

describe('reading the original', () => {
  it('always resolves to sequence 1, not the newest', async () => {
    const { db } = makeDb();
    await writeSubmissionSnapshot(args(db, { snapshot: { ...SNAP, marker: 'first' } }));
    await writeSubmissionSnapshot(args(db, { snapshot: { ...SNAP, marker: 'second' } }));

    const original = await readOriginalSubmissionSnapshot({ db, companyId: 'co-a', applicationId: 'app-1' });
    expect(original.marker).toBe('first');
  });

  // Callers must say "no preserved record" rather than pass live data off as the
  // submitted original.
  it('returns null for an application that predates snapshots', async () => {
    const { db } = makeDb();
    expect(await readOriginalSubmissionSnapshot({ db, companyId: 'co-a', applicationId: 'legacy-app' }))
      .toBeNull();
  });
});
