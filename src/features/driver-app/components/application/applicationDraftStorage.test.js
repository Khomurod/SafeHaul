import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    readApplicationDraft,
    saveApplicationDraft,
    markDraftSynced,
    clearApplicationDraft,
} from './applicationDraftStorage';

const SLUG = 'acme';
const KEY = 'draft_acme';

describe('applicationDraftStorage', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    describe('sensitive fields', () => {
        it('never persists an SSN or a signature', () => {
            saveApplicationDraft(SLUG, {
                firstName: 'Ada',
                ssn: '123-45-6789',
                signature: 'data:image/png;base64,AAAA',
            });

            const raw = localStorage.getItem(KEY);
            expect(raw).not.toContain('123-45-6789');
            expect(raw).not.toContain('data:image/png');

            const draft = readApplicationDraft(SLUG);
            expect(draft.data).not.toHaveProperty('ssn');
            expect(draft.data).not.toHaveProperty('signature');
            expect(draft.data.firstName).toBe('Ada');
        });

    });

    describe('reading', () => {
        it('returns null for an absent or corrupt draft', () => {
            expect(readApplicationDraft(SLUG)).toBeNull();
            localStorage.setItem(KEY, 'not json');
            expect(readApplicationDraft(SLUG)).toBeNull();
            localStorage.setItem(KEY, '"a string"');
            expect(readApplicationDraft(SLUG)).toBeNull();
        });

        it('round-trips an enveloped draft with its sync position', () => {
            saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 3 });

            const draft = readApplicationDraft(SLUG);
            expect(draft.data).toEqual({ firstName: 'Ada' });
            expect(draft.lastStep).toBe(3);
            expect(draft.meta.localSeq).toBe(1);
            expect(draft.meta.syncedSeq).toBe(0);
        });

        it('reads a legacy flat draft, and reports it as having no metadata', () => {
            // Already in real drivers' browsers: answers and lastStep in one
            // object, with no way to say whether it holds unsynced work.
            localStorage.setItem(KEY, JSON.stringify({
                firstName: 'Ada', phone: '5551234', lastStep: 4,
            }));

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta).toBeNull();
            expect(draft.lastStep).toBe(4);
            // `lastStep` is metadata, not an answer, so it does not leak into the
            // form data the way it used to.
            expect(draft.data).toEqual({ firstName: 'Ada', phone: '5551234' });
        });
    });

    describe('writing', () => {
        it('advances localSeq on every write but leaves syncedSeq alone', () => {
            expect(saveApplicationDraft(SLUG, { a: 1 }).localSeq).toBe(1);
            expect(saveApplicationDraft(SLUG, { a: 2 }).localSeq).toBe(2);
            expect(saveApplicationDraft(SLUG, { a: 3 }).localSeq).toBe(3);

            // A local write is unsynced by definition.
            expect(readApplicationDraft(SLUG).meta.syncedSeq).toBe(0);
        });

        it('starts a legacy draft at sequence 1 rather than trusting it', () => {
            localStorage.setItem(KEY, JSON.stringify({ firstName: 'Ada', lastStep: 4 }));

            expect(saveApplicationDraft(SLUG, { firstName: 'Ada' }).localSeq).toBe(1);
        });

        it('keeps the previous step when a write does not supply one', () => {
            saveApplicationDraft(SLUG, { a: 1 }, { lastStep: 5 });
            saveApplicationDraft(SLUG, { a: 2 });

            expect(readApplicationDraft(SLUG).lastStep).toBe(5);
        });

        it('reports a quota failure instead of swallowing it', () => {
            const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
                throw new Error('QuotaExceededError');
            });

            const result = saveApplicationDraft(SLUG, { a: 1 });

            expect(result.ok).toBe(false);
            expect(result.localSeq).toBeNull();
            setItem.mockRestore();
        });

        it('writes the data and its metadata in one operation', () => {
            // One `setItem`, so the two can never desync. A separate metadata key
            // could half-fail on quota and leave a draft claiming to be synced
            // when it is not — which is the bug this metadata exists to prevent.
            const setItem = vi.spyOn(window.localStorage, 'setItem');

            saveApplicationDraft(SLUG, { a: 1 }, { lastStep: 2 });

            expect(setItem).toHaveBeenCalledTimes(1);
            setItem.mockRestore();
        });
    });

    describe('navigation-only writes', () => {
        it('does not advance the sequence when no answer changed', () => {
            // Pressing Back writes the draft but sends no server save. Advancing the
            // sequence there marked a fully synced copy as holding unacknowledged
            // work, and it would then beat genuinely newer work from another device
            // for the rest of the draft's life.
            const { localSeq } = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 3 });
            markDraftSynced(SLUG, localSeq);

            const back = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 2 });

            const draft = readApplicationDraft(SLUG);
            expect(back.localSeq).toBe(localSeq);
            expect(draft.meta.localSeq).toBe(draft.meta.syncedSeq);
            // The step still moved: navigation is recorded, just not as new work.
            expect(draft.lastStep).toBe(2);
        });

        it('still advances when an answer really did change', () => {
            const { localSeq } = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 1 });
            markDraftSynced(SLUG, localSeq);

            saveApplicationDraft(SLUG, { firstName: 'Adaline' }, { lastStep: 1 });

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBeGreaterThan(draft.meta.syncedSeq);
        });

        it('treats a nested change as a change', () => {
            const { localSeq } = saveApplicationDraft(SLUG, { customAnswers: { q1: 'a' } });
            markDraftSynced(SLUG, localSeq);

            saveApplicationDraft(SLUG, { customAnswers: { q1: 'a', q2: 'b' } });

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBeGreaterThan(draft.meta.syncedSeq);
        });

        it('does not advance across several navigations with no edits', () => {
            const { localSeq } = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 4 });
            markDraftSynced(SLUG, localSeq);

            for (const step of [3, 2, 3, 4, 5]) {
                saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: step });
            }

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBe(draft.meta.syncedSeq);
            expect(draft.lastStep).toBe(5);
        });

        it('never treats a legacy draft as unchanged, even with identical answers', () => {
            // Legacy has no sequence. Calling it unchanged would leave 0/0, which
            // reads as synced — a claim nothing supports.
            localStorage.setItem(KEY, JSON.stringify({ firstName: 'Ada', lastStep: 2 }));

            const result = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 2 });

            expect(result.localSeq).toBe(1);
            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBeGreaterThan(draft.meta.syncedSeq);
        });

        it('keeps savedAt naming the last real edit', () => {
            saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 1 });
            const afterEdit = readApplicationDraft(SLUG).meta.savedAt;

            saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 2 });

            expect(readApplicationDraft(SLUG).meta.savedAt).toBe(afterEdit);
        });

        it('does not restamp savedAt when a save is confirmed synced', () => {
            // Recording a confirmed sync passes explicit sequence numbers, which is
            // a different question from "did the applicant type something". The
            // stamp is diagnostics only, and one that moves when no answer moved
            // misleads the person reading it.
            const { localSeq } = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 1 });
            const afterEdit = readApplicationDraft(SLUG).meta.savedAt;

            expect(markDraftSynced(SLUG, localSeq)).toBe(true);

            const after = readApplicationDraft(SLUG);
            expect(after.meta.savedAt).toBe(afterEdit);
            expect(after.meta.syncedSeq).toBe(localSeq);
        });

        it('ignores an unserializable body rather than calling it unchanged', () => {
            // A false "unchanged" would drop the dirty marker; a false "changed"
            // costs one redundant save.
            const { localSeq } = saveApplicationDraft(SLUG, { firstName: 'Ada' });
            markDraftSynced(SLUG, localSeq);

            const cyclic = { firstName: 'Ada' };
            cyclic.self = cyclic;
            saveApplicationDraft(SLUG, cyclic);

            // The write itself fails (JSON.stringify throws on the envelope), and
            // nothing was marked clean on the way past.
            expect(readApplicationDraft(SLUG).meta.syncedSeq).toBe(localSeq);
        });
    });

    describe('the synced option', () => {
        it('marks whatever sequence the write lands on as confirmed', () => {
            saveApplicationDraft(SLUG, { a: 1 });
            saveApplicationDraft(SLUG, { a: 2 }, { synced: true });

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBe(2);
            expect(draft.meta.syncedSeq).toBe(2);
        });

        it('adopts an explicit sequence when one is supplied', () => {
            saveApplicationDraft(SLUG, { a: 1 }, { localSeq: 9, synced: true });

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBe(9);
            expect(draft.meta.syncedSeq).toBe(9);
        });

        it('is what keeps a restored server copy from posing as unsynced work', () => {
            // A server draft written before `clientSeq` existed has no sequence to
            // adopt. Writing it as an ordinary local write would mark it dirty, and
            // a later genuine server advance would then lose to it.
            localStorage.setItem(KEY, JSON.stringify({ old: true, lastStep: 1 }));
            saveApplicationDraft(SLUG, { restored: true }, { synced: true });

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBe(draft.meta.syncedSeq);
        });
    });

    describe('markDraftSynced', () => {
        it('records the confirmed sequence', () => {
            const { localSeq } = saveApplicationDraft(SLUG, { a: 1 });

            expect(markDraftSynced(SLUG, localSeq)).toBe(true);
            expect(readApplicationDraft(SLUG).meta.syncedSeq).toBe(localSeq);
        });

        it('refuses when the local copy has moved on since that save started', () => {
            const first = saveApplicationDraft(SLUG, { step: 'one' }).localSeq;
            saveApplicationDraft(SLUG, { step: 'two' });

            // The first save lands late. Marking it synced would declare the
            // *newer* local work acknowledged, and the next page load would then
            // hand the applicant the older server copy.
            expect(markDraftSynced(SLUG, first)).toBe(false);
            expect(readApplicationDraft(SLUG).meta.syncedSeq).toBe(0);
            expect(readApplicationDraft(SLUG).data.step).toBe('two');
        });

        it('is idempotent for a sequence already recorded', () => {
            const { localSeq } = saveApplicationDraft(SLUG, { a: 1 });
            markDraftSynced(SLUG, localSeq);

            expect(markDraftSynced(SLUG, localSeq)).toBe(true);
            expect(readApplicationDraft(SLUG).meta.syncedSeq).toBe(localSeq);
        });

        it('does not invent metadata for a legacy draft', () => {
            localStorage.setItem(KEY, JSON.stringify({ firstName: 'Ada', lastStep: 4 }));

            expect(markDraftSynced(SLUG, 1)).toBe(false);
            expect(readApplicationDraft(SLUG).meta).toBeNull();
        });

        it('ignores a missing draft, a missing slug and a non-integer sequence', () => {
            expect(markDraftSynced(SLUG, 1)).toBe(false);
            expect(markDraftSynced('', 1)).toBe(false);
            saveApplicationDraft(SLUG, { a: 1 });
            expect(markDraftSynced(SLUG, 1.5)).toBe(false);
            expect(markDraftSynced(SLUG, undefined)).toBe(false);
        });

        it('preserves the answers and step it re-writes', () => {
            const { localSeq } = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 3 });
            markDraftSynced(SLUG, localSeq);

            const draft = readApplicationDraft(SLUG);
            expect(draft.data).toEqual({ firstName: 'Ada' });
            expect(draft.lastStep).toBe(3);
        });
    });

    it('clears the draft and its metadata together', () => {
        saveApplicationDraft(SLUG, { a: 1 });
        clearApplicationDraft(SLUG);

        expect(readApplicationDraft(SLUG)).toBeNull();
        expect(localStorage.getItem(KEY)).toBeNull();
    });
});
