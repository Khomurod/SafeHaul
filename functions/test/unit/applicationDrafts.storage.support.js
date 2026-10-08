/**
 * The Storage double for the `applicationDrafts` suite, apart from
 * `applicationDrafts.support.js` for its size: which objects exist, their metadata
 * as Storage reports it, and every object deleted.
 *
 * An object exists while its path is in `mockStorageFiles`. Its metadata is its
 * `mockStorageMeta` entry, or what an ordinary upload has: unmarked, created after
 * the submission marks began, at metageneration 1. Setting metadata raises the
 * metageneration, and a delete naming another one fails with 412, as Storage's do.
 */

const mockStorageFiles = new Set();
const mockStorageMeta = new Map();
const mockDeletedFiles = [];
const mockStorageHooks = { failDeletesOn: null, hangDeletesOn: null, beforeDelete: null };

const UPLOAD = Object.freeze({ metageneration: '1', timeCreated: '2026-11-01T00:00:00.000Z', metadata: {} });

const notFound = () => Object.assign(new Error('No such object'), { code: 404 });

/**
 * Requests a double leaves unanswered, as a client still retrying would. By the
 * time a test ends, the code under test has given up on each; `settleUnanswered`
 * then refuses them, so none outlives its test (`.claude/rules/testing.md`).
 */
const mockUnanswered = [];
const mockNeverAnswers = () => new Promise((_, reject) => { mockUnanswered.push(reject); });
/** Refuses every request left unanswered: for an `afterEach`. */
function settleUnanswered() {
    for (const refuse of mockUnanswered.splice(0)) refuse(new Error('the test ended before this request was answered'));
}
const metaOf = (path) => mockStorageMeta.get(path) || UPLOAD;

/** The bucket the purge deletes from and the submission marks in, as the client has them. */
function mockBucket() {
    return {
        file: (path) => ({
            exists: async () => [mockStorageFiles.has(path)],
            getMetadata: async () => {
                if (!mockStorageFiles.has(path)) throw notFound();
                return [metaOf(path)];
            },
            setMetadata: async ({ metadata = {} } = {}) => {
                if (!mockStorageFiles.has(path)) throw notFound();
                const current = metaOf(path);
                mockStorageMeta.set(path, {
                    ...current,
                    metageneration: String(Number(current.metageneration) + 1),
                    metadata: { ...current.metadata, ...metadata },
                });
                return [metaOf(path)];
            },
            delete: async (options = {}) => {
                const hook = mockStorageHooks.beforeDelete;
                mockStorageHooks.beforeDelete = null;
                if (hook) await hook(path);
                if (mockStorageHooks.failDeletesOn && path.includes(mockStorageHooks.failDeletesOn)) {
                    throw new Error('storage unavailable');
                }
                if (mockStorageHooks.hangDeletesOn && path.includes(mockStorageHooks.hangDeletesOn)) {
                    await mockNeverAnswers();
                }
                if (!mockStorageFiles.has(path)) {
                    if (options.ignoreNotFound) return;
                    throw notFound();
                }
                if (options.ifMetagenerationMatch !== undefined
                    && String(options.ifMetagenerationMatch) !== metaOf(path).metageneration) {
                    throw Object.assign(new Error('Precondition Failed'), { code: 412 });
                }
                mockDeletedFiles.push(path);
                mockStorageFiles.delete(path);
                mockStorageMeta.delete(path);
            },
        }),
    };
}

/** Makes every Storage delete of a path containing `fragment` throw, until the next reset. */
function failFileDeletesOn(fragment) {
    mockStorageHooks.failDeletesOn = fragment;
}

/** Makes every Storage delete of a path containing `fragment` go unanswered, until the next reset. */
function hangFileDeletesOn(fragment) {
    mockStorageHooks.hangDeletesOn = fragment;
}

/** Runs `hook(path)` once, just before the next delete reaches Storage. */
function beforeNextFileDelete(hook) {
    mockStorageHooks.beforeDelete = hook;
}

function resetStorage() {
    mockStorageFiles.clear();
    mockStorageMeta.clear();
    mockDeletedFiles.length = 0;
    mockStorageHooks.failDeletesOn = null;
    mockStorageHooks.hangDeletesOn = null;
    mockStorageHooks.beforeDelete = null;
}

module.exports = {
    mockBucket, mockStorageFiles, mockStorageMeta, mockDeletedFiles, failFileDeletesOn, hangFileDeletesOn,
    beforeNextFileDelete, resetStorage, mockNeverAnswers, settleUnanswered,
};
